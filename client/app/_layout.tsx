import { Stack, router } from "expo-router"; // Import router
import React, { useEffect, useRef } from "react"; // Add useEffect, useRef
import "./globals.css"; // Ensure Tailwind is imported
import { SocketProvider } from "../context/SocketContext"; // Import the provider
import * as Notifications from 'expo-notifications'; // Import notifications
import { Platform } from 'react-native'; // Import Platform

// --- Notification Handler Setup ---
// Determines how notifications are handled when received while the app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, // Show an alert banner
    shouldPlaySound: true, // Play a sound
    shouldSetBadge: false, // Don't modify the app icon badge count (manage this server-side if needed)
  }),
});

export default function RootLayout() {
  const notificationListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();

  useEffect(() => {
    // --- Listener for user tapping on a notification ---
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('Notification Response Received:', response);
      const data = response.notification.request.content.data;
      // Example: Navigate if specific data is present
      if (data?.screen === 'parent') {
        // Check if user is logged in before navigating?
        // Might need access to auth state here or handle in parent screen itself
        console.log('Notification tapped, navigating to parent screen...');
        router.push('/parent');
      } else if (data?.url) {
         // Example: Open a URL if provided
         // Linking.openURL(data.url);
      }
      // Add more handling based on your notification data structure
    });

    // --- Listener for notifications received while app is foregrounded ---
    // (Handled by setNotificationHandler above, but you could add custom logic here too)
    // notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
    //   console.log('Notification Received (Foreground):', notification);
    //   // You could update state here based on the notification content
    // });


    // Cleanup listeners on unmount
    return () => {
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
      // if (notificationListener.current) {
      //   Notifications.removeNotificationSubscription(notificationListener.current);
      // }
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
