require('dotenv').config(); // Load .env variables at the very top
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose'); // Import mongoose
const { Expo } = require('expo-server-sdk'); // Import Expo SDK
const crypto = require('crypto'); // Import crypto for code generation

const app = express();
app.use(express.json()); // Middleware to parse JSON bodies

// --- MongoDB Connection ---
const MONGODB_URL = process.env.MONGODB_URL;
if (!MONGODB_URL) {
    console.error("FATAL ERROR: MONGODB_URL is not defined in .env file.");
    process.exit(1); // Exit if DB connection string is missing
}

mongoose.connect(MONGODB_URL)
    .then(() => console.log('Successfully connected to MongoDB.'))
    .catch(err => {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    });

// Optional: Listen for connection events
mongoose.connection.on('error', err => {
  console.error('MongoDB runtime error:', err);
});
mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected.');
});

// --- Authentication ---
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key'; // Use from .env or a fallback
if (JWT_SECRET === 'fallback_secret_key') {
    console.warn("WARNING: JWT_SECRET not found in .env, using fallback. Set a strong secret in .env for production!");
}
const saltRounds = 10; // For bcrypt hashing

// --- Mongoose User Schema and Model ---
const userSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true, index: true }, // Keep numeric ID for now
    email: { type: String, required: true, unique: true, trim: true, lowercase: true }, // Add email field
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true },
    role: { type: String, required: true, enum: ['parent', 'child'] },
    pushTokens: { type: [String], default: [] }, // Stores Expo push tokens for this user
    linkedUserIds: { type: [Number], default: [] } // Stores the numeric 'id' of linked users (e.g., parent's children or child's parents)
}, { timestamps: true }); // Add timestamps for createdAt/updatedAt

const User = mongoose.model('User', userSchema);

// Simple counter for numeric ID (In a real app, use a dedicated sequence generator or UUIDs)
let userIdCounter = 0; // Initialize to 0

// Asynchronously find the highest current ID to initialize the counter
const initializeCounter = async () => {
    try {
        const lastUser = await User.findOne().sort('-id').exec();
        if (lastUser && typeof lastUser.id === 'number') {
            userIdCounter = lastUser.id;
            console.log(`Initialized userIdCounter to ${userIdCounter}`);
        } else {
            console.log('No users found or last user has no valid ID, starting counter at 0.');
            userIdCounter = 0; // Ensure it's 0 if no users exist
        }
    } catch (err) {
        console.error("Error initializing userIdCounter:", err);
    }
};
initializeCounter(); // Call the async function


// Register Endpoint
app.post('/register', async (req, res) => {
    try {
        const { email, username, password, role } = req.body;
        if (!email || !username || !password || !role) {
            return res.status(400).json({ message: 'Email, username, password, and role are required' });
        }
        const existingUser = await User.findOne({
            $or: [
                { email: email.toLowerCase() },
                { username: username.toLowerCase() }
            ]
         });
        if (existingUser) {
             const message = existingUser.email === email.toLowerCase()
                ? 'Email already exists'
                : 'Username already exists';
            return res.status(400).json({ message });
        }
        userIdCounter++;
        const newUserId = userIdCounter;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const newUser = new User({
            id: newUserId,
            email: email.toLowerCase(),
            username: username.toLowerCase(),
            password: hashedPassword,
            role
            // linkedUserIds and pushTokens default to empty arrays
        });
        await newUser.save();
        console.log('User registered:', newUser.email, newUser.username, newUser.role, `(ID: ${newUser.id})`);
        res.status(201).json({ message: 'User registered successfully', userId: newUser.id });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ message: 'Error registering user' });
    }
});

// --- JWT Middleware for HTTP Routes ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (token == null) return res.sendStatus(401); // if there isn't any token

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.error("HTTP Auth Error:", err.message);
            return res.sendStatus(403); // Invalid token
        }
        req.user = user; // Add decoded user payload to request object
        next(); // pass the execution off to whatever request the client intended
    });
};

