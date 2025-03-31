import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Define your backend URL (use the same constant as login/register)
const SOCKET_URL = 'http://192.168.1.13:7000'; // Use your computer's local IP and CORRECT PORT

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
}

// Create the context with a default value
const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
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
      console.log('SocketContext: Auth token found, attempting to connect...');
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

  // Memoize the context value to prevent unnecessary re-renders
  const contextValue = useMemo(() => ({
    socket,
    isConnected,
  }), [socket, isConnected]);

  return (
    <SocketContext.Provider value={contextValue}>
      {children}
    </SocketContext.Provider>
  );
};
