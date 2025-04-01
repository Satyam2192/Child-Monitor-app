import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Alert, TextInput, Button, FlatList, ActivityIndicator, TouchableOpacity, Modal } from 'react-native'; // Added Modal
import MapView, { Marker, Region } from 'react-native-maps';
import { useSocket } from '../context/SocketContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode } from 'jwt-decode';
import { router, Href, useFocusEffect } from 'expo-router'; // Import router, Href, useFocusEffect
import { unregisterBackgroundSocketTask } from '../tasks/socketTask'; // Import unregister function
import { useCallback } from 'react'; // Import useCallback for useFocusEffect

// Define the expected structure of the decoded JWT payload
interface DecodedToken {
  userId: number;
  username: string;
  role: 'parent' | 'child';
  iat: number;
  exp: number;
}

interface LocationData {
  userId: number; // Child's User ID
  username: string; // Child's Username
  latitude: number;
  longitude: number;
  timestamp: number;
}

interface ChildInfo {
    id: number;
    username: string;
}

// Define the structure for stored location data (from background fetch)
interface StoredLocationData {
    latitude: number;
    longitude: number;
    timestamp: number;
    // Add other fields if your background fetch stores them
    userId?: number; // Assuming background fetch stores this
    username?: string; // Assuming background fetch stores this
}

const LAST_LOCATION_STORAGE_KEY = 'lastFetchedChildLocation'; // Key used in background fetch task

