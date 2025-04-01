import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode, JwtPayload } from 'jwt-decode';
import { io, Socket } from 'socket.io-client';

export const BACKGROUND_SOCKET_TASK = 'BACKGROUND_SOCKET_TASK';
const SOCKET_URL = 'https://flashgo.onrender.com'; // Ensure this matches your context

let backgroundSocket: Socket | null = null; // Keep a reference if needed

TaskManager.defineTask(BACKGROUND_SOCKET_TASK, async () => {
  const now = new Date();
  console.log(`[${now.toISOString()}] Running background socket task...`);

  // Optimization: Check if socket is already connected and healthy
  if (backgroundSocket?.connected) {
    console.log('[Background Task] Socket already connected. Exiting task early.');
    // Optional: Implement a lightweight ping to server if required to keep connection alive
    // backgroundSocket.emit('ping');
    return BackgroundFetch.BackgroundFetchResult.NoData; // No significant change needed
  }

  console.log('[Background Task] Socket not connected or instance lost. Proceeding with connection logic.');
  try {
    const authToken = await AsyncStorage.getItem('authToken');

    if (!authToken) {
      console.log('[Background Task] No auth token found. Stopping task.');
      // Disconnect if socket exists from a previous run
      if (backgroundSocket?.connected) {
        backgroundSocket.disconnect();
        backgroundSocket = null;
      }
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // Check token validity
    try {
      const decoded = jwtDecode<JwtPayload>(authToken);
      if (decoded.exp && decoded.exp * 1000 < Date.now()) {
        console.log('[Background Task] Auth token expired. Clearing token.');
        await AsyncStorage.removeItem('authToken');
        if (backgroundSocket?.connected) {
          backgroundSocket.disconnect();
          backgroundSocket = null;
        }
        return BackgroundFetch.BackgroundFetchResult.NoData;
      }
    } catch (error) {
      console.error('[Background Task] Failed to decode token. Clearing token.', error);
      await AsyncStorage.removeItem('authToken');
      if (backgroundSocket?.connected) {
        backgroundSocket.disconnect();
        backgroundSocket = null;
      }
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }

    // If socket exists and is connected, maybe just return? Or add a ping?
    // For simplicity, we'll try connecting if not already connected.
    if (!backgroundSocket || !backgroundSocket.connected) {
      console.log('[Background Task] Token valid, attempting to connect/reconnect socket...');

      // Disconnect previous instance if it exists but isn't connected properly
      if (backgroundSocket) {
        backgroundSocket.disconnect();
      }

      backgroundSocket = io(SOCKET_URL, {
        auth: { token: authToken },
        reconnectionAttempts: 3, // Limit background attempts
        timeout: 5000, // Shorter timeout for background
      });

      backgroundSocket.on('connect', () => {
        console.log('[Background Task] Socket connected successfully:', backgroundSocket?.id);
        // Potentially unregister task if connection is stable? Or rely on interval.
      });

      backgroundSocket.on('connect_error', (error) => {
        console.error('[Background Task] Socket connection error:', error.message);
        // Don't clear token here, let the next run handle expiration/validity
        backgroundSocket?.disconnect(); // Ensure cleanup
        backgroundSocket = null;
      });

      backgroundSocket.on('disconnect', (reason) => {
        console.log('[Background Task] Socket disconnected:', reason);
        backgroundSocket = null; // Clear reference on disconnect
      });

      // Give it a moment to connect - TaskManager might kill the process quickly
      // A more robust solution might involve keeping the task alive longer if needed,
      // but that's more complex (e.g., foreground service on Android).
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds

      if (backgroundSocket?.connected) {
         console.log('[Background Task] Socket seems connected after wait.');
         return BackgroundFetch.BackgroundFetchResult.NewData; // Indicate success
      } else {
         console.log('[Background Task] Socket did not connect within wait time.');
         backgroundSocket?.disconnect(); // Clean up attempt
         backgroundSocket = null;
         return BackgroundFetch.BackgroundFetchResult.Failed;
      }

    } else {
      console.log('[Background Task] Socket already connected.');
      // Optionally add a ping event here to verify connection health
      return BackgroundFetch.BackgroundFetchResult.NoData; // No change needed
    }

  } catch (error) {
    console.error('[Background Task] Error during task execution:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// Helper function to register the task (call this from your app)
export async function registerBackgroundSocketTask() {
  try {
    await BackgroundFetch.registerTaskAsync(BACKGROUND_SOCKET_TASK, {
      minimumInterval: 15 * 60, // Run every 15 minutes (minimum allowed)
      stopOnTerminate: false, // Keep running even if app is terminated (iOS only)
      startOnBoot: true, // Restart task on device boot (Android only)
    });
    console.log('Background socket task registered successfully.');
  } catch (error) {
    console.error('Failed to register background socket task:', error);
  }
}

// Helper function to unregister the task (e.g., on logout)
export async function unregisterBackgroundSocketTask() {
    try {
        await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SOCKET_TASK);
        console.log('Background socket task unregistered successfully.');
        if (backgroundSocket?.connected) {
            backgroundSocket.disconnect();
            backgroundSocket = null;
        }
    } catch (error) {
        console.error('Failed to unregister background socket task:', error);
    }
}
