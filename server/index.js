require('dotenv').config(); // Load .env variables at the very top
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose'); // Import mongoose
const { Expo } = require('expo-server-sdk'); // Import Expo SDK

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

// --- In-memory tracking of connected users ---
const connectedParents = new Map(); // Map<socket.id, user info>
const connectedChildren = new Map(); // Map<userId, { socketId: string, username: string }>

// Helper function to get children list for parents
const getChildrenList = () => {
    const children = [];
    for (const [userId, childInfo] of connectedChildren.entries()) {
        children.push({ id: userId, username: childInfo.username });
    }
    return children;
};

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

  // --- Track connected users ---
  if (role === 'parent') {
      connectedParents.set(socket.id, socket.user);
      // TODO: Send only *linked* children list? Requires fetching linked children details.
      // For now, send all connected children.
      socket.emit('update_children_list', getChildrenList());
      console.log(`Parent ${username} connected. Total parents: ${connectedParents.size}`);
  } else if (role === 'child') {
      connectedChildren.set(userId, { socketId: socket.id, username: username });
      // Notify only linked parents about this child connecting
      if (linkedUserIds && linkedUserIds.length > 0) {
          broadcastToSpecificParentsSockets(linkedUserIds, 'update_children_list', getChildrenList());
      }
      console.log(`Child ${username} (ID: ${userId}) connected. Total children: ${connectedChildren.size}`);
      const childRoomName = `child_${userId}`;
      socket.join(childRoomName);
      console.log(`Child ${username} joined room: ${childRoomName}`);
  }

  // --- Specific Room Joining ---
  socket.on('join_child_room', (targetChildUserId) => {
    if (role === 'parent') {
      // Optional: Check if targetChildUserId is in parent's linkedUserIds
      if (linkedUserIds && !linkedUserIds.includes(targetChildUserId)) {
          console.log(`Parent ${username} attempted to join room for unlinked child ${targetChildUserId}`);
          return socket.emit('join_room_error', { message: `You are not linked to child ID ${targetChildUserId}.` });
      }
      const targetRoom = `child_${targetChildUserId}`;
      if (connectedChildren.has(targetChildUserId)) {
            console.log(`Parent ${username} (ID: ${userId}) joining specific room: ${targetRoom}`);
            socket.join(targetRoom);
            socket.emit('joined_room_ack', { room: targetRoom, childId: targetChildUserId });
      } else {
         console.log(`Parent ${username} attempted to join non-existent/offline child room for ID: ${targetChildUserId}`);
         socket.emit('join_room_error', { message: `Child with ID ${targetChildUserId} not found or is offline.` });
      }
    } else {
      console.log(`Non-parent user ${username} attempted to join child room.`);
    }
  });

  // --- Disconnect Handler ---
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${username} (ID: ${socket.id}, Role: ${role})`);
    if (role === 'parent') {
        connectedParents.delete(socket.id);
        console.log(`Parent ${username} disconnected. Total parents: ${connectedParents.size}`);
    } else if (role === 'child') {
        connectedChildren.delete(userId);
        // Notify only linked parents that this child disconnected
        if (linkedUserIds && linkedUserIds.length > 0) {
             broadcastToSpecificParentsSockets(linkedUserIds, 'update_children_list', getChildrenList());
        }
        console.log(`Child ${username} (ID: ${userId}) disconnected. Total children: ${connectedChildren.size}`);
    }
  });

  // --- Location Data Handler ---
  socket.on('send_location', async (data) => { // Make async
    if (role === 'child') {
      const locationData = { userId, username, ...data };
      // console.log(`Location received from ${username}:`, data.latitude, data.longitude);

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

   // --- Location Refresh Handler ---
   socket.on('request_current_location', (targetChildUserId) => {
       if (role === 'parent') {
           // Optional: Check if targetChildUserId is in parent's linkedUserIds
           if (linkedUserIds && !linkedUserIds.includes(targetChildUserId)) {
               console.log(`Parent ${username} attempted to request location for unlinked child ${targetChildUserId}`);
               return socket.emit('location_request_error', { message: `You are not linked to child ID ${targetChildUserId}.` });
           }

           const childInfo = connectedChildren.get(targetChildUserId);
           if (childInfo) {
               const targetSocketId = childInfo.socketId;
               const targetRoom = `child_${targetChildUserId}`;
               console.log(`Parent ${username} requested current location for child ${targetChildUserId}. Emitting to socket ${targetSocketId} and room ${targetRoom}`);
               io.to(targetSocketId).to(targetRoom).emit('get_current_location');
           } else {
                console.log(`Parent ${username} requested location for offline/unknown child ${targetChildUserId}`);
                socket.emit('location_request_error', { message: `Child ${targetChildUserId} is not connected.` });
           }
       } else {
           console.log(`Non-parent user ${username} attempted to request location.`);
       }
   });

});

server.listen(PORT, () => {
  console.log(`Server listening on *:${PORT}`);
});