export default function ParentScreen() {
  const { socket, isConnected } = useSocket();
  // const [childIdInput, setChildIdInput] = useState(''); // Keep removed, use buttons instead
  const [monitoringChildId, setMonitoringChildId] = useState<number | null>(null); // RESTORED specific monitoring
  const [allChildLocations, setAllChildLocations] = useState<Record<number, LocationData>>({}); // Store locations by child ID
  const [allChildren, setAllChildren] = useState<ChildInfo[]>([]); // List of connected children
  const [mapRegion, setMapRegion] = useState<Region | undefined>(undefined); // Keep for potential future use (e.g., centering map initially)
  const [joinedRoom, setJoinedRoom] = useState<string | null>(null); // RESTORED specific room logic state
  const [isLoading, setIsLoading] = useState(false); // RESTORED specific monitoring loading
  const [isRefreshing, setIsRefreshing] = useState(false); // RESTORED specific monitoring refresh
  const [parentUsername, setParentUsername] = useState<string>('');
  const [isAddChildModalVisible, setIsAddChildModalVisible] = useState(false); // State for modal visibility
  const [connectionCodeInput, setConnectionCodeInput] = useState(''); // State for connection code input
  const [isLinkingChild, setIsLinkingChild] = useState(false); // Loading state for linking

  const mapRef = useRef<MapView>(null);

  // Get parent username from token
  useEffect(() => {
    const loadUsername = async () => {
        const token = await AsyncStorage.getItem('authToken');
        if (token) {
            try {
                const decoded = jwtDecode<DecodedToken>(token);
                setParentUsername(decoded.username);
            } catch (e) { console.error("Failed to decode token for username", e); }
        }
    };
    loadUsername();
  }, []);

  // Effect to load last known location from storage when screen focuses
  useFocusEffect(
    useCallback(() => {
      const loadStoredLocation = async () => {
        try {
          const storedLocationJson = await AsyncStorage.getItem(LAST_LOCATION_STORAGE_KEY);
          if (storedLocationJson) {
            const storedLocation: StoredLocationData = JSON.parse(storedLocationJson);
            console.log('Loaded stored location:', storedLocation);

            // Merge with current state if it's newer or doesn't exist
            // Assuming storedLocation has userId and username (update StoredLocationData if not)
            if (storedLocation.userId && storedLocation.username) {
                 setAllChildLocations(prev => {
                    const existing = prev[storedLocation.userId!];
                    if (!existing || storedLocation.timestamp > existing.timestamp) {
                        console.log(`Updating location for child ${storedLocation.userId} from storage.`);
                        return {
                            ...prev,
                            [storedLocation.userId!]: {
                                userId: storedLocation.userId!,
                                username: storedLocation.username!,
                                latitude: storedLocation.latitude,
                                longitude: storedLocation.longitude,
                                timestamp: storedLocation.timestamp,
                            }
                        };
                    }
                     return prev; // Keep existing if it's newer or same
                  });

                 // RESTORED: If monitoring this child, update map region based on stored data
                 if (storedLocation.userId === monitoringChildId) {
                     const existingState = allChildLocations[monitoringChildId];
                     if (!existingState || storedLocation.timestamp > existingState.timestamp) {
                         const newRegion = {
                             latitude: storedLocation.latitude,
                             longitude: storedLocation.longitude,
                             latitudeDelta: 0.01,
                             longitudeDelta: 0.01,
                         };
                         console.log("Updating map region from stored location for monitored child.");
                         setMapRegion(newRegion);
                         // Don't animate here as it might be jarring on focus
                         // mapRef.current?.animateToRegion(newRegion, 500);
                     }
                 }
             } else {
                 console.warn("Stored location data is missing userId or username.");
             }
          }
        } catch (e) {
          console.error("Failed to load or parse stored location:", e);
        }
      };

      loadStoredLocation();

      // Optional: Return a cleanup function if needed
      // return () => console.log('Parent screen unfocused');
    }, [monitoringChildId]) // RESTORED dependency
  );


  // Effect to handle socket events (children list, locations, linking results, room joining)
  useEffect(() => {
    console.log(`Parent useEffect running. isConnected: ${isConnected}, socket available: ${!!socket}, socket ID: ${socket?.id}`); // Add detailed log
    if (isConnected && socket) {
      console.log(`Parent useEffect: Attaching listeners for socket ID: ${socket.id}`); // Log listener attachment
      // Listener for children list updates
      const handleUpdateChildrenList = (children: ChildInfo[]) => {
          console.log('Received updated children list:', children);
          setAllChildren(children);
          // Optional: Remove locations for children who disconnected?
          setAllChildLocations(prevLocations => {
              const newLocations: Record<number, LocationData> = {};
              children.forEach(child => {
                  if (prevLocations[child.id]) {
                      newLocations[child.id] = prevLocations[child.id];
                  }
              });
              return newLocations;
          });
      };

      // Listener for location updates (updates map region only if monitoring)
      const handleReceiveLocation = (data: LocationData) => {
          // console.log('Location received:', data);
          setAllChildLocations(prev => ({
              ...prev,
              [data.userId]: data // Update location for the specific child ID
          }));
          // RESTORED: If specifically monitoring this child, update map region
          if (data.userId === monitoringChildId) {
              const newRegion = {
                  latitude: data.latitude,
                  longitude: data.longitude,
                  latitudeDelta: 0.01, // Adjust zoom level as needed
                  longitudeDelta: 0.01,
              };
              setMapRegion(newRegion);
              mapRef.current?.animateToRegion(newRegion, 500); // Animate map to new location
          }
          setIsRefreshing(false); // Stop refresh indicator if it was active
      };

      // Listener for successful child linking
      const handleLinkSuccess = (data: { message: string, child: ChildInfo }) => {
          console.log('Child link success:', data.message);
          Alert.alert('Success', data.message);
          setIsLinkingChild(false);
          setIsAddChildModalVisible(false); // Close modal on success
          setConnectionCodeInput(''); // Clear input
          // Server should send 'update_children_list' after success,
          // but we can optimistically add the child here if needed,
          // though relying on the server update is cleaner.
          // setAllChildren(prev => [...prev, data.child]);
      };

      // Listener for child linking error
      const handleLinkError = (data: { message: string }) => {
          console.error('Child link error:', data.message);
          Alert.alert('Error Linking Child', data.message);
          setIsLinkingChild(false); // Stop loading indicator
          // Keep modal open for correction
      };

      // RESTORED: Listener for specific room join confirmation
      const handleJoinedRoom = (data: { room: string, childId: number }) => {
        if (data.childId === monitoringChildId) { // Ensure ack is for the correct child
            console.log(`Successfully joined specific room: ${data.room}`);
            setJoinedRoom(data.room);
            setIsLoading(false);
            Alert.alert('Success', `Now specifically monitoring Child ID: ${monitoringChildId}`);
            // REMOVED: handleRefreshLocation(); // Initial location request moved to separate useEffect
        }
      };

      // RESTORED: Listener for specific room join error
      const handleJoinError = (data: { message: string }) => {
        console.error(`Failed to join specific room: ${data.message}`);
        Alert.alert('Error Joining Room', data.message);
        setJoinedRoom(null);
        setMonitoringChildId(null); // Reset specific monitoring on error
        setIsLoading(false);
      };

      // RESTORED: Listener for location request error
       const handleLocationRequestError = (data: { message: string }) => {
           console.error(`Location request error: ${data.message}`);
           Alert.alert('Location Error', data.message);
           setIsRefreshing(false); // Stop indicator on error
       };


      socket.on('update_children_list', handleUpdateChildrenList);
      socket.on('receive_location', handleReceiveLocation);
      socket.on('link_child_success', handleLinkSuccess);
      socket.on('link_child_error', handleLinkError);
      socket.on('joined_room_ack', handleJoinedRoom); // RESTORED
      socket.on('join_room_error', handleJoinError); // RESTORED
      socket.on('location_request_error', handleLocationRequestError); // RESTORED

      // Request the initial list of linked children after listeners are set up
      console.log(`Parent requesting initial children list from server...`);
      socket.emit('request_children_list');

      // C leanup listeners
      return () => {
        console.log(`Cleaning up parent listeners`);
        socket.off('update_children_list', handleUpdateChildrenList);
        socket.off('receive_location', handleReceiveLocation);
        socket.off('link_child_success', handleLinkSuccess);
        socket.off('link_child_error', handleLinkError);
        socket.off('joined_room_ack', handleJoinedRoom);
        socket.off('join_room_error', handleJoinError);
        socket.off('location_request_error', handleLocationRequestError);
        setIsLinkingChild(false);
        setJoinedRoom(null); // RESTORED cleanup
        setIsLoading(false); // RESTORED cleanup
        setIsRefreshing(false); // RESTORED cleanup
      };
    } else {
        // Reset state if disconnected
        setAllChildren([]);
        setAllChildLocations({});
        setIsLinkingChild(false);
        setJoinedRoom(null); // RESTORED reset
        setIsLoading(false); // RESTORED reset
        setIsRefreshing(false); // RESTORED reset
    }
    // Log cleanup execution
    return () => {
      console.log(`Parent useEffect cleanup running. isConnected: ${isConnected}, socket ID: ${socket?.id}`);
    };
  }, [isConnected, socket, monitoringChildId]); // Revert dependency array


  // New useEffect to request location once joinedRoom is confirmed
  useEffect(() => {
    if (joinedRoom && monitoringChildId && socket && isConnected) {
        console.log(`Joined room ${joinedRoom}, requesting initial location for child ${monitoringChildId}`);
        setIsRefreshing(true); // Show refresh indicator
        socket.emit('request_current_location', monitoringChildId);
        // Timeout to prevent infinite refresh state if response is lost
        setTimeout(() => setIsRefreshing(false), 10000);
    }
  }, [joinedRoom, monitoringChildId, socket, isConnected]); // Depend on joinedRoom state


  // Function to handle submitting the connection code
  const handleAddChild = () => {
      if (!socket || !isConnected) {
          Alert.alert('Error', 'Not connected to server.');
          return;
      }
      if (!connectionCodeInput.trim()) {
          Alert.alert('Error', 'Please enter a connection code.');
          return;
      }
      console.log(`Attempting to link child with code: ${connectionCodeInput}`);
      setIsLinkingChild(true); // Start loading indicator
      socket.emit('link_child_with_code', { connectionCode: connectionCodeInput.trim() });
  };

  // RESTORED: Function to specifically monitor one child
  const handleMonitorSpecificChild = (id: number) => {
    // const id = parseInt(childIdInput, 10); // Using ID passed from button
    if (!isNaN(id) && id > 0) {
      // Check if this child is in the connected list
      if (allChildren.some(child => child.id === id)) {
          setMonitoringChildId(id);
          setJoinedRoom(null); // Reset joined status for specific room join attempt
          setIsLoading(true); // Show loading while joining specific room
          // Emit join request (useEffect will handle the rest)
          if (socket) {
              console.log(`Requesting to join room for child ID: ${id}`);
              socket.emit('join_child_room', id);
          }
      } else {
          Alert.alert('Child Not Found', 'This child is not currently connected or linked.');
      }
    } else {
      Alert.alert('Invalid ID', 'Invalid Child ID provided.');
    }
  };

  // RESTORED: Function to stop monitoring a specific child and show all
  const handleShowAllChildren = () => {
      // Leave the specific room (optional, disconnect handles it too, but good practice)
      // if (socket && monitoringChildId && joinedRoom) {
      //     socket.emit('leave_child_room', monitoringChildId); // Server needs to handle 'leave_child_room'
      // }
      setMonitoringChildId(null);
      // setChildIdInput(''); // No longer needed
      setJoinedRoom(null);
      setIsLoading(false);
      setIsRefreshing(false);
      setMapRegion(undefined); // Reset map region to potentially show all markers better
      console.log("Stopped specific monitoring. Showing all connected children.");
  };

  // RESTORED: Function to request location refresh (only when monitoring specific child)
  const handleRefreshLocation = () => {
      if (socket && monitoringChildId && joinedRoom) {
          console.log(`Requesting current location for child ${monitoringChildId}`);
          setIsRefreshing(true);
          socket.emit('request_current_location', monitoringChildId);
          // Timeout to prevent infinite refresh state
          setTimeout(() => setIsRefreshing(false), 10000);
      } else if (!monitoringChildId) {
          Alert.alert("Info", "Select a child to monitor before refreshing location.");
      } else {
          Alert.alert("Error", "Cannot refresh location. Not connected or not in the child's room yet.");
      }
  };


  // Function to handle logout
  const handleLogout = async () => {
      console.log("Logging out...");
      // Disconnect foreground socket
       if (socket) {
           socket.disconnect();
       }
       // Unregister background task - REMOVED - Parent should not manage child's background tasks
       // await unregisterBackgroundSocketTask();
       // Clear auth token
       await AsyncStorage.removeItem('authToken');
       // Navigate to login screen
      router.replace('/login' as Href); // Use Href type assertion
  };

  const renderChildItem = ({ item }: { item: ChildInfo }) => (
      <View className="p-2 border-b border-gray-200 flex-row justify-between items-center">
          <Text>{item.username} (ID: {item.id})</Text>
          {/* RESTORED Focus button */}
          <Button title="Focus" onPress={() => handleMonitorSpecificChild(item.id)} disabled={isLoading || monitoringChildId === item.id} />
      </View>
  );

  // Add log before rendering FlatList
  console.log("Rendering ParentScreen, allChildren state:", JSON.stringify(allChildren));

  return (
    <View style={styles.container} className="flex-1">
        {/* Header Area */}
        <View className="p-4 bg-white border-b border-gray-200">
            <View className="flex-row justify-between items-center mb-2">
                <Text className="text-xl font-bold">Parent Dashboard ({parentUsername})</Text>
                <Button title="Logout" onPress={handleLogout} color="red" />
            </View>
            <Text>Socket Connected: <Text className={isConnected ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>{isConnected ? 'Yes' : 'No'}</Text></Text>

            {/* Monitoring Status / Controls */}
            {monitoringChildId ? (
                 <View className="mt-2 p-2 border border-blue-300 bg-blue-50 rounded">
                     <Text className="text-base font-semibold text-blue-800">Specifically Monitoring:</Text>
                     <Text className="text-lg font-bold text-blue-900">{allChildren.find(c=>c.id === monitoringChildId)?.username ?? `Child ID ${monitoringChildId}`}</Text>
                     {joinedRoom ? <Text className="text-green-600">(In Room)</Text> : <Text className="text-orange-500">(Joining Room...)</Text>}
                     <View className="mt-2 flex-row justify-around items-center">
                        <Button title="Refresh Location" onPress={handleRefreshLocation} disabled={!joinedRoom || isLoading || isRefreshing} />
                        <Button title="Show All" onPress={handleShowAllChildren} />
                     </View>
                     {(isLoading || isRefreshing) && <ActivityIndicator size="small" color="#0000ff" className="mt-1"/>}
                 </View>
            ) : (
                 <Text className="text-base mt-2">Monitoring All Linked Children</Text>
            )}

            {/* Add Child Button - Moved slightly lower */}
            <View className="mt-3">
                <Button
                    title="Add Child"
                    onPress={() => setIsAddChildModalVisible(true)}
                    disabled={!isConnected || isLinkingChild} // Disable if not connected or already linking
                />
                 {isLinkingChild && <ActivityIndicator size="small" color="#0000ff" className="mt-1"/>}
            </View>
        </View>

        {/* Connected Children List - Now includes Focus button */}
        <View style={styles.childrenListContainer}>
            <Text className="text-lg font-semibold p-2 bg-gray-100">Linked Children:</Text>
            <FlatList
                data={allChildren}
                renderItem={renderChildItem}
                keyExtractor={(item) => String(item.id)}
                ListEmptyComponent={<Text className="p-2 text-gray-500">No children linked. Use 'Add Child' to link.</Text>}
            />
        </View>

        {/* Map View - Shows specific child or all */}
        <MapView
            ref={mapRef}
            style={styles.map}
            region={mapRegion}
            initialRegion={{
                latitude: 37.78825, longitude: -122.4324,
                latitudeDelta: 0.0922, longitudeDelta: 0.0421,
            }}
            showsUserLocation={true} // Show parent's location too
        >
            {/* Render markers based on monitoring state */}
            {monitoringChildId ? (
                // Show only the specifically monitored child
                allChildLocations[monitoringChildId] && (
                    <Marker
                        key={monitoringChildId} // Use monitoring ID as key
                        coordinate={{
                            latitude: allChildLocations[monitoringChildId].latitude,
                            longitude: allChildLocations[monitoringChildId].longitude,
                        }}
                        title={`Child: ${allChildLocations[monitoringChildId].username}`}
                        description={`ID: ${monitoringChildId} | Last Update: ${new Date(allChildLocations[monitoringChildId].timestamp).toLocaleTimeString()}`}
                        pinColor="blue" // Specific color for monitored child
                    />
                )
            ) : (
                // Show all connected children with known locations
                <>
                  {Object.values(allChildLocations).map(locData => (
                     <Marker
                        key={locData.userId}
                        coordinate={{
                        latitude: locData.latitude,
                        longitude: locData.longitude,
                    }}
                    title={`Child: ${locData.username}`}
                    description={`ID: ${locData.userId} | Last Update: ${new Date(locData.timestamp).toLocaleTimeString()}`}
                    pinColor="green" // Use a consistent color for all children
                />
                  ))}
                </>
            )}
        </MapView>

        {/* Add Child Modal */}
        <Modal
            animationType="slide"
            transparent={true}
            visible={isAddChildModalVisible}
            onRequestClose={() => {
                if (!isLinkingChild) { // Prevent closing while linking
                    setIsAddChildModalVisible(false);
                    setConnectionCodeInput(''); // Clear input on close
                }
            }}
        >
            <View style={styles.modalCenteredView}>
                <View style={styles.modalView}>
                    <Text style={styles.modalText}>Add Child</Text>
                    <Text style={styles.modalSubText}>Enter the connection code displayed on the child's device:</Text>
                    <TextInput
                        style={styles.modalInput}
                        placeholder="Connection Code"
                        value={connectionCodeInput}
                        onChangeText={setConnectionCodeInput}
                        autoCapitalize="none"
                        editable={!isLinkingChild} // Disable input while linking
                    />
                    <View style={styles.modalButtonContainer}>
                         <Button
                            title="Cancel"
                            onPress={() => {
                                setIsAddChildModalVisible(false);
                                setConnectionCodeInput('');
                            }}
                            color="gray"
                            disabled={isLinkingChild}
                         />
                         <Button
                            title={isLinkingChild ? "Linking..." : "Link Child"}
                            onPress={handleAddChild}
                            disabled={isLinkingChild || !connectionCodeInput.trim()}
                         />
                    </View>
                    {isLinkingChild && <ActivityIndicator size="small" color="#0000ff" style={{ marginTop: 10 }}/>}
                </View>
            </View>
        </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1, // Map takes remaining space below list
  },
  childrenListContainer: {
      maxHeight: 150, // Limit height of the list
      borderBottomWidth: 1,
      borderColor: '#ccc',
      backgroundColor: '#f9f9f9', // Slightly different background for list area
  },
  // Modal Styles
  modalCenteredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)', // Semi-transparent background
  },
  modalView: {
    margin: 20,
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 35,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    width: '80%', // Adjust width as needed
  },
  modalText: {
    marginBottom: 15,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: 'bold',
  },
   modalSubText: {
    marginBottom: 15,
    textAlign: 'center',
    fontSize: 14,
    color: 'gray',
  },
  modalInput: {
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    marginBottom: 20,
    paddingHorizontal: 10,
    width: '100%',
    borderRadius: 5,
  },
  modalButtonContainer: {
      flexDirection: 'row',
      justifyContent: 'space-around', // Space out buttons
      width: '100%',
  }
});
