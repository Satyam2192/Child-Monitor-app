import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode, JwtPayload } from 'jwt-decode';
import { io, Socket } from 'socket.io-client';

export const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';
const SOCKET_URL = 'https://flashgo.onrender.com'; // Ensure this matches context

// Define the expected structure of the decoded JWT payload for role check
interface DecodedToken extends JwtPayload {
  userId: number;
  username: string;
  role: 'parent' | 'child';
}

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  const now = new Date();
  console.log(`[${now.toISOString()}] Running BACKGROUND_LOCATION_TASK...`);

  if (error) {
    console.error('[Background Location Task] Error received:', error.message);
    return;
  }

  const locations = (data as any)?.locations as Location.LocationObject[];
  if (!locations || locations.length === 0) {
    console.log('[Background Location Task] No locations received.');
    return;
  }

  // Process the latest location
  const latestLocation = locations[locations.length - 1];
  console.log('[Background Location Task] Latest location:', latestLocation.coords.latitude, latestLocation.coords.longitude, `Timestamp: ${latestLocation.timestamp}`);

  let tempSocket: Socket | null = null; // Use a temporary socket for this task run

  try {
    const authToken = await AsyncStorage.getItem('authToken');
    if (!authToken) {
      console.log('[Background Location Task] No auth token found. Cannot send location.');
      return;
    }

    // Check token validity and role
    let decoded: DecodedToken;
    try {
      decoded = jwtDecode<DecodedToken>(authToken);
      if (decoded.exp && decoded.exp * 1000 < Date.now()) {
        console.log('[Background Location Task] Auth token expired.');
        // Optionally clear token here if desired, but might interfere with foreground app
        // await AsyncStorage.removeItem('authToken');
        return;
      }
      if (decoded.role !== 'child') {
        console.log('[Background Location Task] User role is not child. Stopping task.');
        // Stop the location updates if the role is wrong
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        return;
      }
    } catch (decodeError) {
      console.error('[Background Location Task] Failed to decode token.', decodeError);
      // Optionally clear token
      // await AsyncStorage.removeItem('authToken');
      return;
    }

    // Token is valid and role is child, attempt to connect and send
    console.log('[Background Location Task] Token valid, attempting temporary socket connection...');
    tempSocket = io(SOCKET_URL, {
      auth: { token: authToken },
      reconnection: false, // Don't attempt reconnection for this short-lived task
      timeout: 5000, // Short timeout
      transports: ['websocket'] // Prefer websocket for potentially faster connection/disconnection
    });

    tempSocket.on('connect', () => {
      console.log('[Background Location Task] Temporary socket connected:', tempSocket?.id);
      console.log('[Background Location Task] Sending location...');
      tempSocket?.emit('send_location', {
        latitude: latestLocation.coords.latitude,
        longitude: latestLocation.coords.longitude,
        timestamp: latestLocation.timestamp,
      });

      // Disconnect shortly after sending
      setTimeout(() => {
        console.log('[Background Location Task] Disconnecting temporary socket after send.');
        tempSocket?.disconnect();
      }, 1000); // Wait 1 second after connect to ensure emit goes through
    });

    tempSocket.on('connect_error', (err) => {
      console.error('[Background Location Task] Temporary socket connection error:', err.message);
      tempSocket?.disconnect(); // Ensure cleanup
    });

    tempSocket.on('disconnect', (reason) => {
      console.log('[Background Location Task] Temporary socket disconnected:', reason);
    });

  } catch (taskError) {
    console.error('[Background Location Task] Error during task execution:', taskError);
    tempSocket?.disconnect(); // Ensure cleanup on any error
  }
});

// Note: Registration/Unregistration will be handled in child.tsx now using Location API
