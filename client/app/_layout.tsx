import { Stack, router } from "expo-router";
import React, { useEffect, useRef } from "react";
import "./globals.css";
import { SocketProvider } from "../context/SocketContext";
import * as Notifications from 'expo-notifications';
import { Platform, AppState, AppStateStatus } from 'react-native'; // Import AppState
import * as Location from 'expo-location'; // Import Location
import AsyncStorage from '@react-native-async-storage/async-storage'; // Import AsyncStorage
import { jwtDecode, JwtPayload } from 'jwt-decode'; // Import jwtDecode
import { io, Socket } from 'socket.io-client'; // Import socket.io-client

// Define the expected structure of the decoded JWT payload for role check
interface DecodedToken extends JwtPayload {
  userId: number;
  username: string;
  role: 'parent' | 'child';
}

const SOCKET_URL = 'https://flashgo.onrender.com'; // Ensure this matches context

// --- Notification Handler Setup ---
// Determines how notifications are handled when received while the app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, // Show an alert banner
    shouldPlaySound: true, // Play a sound
    shouldSetBadge: false, // Don't modify the app icon badge count (manage this server-side if needed)
  }),
});

// --- Background Notification Action Handler ---
const handleBackgroundNotificationAction = async (notification: Notifications.Notification) => {
    const data = notification.request.content.data;
    console.log('[Background Handler] Received notification with data:', data);

    if (data?.action === 'requestImmediateLocation') {
        console.log('[Background Handler] Action requestImmediateLocation detected.');

        let tempSocket: Socket | null = null; // Temporary socket for this action

        try {
            // 1. Check Location Permissions (might not be strictly necessary if task runs, but good practice)
            const { status } = await Location.getForegroundPermissionsAsync(); // Check foreground as proxy
            if (status !== 'granted') {
                console.warn('[Background Handler] Location permission not granted.');
                return; // Cannot get location
            }

            // 2. Get Current Location
            console.log('[Background Handler] Fetching current location...');
            const location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High, // Request high accuracy
            });
            console.log('[Background Handler] Location fetched:', location.coords.latitude, location.coords.longitude);

            // 3. Get Auth Token
            const authToken = await AsyncStorage.getItem('authToken');
            if (!authToken) {
                console.log('[Background Handler] No auth token found.');
                return;
            }

            // 4. Validate Token (Optional but recommended)
            try {
                const decoded = jwtDecode<DecodedToken>(authToken);
                if (decoded.exp && decoded.exp * 1000 < Date.now()) {
                    console.log('[Background Handler] Auth token expired.');
                    return;
                }
                 // Optional: Check role if needed
                 if (decoded.role !== 'child') {
                    console.log('[Background Handler] User role is not child. Aborting.');
                    return;
                 }
            } catch (decodeError) {
                console.error('[Background Handler] Failed to decode token.', decodeError);
                return;
            }

            // 5. Connect Temporary Socket and Send
            console.log('[Background Handler] Attempting temporary socket connection...');
            tempSocket = io(SOCKET_URL, {
                auth: { token: authToken },
                reconnection: false,
                timeout: 10000, // Slightly longer timeout for background
                transports: ['websocket']
            });

            tempSocket.on('connect', () => {
                console.log('[Background Handler] Temporary socket connected:', tempSocket?.id);
                console.log('[Background Handler] Sending immediate location...');
                tempSocket?.emit('send_location', {
                    latitude: location.coords.latitude,
                    longitude: location.coords.longitude,
                    timestamp: location.timestamp,
                });

                // Disconnect shortly after sending
                setTimeout(() => {
                    console.log('[Background Handler] Disconnecting temporary socket after send.');
                    tempSocket?.disconnect();
                }, 1500); // Slightly longer wait
            });

            tempSocket.on('connect_error', (err) => {
                console.error('[Background Handler] Temporary socket connection error:', err.message);
                tempSocket?.disconnect();
            });

            tempSocket.on('disconnect', (reason) => {
                console.log('[Background Handler] Temporary socket disconnected:', reason);
            });

        } catch (error) {
            console.error('[Background Handler] Error processing immediate location request:', error);
            tempSocket?.disconnect(); // Ensure cleanup on error
        }
    } else {
        console.log('[Background Handler] Notification received, but no relevant action found.');
    }
};


export default function RootLayout() {
  const notificationListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();
  const appState = useRef(AppState.currentState); // Track app state

  useEffect(() => {
    // --- Listener for user tapping on a notification ---
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('Notification Response Received (User Tapped):', response);
      const data = response.notification.request.content.data;
      // Example: Navigate if user taps notification for parent screen
      if (data?.screen === 'parent') {
        console.log('Notification tapped, navigating to parent screen...');
        router.push('/parent'); // Assuming parent screen is the target
      }
      // Add more handling based on notification data if needed
    });

    // --- Listener for notifications received while app is running (foreground or background) ---
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification Received (App Running):', notification);
      // Check if the app is in the background when the notification is received
      if (appState.current !== 'active') {
          console.log('Notification received while app is in background/inactive.');
          // Attempt to handle the background action immediately
          handleBackgroundNotificationAction(notification);
      } else {
          console.log('Notification received while app is active (foreground). Handler logic might differ or be ignored.');
          // Decide if you want to trigger the location fetch even if app is foreground
          // handleBackgroundNotificationAction(notification); // Uncomment to run even in foreground
      }
    });

    // --- App State Listener ---
    // To help determine if a notification was received while backgrounded
    const appStateSubscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
        console.log(`AppState changed from ${appState.current} to ${nextAppState}`);
        appState.current = nextAppState;
    });


    // Cleanup listeners on unmount
    return () => {
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
      if (notificationListener.current) {
         Notifications.removeNotificationSubscription(notificationListener.current);
      }
      appStateSubscription.remove();
    };
  }, []); // Run only once on mount

  // Ensure no leading/trailing whitespace around SocketProvider
  return (<SocketProvider>
      <Stack screenOptions={{ headerShown: false }}>
        {/* Index route checks auth status */}
        <Stack.Screen name="index" />
      {/* Auth screens */}
      <Stack.Screen name="login" options={{ title: "Login" }} />
      <Stack.Screen name="register" options={{ title: "Register" }} />
      {/* Main app screens (placeholders for now) */}
      <Stack.Screen name="parent" options={{ title: "Parent Dashboard" }} />
      <Stack.Screen name="child" options={{ title: "Child Mode" }} />
      </Stack>
  </SocketProvider>);
}
