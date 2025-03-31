import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { router, useRootNavigationState } from "expo-router"; // Import useRootNavigationState
import AsyncStorage from '@react-native-async-storage/async-storage'; // Correct the import path
import { jwtDecode } from "jwt-decode"; // Corrected import name

// Define the expected structure of the decoded JWT payload
// interface DecodedToken {
//   userId: number;
//   username: string;
//   role: 'parent' | 'child';
//   iat: number; // Issued at timestamp
//   exp: number; // Expiration timestamp
interface DecodedToken {
  userId: number;
  username: string;
  role: 'parent' | 'child';
  iat: number; // Issued at timestamp
  exp: number; // Expiration timestamp
}

export default function Index() {
  const [loading, setLoading] = useState(true);
  const rootNavigationState = useRootNavigationState(); // Get navigation state

  useEffect(() => {
    // Wait until navigation is ready before checking auth
    if (!rootNavigationState?.key) {
      console.log("Navigation not ready yet...");
      return; // Exit early if navigation isn't ready
    }
    console.log("Navigation ready, checking auth status...");

    const checkAuthStatus = async () => {
      try {
        const token = await AsyncStorage.getItem("authToken");
        if (token) {
          const decoded = jwtDecode<DecodedToken>(token);
          // Optional: Check token expiration
          const currentTime = Date.now() / 1000; // Convert to seconds
          if (decoded.exp < currentTime) {
            console.log("Token expired, redirecting to login.");
            await AsyncStorage.removeItem("authToken"); // Clear expired token
            router.replace("/login");
          } else {
            // Token is valid, redirect based on role
            console.log(`Token valid for ${decoded.role} ${decoded.username}, redirecting...`);
            if (decoded.role === "parent") {
              router.replace("/parent");
            } else if (decoded.role === "child") {
              router.replace("/child");
            } else {
              // Fallback if role is unexpected
              console.warn("Unexpected role found in token:", decoded.role);
              router.replace("/login");
            }
          }
        } else {
          // No token found
          console.log("No token found, redirecting to login.");
          router.replace("/login");
        }
      } catch (error) {
        console.error("Error checking auth status:", error);
        // Fallback to login screen on any error
        try { // Add inner try/catch for safety during error handling
            await AsyncStorage.removeItem("authToken"); // Clear potentially corrupted token
        } catch (removeError) {
            console.error("Failed to remove token during error handling:", removeError);
        }
        router.replace("/login");
      } finally {
        // Ensure loading is set to false only after attempting navigation
        setLoading(false);
        console.log("Auth check complete, loading set to false.");
      }
    };

    checkAuthStatus();
  }, [rootNavigationState?.key]); // Rerun when navigation becomes ready

  // Show loading indicator until navigation is ready AND auth check is complete
  if (!rootNavigationState?.key || loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#0000ff" />
      </View>
    );
  }

  // Render nothing while redirecting (after loading and navigation are ready)
  return null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
