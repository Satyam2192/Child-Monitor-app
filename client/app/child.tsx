import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Alert, AppState, AppStateStatus, Platform } from 'react-native';
import * as Location from 'expo-location';
// import { CameraView, useCameraPermissions } from 'expo-camera'; // Removed Camera import
// import { Audio } from 'expo-av'; // Keep Audio import commented
import { PermissionStatus } from 'expo-modules-core'; // Import PermissionStatus
import { useSocket } from '../context/SocketContext'; // Import the custom hook
import AsyncStorage from '@react-native-async-storage/async-storage'; // Import AsyncStorage
import { jwtDecode } from 'jwt-decode'; // Import jwtDecode

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
  const [isTrackingLocation, setIsTrackingLocation] = useState(false); // Renamed for clarity
  // const [isStreamingCamera, setIsStreamingCamera] = useState(false); // Removed Camera state
  /* const [isStreamingAudio, setIsStreamingAudio] = useState(false); */ // Comment out audio state
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  // const cameraInterval = useRef<NodeJS.Timeout | null>(null); // Removed Camera ref
  /* const audioRecording = useRef<Audio.Recording | null>(null); */ // Comment out audio ref
  const appState = useRef(AppState.currentState);
  // const cameraRef = useRef<CameraView>(null); // Removed Camera ref
  const [userInfo, setUserInfo] = useState<DecodedToken | null>(null); // State for decoded token

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
                  Alert.alert('Permission Warning', 'Background location permission recommended but not granted.');
              } else {
                  console.log("Background location permission granted.");
              }
          }
      } catch (err) {
          console.error("Error requesting location permissions:", err);
          Alert.alert("Error", "Could not request location permissions.");
      }

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
    };

    requestPermissions();
  }, []); // Empty dependency array ensures this runs only once on mount

  // --- Location Tracking Logic (Starts automatically if connected) ---
  useEffect(() => {
    let shouldTrackLocation = locationPermissionStatus === 'granted' && isConnected && socket;

    if (shouldTrackLocation) {
        startLocationTracking();
    } else {
        stopLocationTracking();
    }

    // Cleanup function: Stop location tracking when component unmounts or dependencies change
    return () => {
      console.log("Cleanup: Stopping location tracking.");
      stopLocationTracking();
    };
    // Dependencies: Only location permission, connection status, socket instance
  }, [locationPermissionStatus, isConnected, socket]);


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


  const startLocationTracking = async () => {
    if (isTrackingLocation) return;
     console.log("Attempting to start Location.watchPositionAsync...");
    try {
        locationSubscription.current?.remove(); // Ensure previous is removed
        locationSubscription.current = await Location.watchPositionAsync(
            {
                accuracy: Location.Accuracy.BestForNavigation,
                timeInterval: 5000,
                distanceInterval: 10,
            },
            (location) => {
                if (socket && isConnected) {
                    socket.emit('send_location', {
                        latitude: location.coords.latitude,
                        longitude: location.coords.longitude,
                        timestamp: location.timestamp,
                    });
                }
            }
        );
        setIsTrackingLocation(true);
        console.log("Location tracking started successfully.");
    } catch (error) {
        console.error("Error starting location tracking:", error);
        Alert.alert("Tracking Error", "Could not start location tracking.");
        setIsTrackingLocation(false);
    }
  };

  const stopLocationTracking = () => {
    if (locationSubscription.current) {
      console.log("Stopping location tracking...");
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }
    if (isTrackingLocation) {
        setIsTrackingLocation(false);
        console.log("Location tracking stopped.");
    }
  };

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


  return (
    <View style={styles.container} className="bg-gray-100 p-5">
      <Text style={styles.title} className="text-2xl font-bold text-green-700 mb-2">Child Mode Active</Text>
      <Text className="text-lg font-semibold mb-4">Your ID: <Text className="text-blue-600 font-bold text-xl">{userInfo?.userId ?? '...'}</Text></Text>

      {/* Status block */}
      <View className="w-full p-4 bg-white rounded-lg shadow mb-4">
        <Text className="text-lg font-semibold mb-2">Status:</Text>
        <Text>Username: <Text className="font-bold">{userInfo?.username ?? 'Loading...'}</Text></Text>
        <Text>Socket Connected: <Text className={isConnected ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>{isConnected ? 'Yes' : 'No'}</Text></Text>
         <Text>Location Permission: <Text className={locationPermissionStatus === 'granted' ? 'text-green-600' : 'text-red-600'}>{locationPermissionStatus || 'Checking...'}</Text></Text>
         <Text>Location Tracking: <Text className={isTrackingLocation ? 'text-green-600 font-bold' : 'text-gray-500'}>{isTrackingLocation ? 'Active' : 'Inactive'}</Text></Text>
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
