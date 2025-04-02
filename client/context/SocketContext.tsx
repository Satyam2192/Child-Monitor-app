import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode, JwtPayload } from 'jwt-decode'; // Import jwt-decode

// Define your backend URL
const SOCKET_URL = 'https://flashgo.onrender.com'; // Updated server URL

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  updateAuthToken: (token: string | null) => void; // Add function to update token
}

// Create the context with a default value
const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  updateAuthToken: () => {}, // Default empty function
});

// Custom hook to use the Socket context
export const useSocket = () => {
  return useContext(SocketContext);
};

interface SocketProviderProps {
  children: ReactNode;
}

export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);

  // Effect to load the token initially
  useEffect(() => {
    const loadToken = async () => {
      const token = await AsyncStorage.getItem('authToken');
      setAuthToken(token);
    };
    loadToken();
  }, []); // Runs once on mount

  // Effect to manage socket connection based on token
  useEffect(() => {
    if (authToken) {
      try {
        // Decode the token to check expiration
        const decoded = jwtDecode<JwtPayload>(authToken);
        if (decoded.exp && decoded.exp * 1000 < Date.now()) {
          console.log('SocketContext: Auth token is expired. Clearing token.');
          AsyncStorage.removeItem('authToken');
          setAuthToken(null); // Clear token state
          return; // Don't attempt to connect with an expired token
        }
        // Token is valid or doesn't have an expiration, proceed with connection
        console.log('SocketContext: Auth token found and valid, attempting to connect...');
      } catch (error) {
        console.error('SocketContext: Failed to decode token. Clearing token.', error);
        AsyncStorage.removeItem('authToken');
        setAuthToken(null); // Clear token state
        return; // Don't attempt to connect with an invalid token
      }

      // Initialize socket connection with auth token
      const newSocket = io(SOCKET_URL, {
        auth: {
          token: authToken,
        },
        // Optional: Add reconnection options if needed
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      setSocket(newSocket);

      newSocket.on('connect', () => {
        console.log('SocketContext: Connected successfully!', newSocket.id);
        setIsConnected(true);
      });

      newSocket.on('disconnect', (reason) => {
        console.log('SocketContext: Disconnected.', reason);
        setIsConnected(false);
        // Handle specific disconnect reasons if necessary
        if (reason === 'io server disconnect') {
          // The server forcefully disconnected the socket (e.g., auth error after connect)
          // Might want to clear token and redirect to login here
          console.error('SocketContext: Server disconnected socket.');
          // AsyncStorage.removeItem('authToken'); // Example: clear token
          // router.replace('/login'); // Example: redirect
        }
      });

      newSocket.on('connect_error', (error) => {
        console.error('SocketContext: Connection Error:', error.message);
        setIsConnected(false);
        // Handle specific errors, e.g., invalid token during handshake
        if (error.message.includes('Invalid token')) {
           console.error('SocketContext: Auth token is invalid. Clearing token.');
           AsyncStorage.removeItem('authToken');
           setAuthToken(null); // Clear token state to prevent reconnection attempts
           // Optionally redirect to login
           // router.replace('/login');
        }
      });

      // Cleanup function to disconnect socket when component unmounts or token changes
      return () => {
        console.log('SocketContext: Disconnecting socket...');
        newSocket.disconnect();
        setSocket(null);
        setIsConnected(false);
      };
    } else {
      // No token, ensure socket is disconnected and state is cleared
      if (socket) {
        console.log('SocketContext: Auth token removed, disconnecting existing socket.');
        socket.disconnect();
        setSocket(null);
        setIsConnected(false);
      }
    }
  }, [authToken]); // Re-run effect if authToken changes

  // Function to update the auth token state
  const updateAuthToken = (token: string | null) => {
    setAuthToken(token);
  };

  // Memoize the context value to prevent unnecessary re-renders
  const contextValue = useMemo(() => ({
    socket,
    isConnected,
    updateAuthToken, // Expose the update function
  }), [socket, isConnected]); // Dependency array doesn't need updateAuthToken as it's stable

  return (
    <SocketContext.Provider value={contextValue}>
      {children}
    </SocketContext.Provider>
  );
};