// Login Endpoint
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ message: 'Username and password are required' });
        }
        const user = await User.findOne({ username: username.toLowerCase() });
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        // Include linkedUserIds in the token if needed by the client
        const tokenPayload = { userId: user.id, username: user.username, role: user.role, linkedUserIds: user.linkedUserIds };
        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '1h' });
        console.log('User logged in:', user.username);
        res.json({ token });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ message: 'Error logging in' });
    }
});


// --- API Routes ---

// Push Token Registration
app.post('/api/user/push-token', authenticateToken, async (req, res) => {
    const { pushToken } = req.body;
    const userId = req.user.userId; // Get userId from authenticated user payload

    if (!pushToken) {
        return res.status(400).json({ message: 'Push token is required' });
    }
    if (!Expo.isExpoPushToken(pushToken)) {
         console.warn(`Received invalid push token format from user ${userId}: ${pushToken}`);
         return res.status(400).json({ message: 'Invalid push token format' });
    }

    try {
        const updatedUser = await User.findOneAndUpdate(
            { id: userId },
            { $addToSet: { pushTokens: pushToken } }, // Add token if not present
            { new: true }
        );
        if (!updatedUser) return res.status(404).json({ message: 'User not found' });
        console.log(`Added/updated push token for user ${userId}: ${pushToken}`);
        res.status(200).json({ message: 'Push token registered successfully' });
    } catch (error) {
        console.error(`Error registering push token for user ${userId}:`, error);
        res.status(500).json({ message: 'Failed to register push token' });
    }
});

// Placeholder Linking Endpoint (Needs proper implementation)
app.post('/api/link-user', authenticateToken, async (req, res) => {
    const { targetUserId } = req.body; // ID of the user to link with
    const currentUserId = req.user.userId;
    const currentUserRole = req.user.role;

    if (!targetUserId || typeof targetUserId !== 'number') {
        return res.status(400).json({ message: 'Target user ID is required and must be a number.' });
    }
    if (targetUserId === currentUserId) {
        return res.status(400).json({ message: 'Cannot link user to themselves.' });
    }

    try {
        const currentUser = await User.findOne({ id: currentUserId });
        const targetUser = await User.findOne({ id: targetUserId });

        if (!currentUser || !targetUser) {
            return res.status(404).json({ message: 'One or both users not found.' });
        }

        // Basic role check (e.g., parent links to child, child links to parent)
        if (currentUserRole === targetUser.role) {
             return res.status(400).json({ message: `Cannot link users with the same role (${currentUserRole}).` });
        }

        // Add links mutually (using $addToSet to prevent duplicates)
        await User.updateOne({ id: currentUserId }, { $addToSet: { linkedUserIds: targetUserId } });
        await User.updateOne({ id: targetUserId }, { $addToSet: { linkedUserIds: currentUserId } });

        console.log(`User ${currentUserId} linked with user ${targetUserId}`);
        res.status(200).json({ message: `Successfully linked with user ${targetUserId}` });

    } catch (error) {
        console.error(`Error linking users ${currentUserId} and ${targetUserId}:`, error);
        res.status(500).json({ message: 'Failed to link users.' });
    }
});


// --- Expo Push Notifications Setup ---
const expo = new Expo(); // Create a new Expo SDK client


// --- Socket.IO Setup ---
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for now, restrict in production
    methods: ["GET", "POST"]
  }
});

// --- Socket.IO Middleware for Auth ---
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error: Token not provided'));
  }
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      console.error("Socket Auth Error:", err.message);
      return next(new Error('Authentication error: Invalid token'));
    }
    socket.user = decoded; // Attach user info { userId, username, role, linkedUserIds }
    next();
  });
});

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('FlashGet Server is running!');
});

// --- In-memory tracking ---
const connectedParents = new Map(); // Map<socket.id, user info>
const connectedChildren = new Map(); // Map<userId, { socketId: string, username: string }>
const pendingConnections = new Map(); // Map<connectionCode, { userId: number, socketId: string, expires: number }>
const childLastLocations = new Map(); // Map<userId, { latitude: number, longitude: number, timestamp: number, username: string }>
const CONNECTION_CODE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const LOCATION_RECENCY_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes for considering stored location "recent"

// Helper function to generate a unique connection code
const generateConnectionCode = (length = 6) => {
    let code;
    do {
        code = crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length).toUpperCase();
    } while (pendingConnections.has(code)); // Ensure uniqueness
    return code;
};

