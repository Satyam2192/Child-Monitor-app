import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = 'https://flashgo.onrender.com'; // Ensure this matches
const PUSH_ENDPOINT = `${API_URL}/api/user/push-token`; // **Backend endpoint needed**

// --- Android Channel Setup ---
// Required for Android 8.0+
if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('default', {
    name: 'default',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF231F7C',
  });
}

// --- Permission Request & Token Retrieval ---
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  let token: string | null = null;

  if (!Device.isDevice) {
    Alert.alert('Error', 'Must use physical device for Push Notifications');
    return null;
  }

  // Check existing permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // Request permissions if not granted
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  // Handle permission denial
  if (finalStatus !== 'granted') {
    Alert.alert('Permission Required', 'Failed to get push token for push notification! Please enable notifications in your settings.');
    return null;
  }

  // Get the Expo Push Token
  try {
    // *** IMPORTANT: Replace 'your-project-id' with your actual Expo project ID ***
    // You can find this in your app.json or app.config.js under expo.extra.eas.projectId
    // Or run `npx expo config --json | jq -r .extra.eas.projectId` in your project directory
    const projectId = '047f2de2-c3a9-4cf7-b09e-9171b2a02e5a'; // <-- Project ID Set
    // Removed redundant check for placeholder ID

    const pushTokenData = await Notifications.getExpoPushTokenAsync({
      projectId: projectId, // Use the project ID
    });
    token = pushTokenData.data;
    console.log('Expo Push Token:', token);

    // Send the token to your backend
    await sendTokenToBackend(token);

  } catch (error) {
    console.error('Error getting push token:', error);
    Alert.alert('Error', 'Failed to retrieve push token.');
    return null;
  }

  return token;
}

// --- Send Token to Backend ---
async function sendTokenToBackend(token: string) {
  try {
    const authToken = await AsyncStorage.getItem('authToken');
    if (!authToken) {
      console.warn('Cannot send push token to backend: User not logged in.');
      return;
    }

    console.log(`Sending push token to backend: ${PUSH_ENDPOINT}`);
    const response = await fetch(PUSH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`, // Assuming backend needs auth
      },
      body: JSON.stringify({ pushToken: token }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server error ${response.status}: ${errorText}`);
    }

    console.log('Push token successfully sent to backend.');

  } catch (error) {
    console.error('Failed to send push token to backend:', error);
    // Optionally alert the user or retry later
    // Alert.alert('Sync Error', 'Could not register device for notifications. Please try logging in again later.');
  }
}

// --- Notification Handlers (Setup in _layout.tsx) ---
// It's generally better to set these up in your root component (_layout.tsx)
// export function setupNotificationHandlers() {
//   // Handle notifications received while app is foregrounded
//   Notifications.setNotificationHandler({
//     handleNotification: async () => ({
//       shouldShowAlert: true,
//       shouldPlaySound: true,
//       shouldSetBadge: false,
//     }),
//   });

//   // Handle user interaction with notifications (tap)
//   const subscription = Notifications.addNotificationResponseReceivedListener(response => {
//     console.log('Notification tapped:', response.notification.request.content.data);
//     // Navigate or perform action based on notification data
//     // Example: const locationData = response.notification.request.content.data.location;
//   });

//   return () => {
//     Notifications.removeNotificationSubscription(subscription);
//   };
// }
