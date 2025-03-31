require('dotenv').config(); // Load .env variables at the very top
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose'); // Import mongoose

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
    role: { type: String, required: true, enum: ['parent', 'child'] }
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
        });
        await newUser.save();
        console.log('User registered:', newUser.email, newUser.username, newUser.role, `(ID: ${newUser.id})`);
        res.status(201).json({ message: 'User registered successfully', userId: newUser.id });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ message: 'Error registering user' });
    }
});

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
        const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
        console.log('User logged in:', user.username);
        res.json({ token });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ message: 'Error logging in' });
    }
});


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
    socket.user = decoded; // Attach user info { userId, username, role }
    console.log(`Socket authenticated: ${socket.user.username} (${socket.user.role})`);
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

// Helper function to broadcast updates to all parents
const broadcastToParents = (event, data) => {
    console.log(`Broadcasting ${event} to ${connectedParents.size} parents`);
    connectedParents.forEach((userInfo, socketId) => {
        io.to(socketId).emit(event, data);
    });
};


io.on('connection', (socket) => {
  const { userId, role, username } = socket.user;
  console.log(`User connected: ${username} (ID: ${socket.id}, Role: ${role})`);

  // --- Track connected users ---
  if (role === 'parent') {
      connectedParents.set(socket.id, socket.user);
      // Send current children list to the newly connected parent
      socket.emit('update_children_list', getChildrenList());
      console.log(`Parent ${username} connected. Total parents: ${connectedParents.size}`);
  } else if (role === 'child') {
      connectedChildren.set(userId, { socketId: socket.id, username: username });
      // Notify all parents about the new child
      broadcastToParents('update_children_list', getChildrenList());
      console.log(`Child ${username} (ID: ${userId}) connected. Total children: ${connectedChildren.size}`);
      // Child automatically joins their own room for specific targeting
      const childRoomName = `child_${userId}`;
      socket.join(childRoomName);
      console.log(`Child ${username} joined room: ${childRoomName}`);
  }

  // --- Specific Room Joining (for specific monitoring) ---
  socket.on('join_child_room', (targetChildUserId) => {
    if (role === 'parent') {
      const targetRoom = `child_${targetChildUserId}`;
      // Check if child user exists in DB (or just if they are connected)
      if (connectedChildren.has(targetChildUserId)) {
            console.log(`Parent ${username} (ID: ${userId}) joining specific room: ${targetRoom}`);
            socket.join(targetRoom);
            socket.emit('joined_room_ack', { room: targetRoom, childId: targetChildUserId }); // Acknowledge specific join
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
        // Notify all parents that a child disconnected
        broadcastToParents('update_children_list', getChildrenList());
        console.log(`Child ${username} (ID: ${userId}) disconnected. Total children: ${connectedChildren.size}`);
    }
  });

  // --- Location Data Handler ---
  socket.on('send_location', (data) => {
    if (role === 'child') {
      // console.log(`Location received from ${username}:`, data);
      // Broadcast location to ALL connected parents
      broadcastToParents('receive_location', { userId, username, ...data });
    }
  });

   // --- Location Refresh Handler ---
   socket.on('request_current_location', (targetChildUserId) => {
       if (role === 'parent') {
           const childInfo = connectedChildren.get(targetChildUserId);
           if (childInfo) {
               const targetSocketId = childInfo.socketId;
               const targetRoom = `child_${targetChildUserId}`; // Also emit to room in case parent joined specifically
               console.log(`Parent ${username} requested current location for child ${targetChildUserId}. Emitting to socket ${targetSocketId} and room ${targetRoom}`);
               // Emit command directly to the specific child's socket AND their room
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