// REMOVED getChildrenList function - list will be fetched from DB based on links

// Helper function to broadcast updates to specific parents (Sockets)
const broadcastToSpecificParentsSockets = (parentIds, event, data) => {
    if (!parentIds || parentIds.length === 0) return;
    // console.log(`Broadcasting ${event} to specific parents (${parentIds.join(',')}) via Sockets`);
    connectedParents.forEach((userInfo, socketId) => {
        if (parentIds.includes(userInfo.userId)) { // Check if this parent should receive it
             io.to(socketId).emit(event, data);
        }
    });
};

// --- Push Notification Sending Logic ---
const sendPushNotifications = async (pushTokens, title, body, data) => {
    const messages = [];
    const tokensToRemove = new Set(); // Keep track of tokens to remove

    for (let pushToken of pushTokens) {
        if (!Expo.isExpoPushToken(pushToken)) {
            console.warn(`Push token ${pushToken} is not a valid Expo push token`);
            tokensToRemove.add(pushToken); // Mark invalid format tokens for removal
            continue;
        }
        messages.push({
            to: pushToken,
            sound: 'default',
            title: title,
            body: body,
            data: data,
        });
    }

    if (messages.length === 0) {
        console.log("No valid push tokens found to send notifications.");
        // Still attempt cleanup for invalid format tokens found above
        if (tokensToRemove.size > 0) {
             await cleanupInvalidTokens([...tokensToRemove]);
        }
        return;
    }

    const chunks = expo.chunkPushNotifications(messages);
    console.log(`Sending ${messages.length} push notifications in ${chunks.length} chunks.`);

    for (const chunk of chunks) {
        try {
            const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
            ticketChunk.forEach((ticket, index) => {
                const originalMessage = chunk[index];
                if (ticket.status === 'error') {
                    console.error(`Error sending notification to ${originalMessage.to}: ${ticket.message}`);
                    if (ticket.details && ticket.details.error === 'DeviceNotRegistered') {
                        tokensToRemove.add(originalMessage.to); // Mark for removal
                    }
                    // Handle other potential errors like 'MessageTooBig', 'InvalidCredentials', etc.
                }
            });
        } catch (error) {
            console.error('Error sending push notification chunk:', error);
            // Potentially mark all tokens in this chunk as problematic? Depends on error type.
        }
    }

    // Cleanup invalid tokens after attempting all sends
    if (tokensToRemove.size > 0) {
        await cleanupInvalidTokens([...tokensToRemove]);
    }
};

// Helper function to remove invalid tokens from DB
const cleanupInvalidTokens = async (tokens) => {
     if (!tokens || tokens.length === 0) return;
     console.log(`Attempting to remove ${tokens.length} invalid/unregistered push tokens from DB...`);
     try {
         const result = await User.updateMany(
             { pushTokens: { $in: tokens } }, // Find users with any of these tokens
             { $pull: { pushTokens: { $in: tokens } } } // Remove the specific tokens
         );
         console.log(`Token cleanup result: ${result.modifiedCount} users updated.`);
     } catch (error) {
         console.error("Error during push token cleanup:", error);
     }
};


