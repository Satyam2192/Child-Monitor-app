import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Alert, AppState, AppStateStatus, Platform, Button, ActivityIndicator, NativeModules } from 'react-native'; // Added NativeModules
import * as Location from 'expo-location';
import { router, Href } from 'expo-router'; // Added router and Href
// import { CameraView, useCameraPermissions } from 'expo-camera'; // Removed Camera import
// import { Audio } from 'expo-av'; // Keep Audio import commented
import { PermissionStatus } from 'expo-modules-core'; // Import PermissionStatus
import { useSocket } from '../context/SocketContext'; // Import the custom hook
import AsyncStorage from '@react-native-async-storage/async-storage'; // Import AsyncStorage
import { jwtDecode } from 'jwt-decode'; // Import jwtDecode
import { registerForPushNotificationsAsync } from '../utils/notifications'; // Import the push notification registration function
// Removed child background task unregister import
// import { BACKGROUND_LOCATION_TASK } from '../tasks/locationTask'; // REMOVED location task import

// Define the expected structure of the decoded JWT payload
interface DecodedToken {
  userId: number;
  username: string;
  role: 'parent' | 'child';
  iat: number;
  exp: number;
}

export default function ChildScreen() {
  const { socket, isConnected } = useSocket(); // Get socket and connection status
  const [locationPermissionStatus, setLocationPermissionStatus] = useState<Location.PermissionStatus | null>(null);
  // Use the hooks for permissions
  // const [cameraPermission, requestCameraPermission] = useCameraPermissions(); // Removed Camera permission hook
  /* const [audioPermissionStatus, setAudioPermissionStatus] = useState<PermissionStatus | null>(null); */ // Comment out audio state
  // const [isTrackingLocation, setIsTrackingLocation] = useState(false); // Removed foreground tracking state
  // const [isStreamingCamera, setIsStreamingCamera] = useState(false); // Removed Camera state
  /* const [isStreamingAudio, setIsStreamingAudio] = useState(false); */ // Comment out audio state
  // const locationSubscription = useRef<Location.LocationSubscription | null>(null); // Removed foreground tracking ref
  // const cameraInterval = useRef<NodeJS.Timeout | null>(null); // Removed Camera ref
  /* const audioRecording = useRef<Audio.Recording | null>(null); */ // Comment out audio ref
  const appState = useRef(AppState.currentState);
  // const cameraRef = useRef<CameraView>(null); // Removed Camera ref
  const [userInfo, setUserInfo] = useState<DecodedToken | null>(null); // State for decoded token
  const [connectionCode, setConnectionCode] = useState<string | null>(null); // State for connection code

  // --- Effect to load user info from token ---
  useEffect(() => {
    const loadUserInfo = async () => {
      try {
        const token = await AsyncStorage.getItem('authToken');
        if (token) {
          const decoded = jwtDecode<DecodedToken>(token);
          setUserInfo(decoded);
          console.log("User info loaded:", decoded.username, decoded.userId);
        } else {
          console.log("No auth token found for user info.");
        }
      } catch (error) {
        console.error("Error decoding token for user info:", error);
      }
    };
    loadUserInfo();
  }, []); // Run once on mount

  // --- Permission Handling ---
  useEffect(() => {
    const requestPermissions = async () => {
      console.log("Requesting permissions (Location)..."); // Removed Camera/Audio from log

      // --- Location ---
      try {
          const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
          setLocationPermissionStatus(foregroundStatus);
          if (foregroundStatus !== 'granted') {
            Alert.alert('Permission Denied', 'Foreground location permission is required.');
          } else {
              console.log("Foreground location permission granted. Requesting background...");
              const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
              if (backgroundStatus !== 'granted') {
                  Alert.alert('Permission Warning', 'Background location permission recommended but not granted. Tracking will only work when app is open.');
                  // Don't start the native service if background permission isn't granted
              } else {
                  console.log("Background location permission granted. Starting native foreground service...");
                  // Start native foreground service using the bridge
                  try {
                      const result = await NativeModules.LocationModule.startTrackingService();
                      console.log("Native service start result:", result);
                  } catch (e: any) {
                      console.error("Failed to start native location service:", e);
                      Alert.alert("Service Error", `Failed to start location tracking: ${e.message}`);
                  }
              }
          }
      } catch (err: any) {
          console.error("Error requesting location permissions:", err);
          Alert.alert("Error", "Could not request location permissions.");
          // Consider if we should return here if location fails critically
      }
      console.log("Location permission checks completed."); // Log after location checks

      // --- Camera (Removed) ---
      /*
      try {
          const cameraPermResponse = await requestCameraPermission();
          if (!cameraPermResponse.granted) {
            Alert.alert('Permission Denied', 'Camera permission is required.');
          } else {
            console.log("Camera permission granted.");
          }
      } catch (err) {
          console.error("Error requesting camera permissions:", err);
          Alert.alert("Error", "Could not request camera permissions.");
      }
      */

       // --- Audio (Commented Out) ---
       /*
       try {
           const audioPermResponse = await Audio.requestPermissionsAsync();
           setAudioPermissionStatus(audioPermResponse.status);
           if (audioPermResponse.status !== 'granted') {
               Alert.alert('Permission Denied', 'Microphone permission is required to share audio.');
           } else {
               console.log("Audio permission granted.");
               await Audio.setAudioModeAsync({
                   allowsRecordingIOS: true,
                   playsInSilentModeIOS: true,
               });
               console.log("Audio mode configured for recording.");
           }
       } catch (err) {
           console.error("Error requesting audio permissions or setting mode:", err);
           Alert.alert("Error", "Could not request audio permissions.");
       }
       */

      // --- Register for Push Notifications ---
      console.log("Proceeding to register for push notifications..."); // Log before attempting registration
      try {
          const pushToken = await registerForPushNotificationsAsync(); // Call the registration function
          if (pushToken) {
              console.log("Push notification registration successful, token sent to backend:", pushToken);
          } else {
              console.warn("Push notification registration returned null token.");
              // Alert might have already been shown in the function itself
          }
      } catch (pushError) {
          console.error("Error during push notification registration call:", pushError);
          Alert.alert("Notification Error", "Could not register for push notifications.");
      }
      console.log("Push notification registration attempt finished."); // Log after attempt
    };

    requestPermissions();
  }, []); // Empty dependency array ensures this runs only once on mount

  // --- Removed Foreground Location Tracking Logic ---
  // The background task (startLocationUpdatesAsync) handles sending location
  // updates in both foreground and background.


  // --- Socket Event Listeners for Location Refresh ---
  useEffect(() => {
    if (socket && isConnected) {
        const handleGetCurrentLocation = async () => {
            console.log("Received get_current_location command from server.");
            if (locationPermissionStatus === 'granted') {
                try {
                    const location = await Location.getCurrentPositionAsync({
                        accuracy: Location.Accuracy.High, // Get a single high-accuracy reading
                    });
                    console.log('Sending current location:', location.coords.latitude, location.coords.longitude);
                    socket.emit('send_location', {
                        latitude: location.coords.latitude,
                        longitude: location.coords.longitude,
                        timestamp: location.timestamp,
                    });
                } catch (error) {
                    console.error("Error getting current location:", error);
                }
            } else {
                 console.warn("Cannot get current location: permission not granted.");
            }
        };

        socket.on('get_current_location', handleGetCurrentLocation);

        // Cleanup listeners on disconnect or unmount
        return () => {
            console.log("Cleaning up location refresh listener.");
            socket.off('get_current_location', handleGetCurrentLocation);
        };
    }
  }, [socket, isConnected, locationPermissionStatus]); // Add locationPermissionStatus dependency


  // --- Socket Event Listener for Connection Code ---
  useEffect(() => {
      if (socket && isConnected) {
          const handleReceiveCode = (data: { code: string }) => {
              console.log("Received connection code:", data.code);
              setConnectionCode(data.code);
          };

           // Set up listener first
           socket.on('receive_connection_code', handleReceiveCode);

           // Then request the code from the server
           console.log("Child requesting connection code from server...");
           socket.emit('request_connection_code');

           // Optional fallback timer removed as client now explicitly requests
           // const timer = setTimeout(() => {
          //     if (!connectionCode && socket.connected) {
          //         console.log("Requesting connection code manually...");
          //         socket.emit('request_connection_code');
          //     }
          // }, 3000);


          return () => {
              console.log("Cleaning up connection code listener.");
              socket.off('receive_connection_code', handleReceiveCode);
              // clearTimeout(timer);
          };
      } else {
          // Reset code if disconnected
          setConnectionCode(null);
      }
  }, [socket, isConnected]); // Re-run if socket or connection status changes


  // --- Removed startLocationTracking and stopLocationTracking functions ---


  // --- Removed start/stopCameraStreaming ---
  /*
  const startCameraStreaming = () => { ... };
  const stopCameraStreaming = () => { ... };
  */

  // --- Removed start/stopAudioStreaming ---
  /*
  const startAudioStreaming = async () => { ... };
  const stopAudioStreaming = async () => { ... };
  */


   // --- App State Handling (Optional but good for background) ---
   useEffect(() => {
    const subscription = AppState.addEventListener('change', _handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, []);

  const _handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (
      appState.current.match(/inactive|background/) &&
      nextAppState === 'active'
    ) {
      console.log('App has come to the foreground!');
    } else if (nextAppState.match(/inactive|background/)) {
        console.log('App has gone to the background/inactive.');
    }
    appState.current = nextAppState;
    console.log('AppState', appState.current);
  };

  // --- Logout Handler ---
  const handleLogout = async () => {
    console.log("Child logging out...");
    // Stop foreground tracking removed
    // Disconnect foreground socket
    if (socket) {
        socket.disconnect();
    }
    // Stop native background location service
    try {
        const result = await NativeModules.LocationModule.stopTrackingService();
        console.log("Native service stop result:", result);
    } catch (e: any) {
        console.error("Failed to stop native location service:", e);
        // Proceed with logout anyway, but log the error
    }
    // Clear auth token from AsyncStorage
    await AsyncStorage.removeItem('authToken');
    // Clear auth token from native SharedPreferences
    try {
        await NativeModules.AuthStorageModule.clearAuthToken();
        console.log("Native auth token cleared.");
    } catch (e: any) {
        console.error("Failed to clear native auth token:", e);
    }
    // Clear connection code state
    setConnectionCode(null);
    // Navigate to login screen
    router.replace('/login' as Href); // Use Href type assertion
  };


  return (
    <View style={styles.container} className="bg-gray-100 p-5">
      <Text style={styles.title} className="text-2xl font-bold text-green-700 mb-2">Child Mode Active</Text>
      <Text className="text-lg font-semibold mb-1">Username: <Text className="font-bold">{userInfo?.username ?? 'Loading...'}</Text></Text>
      <Text className="text-base mb-4">Your User ID: <Text className="font-bold">{userInfo?.userId ?? '...'}</Text></Text>

      {/* Connection Code Block */}
      <View className="w-full p-4 bg-blue-100 border border-blue-300 rounded-lg shadow mb-4 items-center">
          <Text className="text-lg font-semibold mb-2 text-blue-800">Your Connection Code</Text>
          {connectionCode ? (
              <Text selectable={true} className="text-3xl font-bold text-blue-900 tracking-widest bg-white px-3 py-1 rounded border border-blue-200">{connectionCode}</Text>
          ) : (
              <View className="flex-row items-center">
                  <ActivityIndicator size="small" color="#1E40AF" />
                  <Text className="ml-2 text-blue-700">Waiting for code...</Text>
              </View>
          )}
          <Text className="text-sm text-center mt-2 text-blue-700">Give this code to your parent to link accounts.</Text>
      </View>

      {/* Status block */}
      <View className="w-full p-4 bg-white rounded-lg shadow mb-4">
        <Text className="text-lg font-semibold mb-2">Status:</Text>
        <Text>Username: <Text className="font-bold">{userInfo?.username ?? 'Loading...'}</Text></Text>
         <Text>Socket Connected: <Text className={isConnected ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>{isConnected ? 'Yes' : 'No'}</Text></Text>
         <Text>Location Permission: <Text className={locationPermissionStatus === 'granted' ? 'text-green-600' : 'text-red-600'}>{locationPermissionStatus || 'Checking...'}</Text></Text>
         {/* Removed foreground tracking status text */}
         {/* Removed Camera/Audio Status */}
      </View>

      {/* Removed QR Code Section */}
      {/* Removed Camera Preview */}
      {/* Removed Features section */}

      <View className="w-full p-4 bg-white rounded-lg shadow mt-4">
         <Text className="text-lg font-semibold mb-2">Info:</Text>
         <Text className="text-gray-600">Location updates are sent automatically.</Text>
         <Text className="text-gray-600">Parent can request a manual location refresh.</Text>
      </View>

      {/* Logout Button */}
      <View className="mt-6 w-full">
        <Button title="Logout" onPress={handleLogout} color="red" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    // Base styles if needed
  },
  // Removed camera styles
});
