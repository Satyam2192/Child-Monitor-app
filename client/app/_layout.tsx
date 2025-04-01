import { Stack } from "expo-router";
import React from "react"; // Removed useEffect
import "./globals.css"; // Ensure Tailwind is imported
import { SocketProvider } from "../context/SocketContext"; // Import the provider
// Removed import for registerBackgroundSocketTask

export default function RootLayout() {
  // Background task registration moved to login success

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