io.on('connection', (socket) => {
  const { userId, role, username, linkedUserIds } = socket.user; // Get linked IDs from token
  console.log(`User connected: ${username} (ID: ${socket.id}, Role: ${role}, Linked: ${linkedUserIds?.join(',')})`);

  // --- Track connected users & Send Initial Data ---
  if (role === 'parent') {
      connectedParents.set(socket.id, socket.user);
      console.log(`Parent ${username} connected. Total parents: ${connectedParents.size}`);
      // Fetch and send the list of ALL linked children from DB
      const fetchAndSendLinkedChildren = async () => {
          try {
              const parentData = await User.findOne({ id: userId }).select('linkedUserIds').lean();
              const linkedIds = parentData?.linkedUserIds || [];
              if (linkedIds.length > 0) {
                  const childrenDetails = await User.find({ id: { $in: linkedIds }, role: 'child' })
                                                    .select('id username') // Select only needed fields
                                                    .lean(); // Use lean for performance
                  // Log the actual structure being sent
                  console.log(`Data structure being sent for update_children_list to parent ${username}:`, JSON.stringify(childrenDetails));
                  socket.emit('update_children_list', childrenDetails);
              } else {
                  console.log(`Parent ${username} has no linked children.`);
                  socket.emit('update_children_list', []); // Send empty list
              }
          } catch (error) {
              console.error(`Error fetching linked children for parent ${userId}:`, error);
              socket.emit('update_children_list', []); // Send empty list on error
          }
      };
      // fetchAndSendLinkedChildren(); // REMOVED - Client will request the list

  } else if (role === 'child') {
      // Only set the primary connection if the child isn't already tracked
      // This prevents background tasks from overwriting the main socket ID
      if (!connectedChildren.has(userId)) {
          connectedChildren.set(userId, { socketId: socket.id, username: username });
          console.log(`Child ${username} (ID: ${userId}) primary connection established. Socket ID: ${socket.id}. Total children: ${connectedChildren.size}`);
      } else {
          // Log if a different socket connects for the same child (likely background task)
          console.log(`Child ${username} (ID: ${userId}) already tracked with socket ${connectedChildren.get(userId)?.socketId}. New socket ID ${socket.id} likely from background task.`);
      }
      // Parent gets the full list on their connection. Status can be inferred later.
      const childRoomName = `child_${userId}`;
      socket.join(childRoomName);
      console.log(`Child ${username} joined room: ${childRoomName}`);

      // Generate and send connection code
      const connectionCode = generateConnectionCode();
      const expires = Date.now() + CONNECTION_CODE_EXPIRY_MS;
      pendingConnections.set(connectionCode, { userId, socketId: socket.id, expires });
      console.log(`Generated connection code ${connectionCode} for child ${userId}, expires at ${new Date(expires).toLocaleTimeString()}`);
      // socket.emit('receive_connection_code', { code: connectionCode }); // REMOVED - Client will request it

      // Optional: Set a timeout to automatically remove the code if not used
      setTimeout(() => {
          const entry = pendingConnections.get(connectionCode);
          if (entry && entry.socketId === socket.id) { // Check if it's still the same entry
              console.log(`Connection code ${connectionCode} expired for child ${userId}. Removing.`);
              pendingConnections.delete(connectionCode);
          }
      }, CONNECTION_CODE_EXPIRY_MS + 1000); // Add a small buffer
  }

  // --- Specific Room Joining ---
  socket.on('join_child_room', async (targetChildUserId) => { // Make handler async
    // Log the state when attempting to join
    console.log(`DEBUG: Parent ${username} (ID: ${userId}) attempting to join room for child ${targetChildUserId}.`);
    // console.log(`DEBUG: socket.user.linkedUserIds (from token):`, socket.user.linkedUserIds); // Keep for reference if needed

    if (role === 'parent') {
      try {
        // Fetch fresh linked IDs from DB
        const parentData = await User.findOne({ id: userId }).select('linkedUserIds').lean();
        const parentLinkedIds = parentData?.linkedUserIds || [];
        console.log(`DEBUG: Freshly fetched linkedUserIds from DB for parent ${userId}:`, parentLinkedIds);

        // Check using fresh data
        if (!parentLinkedIds.includes(targetChildUserId)) {
            console.log(`Parent ${username} attempted to join room for unlinked child ${targetChildUserId}. Linked IDs from DB: [${parentLinkedIds.join(',')}]`);
            return socket.emit('join_room_error', { message: `You are not linked to child ID ${targetChildUserId}.` });
        }

        // Proceed if linked
        const targetRoom = `child_${targetChildUserId}`;
        if (connectedChildren.has(targetChildUserId)) {
              console.log(`Parent ${username} (ID: ${userId}) joining specific room: ${targetRoom}`);
              socket.join(targetRoom);
              socket.emit('joined_room_ack', { room: targetRoom, childId: targetChildUserId });
        } else {
           console.log(`Parent ${username} attempted to join non-existent/offline child room for ID: ${targetChildUserId}`);
           socket.emit('join_room_error', { message: `Child with ID ${targetChildUserId} not found or is offline.` });
        }
      } catch (error) {
          console.error(`Error checking link or joining room for parent ${userId} and child ${targetChildUserId}:`, error);
          socket.emit('join_room_error', { message: 'Server error checking link status.' });
      }
    } else {
      console.log(`Non-parent user ${username} attempted to join child room.`);
    }
  });

  // --- Disconnect Handler ---
  socket.on('disconnect', (reason) => { // Add reason parameter
    console.log(`User disconnected: ${username} (ID: ${socket.id}, Role: ${role}, Reason: ${reason})`); // Log reason
    if (role === 'parent') {
        connectedParents.delete(socket.id);
        console.log(`Parent ${username} disconnected. Total parents: ${connectedParents.size}`);
    } else if (role === 'child') {
        // Clean up pending connection code if child disconnects
        pendingConnections.forEach((value, key) => {
            if (value.userId === userId && value.socketId === socket.id) { // Only remove code if the disconnecting socket is the one that generated it
                console.log(`Child ${userId} disconnected (socket ${socket.id}), removing pending connection code ${key}`);
                pendingConnections.delete(key);
            }
        });
        // Only remove from connectedChildren if the disconnecting socket is the primary one stored
        const trackedChild = connectedChildren.get(userId);
        if (trackedChild && trackedChild.socketId === socket.id) {
            connectedChildren.delete(userId);
            console.log(`Child ${username} (ID: ${userId}) primary connection disconnected. Total children: ${connectedChildren.size}`);
        } else {
            console.log(`Child ${username} (ID: ${userId}) disconnected via non-primary socket ${socket.id}. Primary connection remains tracked (if any).`);
        }
        // Child disconnection no longer triggers update_children_list for parents directly
      }
  });

  // --- Handle Parent Request for Children List (New) ---
  socket.on('request_children_list', async () => {
      if (role === 'parent') {
          console.log(`Parent ${username} requested children list.`);
          try {
              // Use socket.user.userId which should be reliable here
              const parentData = await User.findOne({ id: socket.user.userId }).select('linkedUserIds').lean();
              const linkedIds = parentData?.linkedUserIds || [];
              if (linkedIds.length > 0) {
                  const childrenDetails = await User.find({ id: { $in: linkedIds }, role: 'child' })
                                                    .select('id username')
                                                    .lean();
                  console.log(`Data structure being sent for update_children_list to parent ${username} (on request):`, JSON.stringify(childrenDetails));
                  socket.emit('update_children_list', childrenDetails);
              } else {
                  console.log(`Parent ${username} has no linked children (on request).`);
                  socket.emit('update_children_list', []); // Send empty list
              }
          } catch (error) {
              console.error(`Error fetching linked children for parent ${socket.user.userId} (on request):`, error);
              socket.emit('update_children_list', []); // Send empty list on error
          }
      } else {
          console.log(`Non-parent user ${username} requested children list.`);
      }
  });

  // --- Handle Client Request for Code (New) ---
  socket.on('request_connection_code', () => {
      if (role === 'child') {
          let existingCode = null;
          // Find the code associated with this child's userId
          pendingConnections.forEach((value, key) => {
              // Ensure we find the code associated with the CURRENT socket ID if multiple exist temporarily
              if (value.userId === userId && value.socketId === socket.id) {
                  existingCode = key;
              }
          });

          if (existingCode) {
              const entry = pendingConnections.get(existingCode);
              if (Date.now() < entry.expires) {
                  console.log(`Child ${userId} requested code. Sending existing code: ${existingCode}`);
                  socket.emit('receive_connection_code', { code: existingCode });
              } else {
                  console.log(`Child ${userId} requested code, but existing code ${existingCode} expired. Generating new one.`);
                  pendingConnections.delete(existingCode); // Delete expired
                  // Generate and store a new one
                  const newConnectionCode = generateConnectionCode();
                  const newExpires = Date.now() + CONNECTION_CODE_EXPIRY_MS;
                  pendingConnections.set(newConnectionCode, { userId, socketId: socket.id, expires: newExpires });
                  console.log(`Generated new connection code ${newConnectionCode} for child ${userId}, expires at ${new Date(newExpires).toLocaleTimeString()}`);
                  socket.emit('receive_connection_code', { code: newConnectionCode });
                  // Set new timeout
                  setTimeout(() => {
                      const currentEntry = pendingConnections.get(newConnectionCode);
                      if (currentEntry && currentEntry.socketId === socket.id) {
                          console.log(`New connection code ${newConnectionCode} expired for child ${userId}. Removing.`);
                          pendingConnections.delete(newConnectionCode);
                      }
                  }, CONNECTION_CODE_EXPIRY_MS + 1000);
              }
          } else {
              console.log(`Child ${userId} requested code, but none found (socket ${socket.id}). Generating new one.`);
              // Generate and store a new one if none exists for this socket
              const newConnectionCode = generateConnectionCode();
              const newExpires = Date.now() + CONNECTION_CODE_EXPIRY_MS;
              pendingConnections.set(newConnectionCode, { userId, socketId: socket.id, expires: newExpires });
              console.log(`Generated new connection code ${newConnectionCode} for child ${userId}, expires at ${new Date(newExpires).toLocaleTimeString()}`);
              socket.emit('receive_connection_code', { code: newConnectionCode });
               // Set new timeout
               setTimeout(() => {
                  const currentEntry = pendingConnections.get(newConnectionCode);
                  if (currentEntry && currentEntry.socketId === socket.id) {
                      console.log(`New connection code ${newConnectionCode} expired for child ${userId}. Removing.`);
                      pendingConnections.delete(newConnectionCode);
                  }
              }, CONNECTION_CODE_EXPIRY_MS + 1000);
          }
      } else {
          console.log(`Non-child user ${username} requested connection code.`);
      }
  });


  // --- Link Child Handler (New) ---
  socket.on('link_child_with_code', async (data) => {
      if (role !== 'parent') {
          console.log(`Non-parent user ${username} attempted to link child.`);
          return socket.emit('link_child_error', { message: 'Only parents can link children.' });
      }

      const { connectionCode } = data;
      if (!connectionCode || typeof connectionCode !== 'string') {
          return socket.emit('link_child_error', { message: 'Invalid connection code format.' });
      }

      const connectionEntry = pendingConnections.get(connectionCode.toUpperCase());

      if (!connectionEntry) {
          console.log(`Parent ${username} used invalid code: ${connectionCode}`);
          return socket.emit('link_child_error', { message: 'Invalid or expired connection code.' });
      }

      if (Date.now() > connectionEntry.expires) {
          console.log(`Parent ${username} used expired code: ${connectionCode}`);
          pendingConnections.delete(connectionCode.toUpperCase()); // Clean up expired code
          return socket.emit('link_child_error', { message: 'Connection code has expired.' });
      }

      const childUserId = connectionEntry.userId;
      const parentUserId = userId; // The current socket user's ID

      // Check if already linked
      const parentUser = await User.findOne({ id: parentUserId }).select('linkedUserIds').lean();
      if (parentUser?.linkedUserIds?.includes(childUserId)) {
          console.log(`Parent ${parentUserId} is already linked with child ${childUserId}. Code: ${connectionCode}`);
          pendingConnections.delete(connectionCode.toUpperCase()); // Remove used code
          // Fetch child info to send back
          const childInfo = connectedChildren.get(childUserId) || await User.findOne({ id: childUserId }).select('id username').lean();
          return socket.emit('link_child_success', {
              message: `You are already linked with ${childInfo?.username || `Child ID ${childUserId}`}.`,
              child: { id: childUserId, username: childInfo?.username || 'Unknown' }
          });
      }

      try {
          // Link parent to child
          await User.updateOne({ id: parentUserId }, { $addToSet: { linkedUserIds: childUserId } });
          // Link child to parent
          await User.updateOne({ id: childUserId }, { $addToSet: { linkedUserIds: parentUserId } });

          console.log(`Successfully linked Parent ${parentUserId} with Child ${childUserId} using code ${connectionCode}`);
          pendingConnections.delete(connectionCode.toUpperCase()); // Remove used code

          // Fetch child info to send back
          const childInfo = connectedChildren.get(childUserId) || await User.findOne({ id: childUserId }).select('id username').lean();
          if (!childInfo) {
              console.warn(`Could not fetch child info for ID ${childUserId} after linking.`);
          }

          // Send success message back to parent
          socket.emit('link_child_success', {
              message: `Successfully linked with ${childInfo?.username || `Child ID ${childUserId}`}.`,
              child: { id: childUserId, username: childInfo?.username || 'Unknown' }
          });

          // Update the parent's children list immediately by refetching from DB
           const updatedParentData = await User.findOne({ id: parentUserId }).select('linkedUserIds').lean();
           const updatedLinkedIds = updatedParentData?.linkedUserIds || [];
           if (updatedLinkedIds.length > 0) {
               const childrenDetails = await User.find({ id: { $in: updatedLinkedIds }, role: 'child' })
                                                 .select('id username')
                                                 .lean();
                // Log the actual structure being sent
               console.log(`Data structure being sent for update_children_list to parent ${username} after linking:`, JSON.stringify(childrenDetails));
               socket.emit('update_children_list', childrenDetails);
           } else {
               socket.emit('update_children_list', []); // Should not happen right after linking, but safe fallback
           }

          // Update the parent's user object on the socket
          socket.user.linkedUserIds = updatedLinkedIds; // Use the updated list

      } catch (error) {
          console.error(`Database error linking Parent ${parentUserId} and Child ${childUserId}:`, error);
          socket.emit('link_child_error', { message: 'Database error during linking.' });
      }
  });

  // --- Location Data Handler (Update to store last location) ---
  socket.on('send_location', async (data) => { // Make async
    if (role === 'child') {
      const locationData = {
          userId,
          username,
          latitude: data.latitude,
          longitude: data.longitude,
          timestamp: data.timestamp || Date.now() // Ensure timestamp exists
      };
      // console.log(`Location received from ${username}:`, locationData.latitude, locationData.longitude);

      // Store the latest location
      childLastLocations.set(userId, locationData);
      // Optional: Log storage update
      // console.log(`Stored last location for child ${userId} at ${new Date(locationData.timestamp).toISOString()}`);


      // Find linked parents for this child
      const childUser = await User.findOne({ id: userId }).select('linkedUserIds').lean();
      const parentIds = childUser?.linkedUserIds || [];

      if (parentIds.length === 0) {
          console.log(`Child ${username} sent location, but has no linked parents.`);
          return; // No parents to notify
      }

      // 1. Broadcast location to linked connected parents via Socket.IO
      broadcastToSpecificParentsSockets(parentIds, 'receive_location', locationData);

      // 2. Send Push Notifications to linked parents (whether connected or not)
      try {
          const parents = await User.find({ id: { $in: parentIds }, role: 'parent', pushTokens: { $exists: true, $ne: [] } })
                                    .select('pushTokens').lean();

          let parentTokens = parents.reduce((tokens, parent) => tokens.concat(parent.pushTokens), []);

          if (parentTokens.length > 0) {
              console.log(`Sending push notification for ${username}'s location to ${parentTokens.length} tokens of linked parents.`);
              await sendPushNotifications(
                  parentTokens,
                  `Location Update: ${username}`, // Notification Title
                  `Received new location at ${new Date(data.timestamp).toLocaleTimeString()}`, // Notification Body
                  { // Optional data payload
                      type: 'locationUpdate',
                      childUserId: userId,
                      childUsername: username,
                      latitude: data.latitude,
                      longitude: data.longitude,
                      timestamp: data.timestamp,
                      screen: 'parent' // Hint for client-side navigation
                  }
              );
          } else {
              console.log(`No valid push tokens found for linked parents of child ${userId}.`);
          }
      } catch (error) {
          console.error(`Error fetching linked parent tokens or sending push notifications for child ${userId}:`, error);
      }
    }
  });

   // --- Location Refresh Handler (Push Notification Trigger Logic) ---
   socket.on('request_current_location', async (targetChildUserId) => {
       console.log(`[DEBUG] request_current_location received for child ${targetChildUserId} from parent ${username}`); // Add entry log
       if (role !== 'parent') {
           console.log(`[DEBUG] Ignored request: User ${username} is not a parent.`);
           return; // Ignore if not parent
       }

       // Check if parent is linked to the child
       console.log(`[DEBUG] Checking link for parent ${userId} and child ${targetChildUserId}. Parent linked IDs: ${socket.user.linkedUserIds?.join(',')}`);
       if (socket.user.linkedUserIds && !socket.user.linkedUserIds.includes(targetChildUserId)) {
           console.log(`[DEBUG] Parent ${username} is not linked to child ${targetChildUserId}. Aborting.`);
           return socket.emit('location_request_error', { message: `You are not linked to child ID ${targetChildUserId}.` });
       }

       const childInfo = connectedChildren.get(targetChildUserId);
       const storedLocation = childLastLocations.get(targetChildUserId);
       console.log(`[DEBUG] Child connection status (childInfo): ${childInfo ? JSON.stringify(childInfo) : 'null'}`);
       console.log(`[DEBUG] Stored location status (storedLocation): ${storedLocation ? JSON.stringify(storedLocation) : 'null'}`);

       // --- Scenario 1: Child's main app is connected ---
       if (childInfo) {
           console.log(`[DEBUG] Scenario 1: Child ${targetChildUserId} is connected.`);
           const targetSocketId = childInfo.socketId;
           const targetRoom = `child_${targetChildUserId}`;
           console.log(`Parent ${username} requested location for connected child ${targetChildUserId}. Emitting 'get_current_location' to socket ${targetSocketId}.`);
           // Ask the connected child for a live update
           io.to(targetSocketId).to(targetRoom).emit('get_current_location');
           // Optionally send stored location immediately as well for faster feedback?
           // if (storedLocation) {
           //     socket.emit('receive_location', { ...storedLocation, isStale: true, updateRequested: true });
           // }
           return; // Exit after handling connected child
       }

       // --- Scenario 2: Child's main app is NOT connected (App Closed/Background) ---
       console.log(`[DEBUG] Scenario 2: Child ${targetChildUserId} is NOT connected. Attempting push trigger.`);

       // Immediately send back the latest stored location, even if stale, for quick feedback
       if (storedLocation) {
           console.log(`[DEBUG] Sending stored location (timestamp: ${new Date(storedLocation.timestamp).toISOString()}) to parent ${username} while requesting fresh update via push.`);
           socket.emit('receive_location', { ...storedLocation, isStale: true, updateRequested: true });
       } else {
           // If no stored location exists at all, inform the parent
           console.log(`[DEBUG] No stored location found for offline child ${targetChildUserId}. Informing parent.`);
           socket.emit('location_request_error', { message: `Child ${targetChildUserId} is offline. Requesting update via push...` });
       }

       // Attempt to send silent push notification to trigger background fetch
       console.log(`[DEBUG] Preparing to send push notification trigger for child ${targetChildUserId}.`);
       try {
           const childUser = await User.findOne({ id: targetChildUserId }).select('pushTokens').lean();
           const childTokens = childUser?.pushTokens || [];

           if (childTokens.length > 0) {
               console.log(`Sending silent push notification to trigger location update for child ${targetChildUserId} (${childTokens.length} tokens).`);
               await sendPushNotifications(
                   childTokens,
                   null, // No title for silent notification
                   null, // No body for silent notification
                   { // Data payload to be handled by client background handler
                       action: 'requestImmediateLocation',
                       requestingParentId: userId // Optional: Include who requested it
                   },
                   // Add options for silent notification if the function supports it
                   // e.g., { contentAvailable: true, priority: 'high' } - check expo-server-sdk docs/implementation
               );
               // Note: We don't wait for a response here. The response will come via 'send_location' if the client handles the push.
           } else {
               console.log(`Child ${targetChildUserId} has no registered push tokens. Cannot trigger update.`);
               // Update the parent? Maybe not necessary if stale data was already sent.
               // socket.emit('location_request_error', { message: `Child ${targetChildUserId} has no push tokens registered. Cannot request live update.` });
           }
       } catch (error) {
           console.error(`Error fetching tokens or sending push notification trigger for child ${targetChildUserId}:`, error);
           // Inform parent about the failure to trigger?
           // socket.emit('location_request_error', { message: `Failed to send push notification trigger to child ${targetChildUserId}.` });
       }
       // Removed extra brace here
   });

});

server.listen(PORT, () => {
  console.log(`Server listening on *:${PORT}`);
});
