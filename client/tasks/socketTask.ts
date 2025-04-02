import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode, JwtPayload } from 'jwt-decode';

export const BACKGROUND_SOCKET_TASK = 'BACKGROUND_FETCH_LOCATION_TASK'; // Renamed for clarity
const API_URL = 'https://flashgo.onrender.com'; // Ensure this matches your API URL
const LAST_LOCATION_STORAGE_KEY = 'lastFetchedChildLocation';

// Define the expected structure of the decoded JWT payload for role check
interface DecodedToken extends JwtPayload {
  userId: number;
  username: string;
  role: 'parent' | 'child';
}

TaskManager.defineTask(BACKGROUND_SOCKET_TASK, async () => {
  const now = new Date();
  console.log(`[${now.toISOString()}] Running ${BACKGROUND_SOCKET_TASK}...`);

  try {
    const authToken = await AsyncStorage.getItem('authToken');

    if (!authToken) {
      console.log(`[${BACKGROUND_SOCKET_TASK}] No auth token found. Stopping task.`);
      // Optionally unregister task if token is permanently gone?
      // await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SOCKET_TASK);
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // Check token validity and role
    let decoded: DecodedToken;
    try {
      decoded = jwtDecode<DecodedToken>(authToken);
      if (decoded.exp && decoded.exp * 1000 < Date.now()) {
        console.log(`[${BACKGROUND_SOCKET_TASK}] Auth token expired. Clearing token.`);
        await AsyncStorage.removeItem('authToken');
        await AsyncStorage.removeItem(LAST_LOCATION_STORAGE_KEY); // Clear stale location
        // Optionally unregister task
        // await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SOCKET_TASK);
        return BackgroundFetch.BackgroundFetchResult.NoData;
      }

      // IMPORTANT: This task should only run for the parent
      if (decoded.role !== 'parent') {
        console.log(`[${BACKGROUND_SOCKET_TASK}] User role is not parent (${decoded.role}). Stopping task and unregistering.`);
        await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SOCKET_TASK); // Unregister if role is wrong
        return BackgroundFetch.BackgroundFetchResult.NoData;
      }

    } catch (error) {
      console.error(`[${BACKGROUND_SOCKET_TASK}] Failed to decode token. Clearing token.`, error);
      await AsyncStorage.removeItem('authToken');
      await AsyncStorage.removeItem(LAST_LOCATION_STORAGE_KEY); // Clear stale location
      // Optionally unregister task
      // await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SOCKET_TASK);
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }

    // --- Fetch Child's Last Location (Parent Role Only) ---
    console.log(`[${BACKGROUND_SOCKET_TASK}] Parent user detected. Fetching child's last location...`);
    try {
      // *** ASSUMPTION: Replace with your actual API endpoint ***
      const response = await fetch(`${API_URL}/api/child/last-location`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        // Handle non-2xx responses (e.g., 404 Not Found, 401 Unauthorized, 500 Server Error)
        const errorText = await response.text();
        console.error(`[${BACKGROUND_SOCKET_TASK}] Failed to fetch location. Status: ${response.status}, Body: ${errorText}`);
        // Decide if this is a permanent failure (e.g., 401 might mean token is bad -> clear?)
        // For now, just report failure for this run
        return BackgroundFetch.BackgroundFetchResult.Failed;
      }

      const locationData = await response.json();

      if (locationData && locationData.latitude && locationData.longitude) {
        console.log(`[${BACKGROUND_SOCKET_TASK}] Successfully fetched location:`, locationData);
        // Store the fetched location data
        await AsyncStorage.setItem(LAST_LOCATION_STORAGE_KEY, JSON.stringify(locationData));
        return BackgroundFetch.BackgroundFetchResult.NewData; // Indicate new data was fetched
      } else {
        console.log(`[${BACKGROUND_SOCKET_TASK}] Fetched data is missing location details.`);
        // Maybe the child hasn't sent location yet? Treat as NoData for this run.
        return BackgroundFetch.BackgroundFetchResult.NoData;
      }

    } catch (fetchError) {
      console.error(`[${BACKGROUND_SOCKET_TASK}] Error fetching child location:`, fetchError);
      return BackgroundFetch.BackgroundFetchResult.Failed; // Network error or other issue
    }

  } catch (error) {
    console.error(`[${BACKGROUND_SOCKET_TASK}] General error during task execution:`, error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// Helper function to register the task (call this from your app for the PARENT)
export async function registerBackgroundSocketTask() { // Keep name consistent with login.tsx call
  try {
    // Unregister previous task definition if name changed, just in case
    // await BackgroundFetch.unregisterTaskAsync('BACKGROUND_SOCKET_TASK');

    await BackgroundFetch.registerTaskAsync(BACKGROUND_SOCKET_TASK, {
      minimumInterval: 15 * 60, // Run approx every 15 minutes (OS decides exact timing)
      stopOnTerminate: false, // Keep task registered after app termination (iOS specific)
      startOnBoot: true, // Register task on device boot (Android specific)
    });
    console.log(`Background fetch task '${BACKGROUND_SOCKET_TASK}' registered successfully.`);
  } catch (error) {
    console.error(`Failed to register background fetch task '${BACKGROUND_SOCKET_TASK}':`, error);
  }
}

// Helper function to unregister the task (e.g., on logout for the PARENT)
export async function unregisterBackgroundSocketTask() { // Keep name consistent
    try {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SOCKET_TASK);
        if (isRegistered) {
            await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SOCKET_TASK);
            console.log(`Background fetch task '${BACKGROUND_SOCKET_TASK}' unregistered successfully.`);
            // Clear last fetched location on logout
            await AsyncStorage.removeItem(LAST_LOCATION_STORAGE_KEY);
        } else {
             console.log(`Background fetch task '${BACKGROUND_SOCKET_TASK}' was not registered.`);
        }
    } catch (error) {
        console.error(`Failed to unregister background fetch task '${BACKGROUND_SOCKET_TASK}':`, error);
    }
}
