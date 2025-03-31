import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Alert, TextInput, Button, FlatList, ActivityIndicator, TouchableOpacity } from 'react-native'; // Added FlatList, TouchableOpacity
import MapView, { Marker, Region } from 'react-native-maps';
import { useSocket } from '../context/SocketContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode } from 'jwt-decode';

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

export default function ParentScreen() {
  const { socket, isConnected } = useSocket();
  const [childIdInput, setChildIdInput] = useState('');
  const [monitoringChildId, setMonitoringChildId] = useState<number | null>(null); // Currently specifically monitored child
  // const [childLocation, setChildLocation] = useState<LocationData | null>(null); // Replaced by allChildLocations
  const [allChildLocations, setAllChildLocations] = useState<Record<number, LocationData>>({}); // Store locations by child ID
  const [allChildren, setAllChildren] = useState<ChildInfo[]>([]); // List of connected children
  const [mapRegion, setMapRegion] = useState<Region | undefined>(undefined);
  const [joinedRoom, setJoinedRoom] = useState<string | null>(null); // Still used for specific monitoring confirmation
  const [isLoading, setIsLoading] = useState(false); // Loading state for joining specific room
  const [isRefreshing, setIsRefreshing] = useState(false); // Loading state for refresh button
  const [parentUsername, setParentUsername] = useState<string>('');

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


  // Effect to handle socket events (children list, locations)
  useEffect(() => {
    if (isConnected && socket) {
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

      // Listener for location updates (now updates the map)
      const handleReceiveLocation = (data: LocationData) => {
          // console.log('Location received:', data);
          setAllChildLocations(prev => ({
              ...prev,
              [data.userId]: data // Update location for the specific child ID
          }));
          // If specifically monitoring this child, update map region
          if (data.userId === monitoringChildId) {
              const newRegion = {
                  latitude: data.latitude,
                  longitude: data.longitude,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
              };
              setMapRegion(newRegion);
              mapRef.current?.animateToRegion(newRegion, 500);
          }
          setIsRefreshing(false); // Stop refresh indicator if it was active
      };

      // Listener for specific room join confirmation
      const handleJoinedRoom = (data: { room: string, childId: number }) => {
        if (data.childId === monitoringChildId) { // Ensure ack is for the correct child
            console.log(`Successfully joined specific room: ${data.room}`);
            setJoinedRoom(data.room);
            setIsLoading(false);
            Alert.alert('Success', `Now specifically monitoring Child ID: ${monitoringChildId}`);
            handleRefreshLocation(); // Request initial location for the specific child
        }
      };

      // Listener for specific room join error
      const handleJoinError = (data: { message: string }) => {
        console.error(`Failed to join specific room: ${data.message}`);
        Alert.alert('Error Joining Room', data.message);
        setJoinedRoom(null);
        setMonitoringChildId(null); // Reset specific monitoring on error
        setIsLoading(false);
      };

      // Listener for location request error
       const handleLocationRequestError = (data: { message: string }) => {
           console.error(`Location request error: ${data.message}`);
           Alert.alert('Location Error', data.message);
           setIsRefreshing(false); // Stop indicator on error
       };

      socket.on('update_children_list', handleUpdateChildrenList);
      socket.on('receive_location', handleReceiveLocation);
      socket.on('joined_room_ack', handleJoinedRoom);
      socket.on('join_room_error', handleJoinError);
      socket.on('location_request_error', handleLocationRequestError);

      // Cleanup listeners
      return () => {
        console.log(`Cleaning up parent listeners`);
        socket.off('update_children_list', handleUpdateChildrenList);
        socket.off('receive_location', handleReceiveLocation);
        socket.off('joined_room_ack', handleJoinedRoom);
        socket.off('join_room_error', handleJoinError);
        socket.off('location_request_error', handleLocationRequestError);
        setJoinedRoom(null);
        setIsLoading(false);
        setIsRefreshing(false);
      };
    } else {
        // Reset state if disconnected
        setAllChildren([]);
        setAllChildLocations({});
        setJoinedRoom(null);
        setIsLoading(false);
        setIsRefreshing(false);
    }
  }, [isConnected, socket, monitoringChildId]); // Add monitoringChildId dependency

  // Function to specifically monitor one child
  const handleMonitorSpecificChild = () => {
    const id = parseInt(childIdInput, 10);
    if (!isNaN(id) && id > 0) {
      // Check if this child is in the connected list
      if (allChildren.some(child => child.id === id)) {
          setMonitoringChildId(id);
          setJoinedRoom(null); // Reset joined status for specific room join attempt
          setIsLoading(true); // Show loading while joining specific room
          // Emit join request (useEffect will handle the rest)
          if (socket) {
              socket.emit('join_child_room', id);
          }
      } else {
          Alert.alert('Child Not Found', 'This child is not currently connected.');
      }
    } else {
      Alert.alert('Invalid ID', 'Please enter a valid Child ID.');
    }
  };

  // Function to stop monitoring a specific child and show all
  const handleShowAllChildren = () => {
      // Leave the specific room (optional, disconnect handles it too)
      // if (socket && monitoringChildId && joinedRoom) {
      //     socket.emit('leave_child_room', monitoringChildId);
      // }
      setMonitoringChildId(null);
      setChildIdInput('');
      setJoinedRoom(null);
      setIsLoading(false);
      setIsRefreshing(false);
      console.log("Stopped specific monitoring. Showing all connected children.");
  };

  // Function to request location refresh (only when monitoring specific child)
  const handleRefreshLocation = () => {
      if (socket && monitoringChildId && joinedRoom) {
          console.log(`Requesting current location for child ${monitoringChildId}`);
          setIsRefreshing(true);
          socket.emit('request_current_location', monitoringChildId);
          setTimeout(() => setIsRefreshing(false), 10000); // Timeout
      } else if (!monitoringChildId) {
          Alert.alert("Info", "Refresh works only when monitoring a specific child.");
      } else {
          Alert.alert("Error", "Cannot refresh location. Not connected or not in the child's room yet.");
      }
  };

  const renderChildItem = ({ item }: { item: ChildInfo }) => (
      <View className="p-2 border-b border-gray-200 flex-row justify-between items-center">
          <Text>{item.username} (ID: {item.id})</Text>
          {/* Optionally add a button here to monitor this specific child */}
          <Button title="Focus" onPress={() => {
              setChildIdInput(String(item.id));
              handleMonitorSpecificChild();
          }} />
      </View>
  );

  return (
    <View style={styles.container} className="flex-1">
        <View className="p-4 bg-white border-b border-gray-200">
            <Text className="text-xl font-bold mb-2">Parent Dashboard ({parentUsername})</Text>
            <Text>Socket Connected: <Text className={isConnected ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>{isConnected ? 'Yes' : 'No'}</Text></Text>
            {monitoringChildId ? (
                 <View className="mt-2">
                     <Text>Specifically Monitoring: <Text className="font-bold">{allChildren.find(c=>c.id === monitoringChildId)?.username ?? monitoringChildId}</Text> {joinedRoom ? <Text className="text-green-600">(Joined Room)</Text> : <Text className="text-orange-500">(Joining...)</Text>}</Text>
                     <View className="mt-2 flex-row justify-between items-center">
                        <Button title="Refresh Location" onPress={handleRefreshLocation} disabled={!joinedRoom || isLoading || isRefreshing} />
                        <Button title="Show All" onPress={handleShowAllChildren} />
                     </View>
                 </View>
            ) : (
                <View className="mt-2">
                    <Text className="text-base font-semibold">Monitoring All Connected Children</Text>
                    {/* Optionally keep manual input for specific monitoring */}
                    <View className="flex-row items-center mt-1">
                        <TextInput
                            placeholder="Enter Child ID to Focus"
                            value={childIdInput}
                            onChangeText={setChildIdInput}
                            keyboardType="numeric"
                            className="border border-gray-400 rounded p-2 flex-1 mr-2"
                        />
                        <Button title="Focus" onPress={handleMonitorSpecificChild} disabled={!isConnected || isLoading} />
                    </View>
                </View>
            )}
             {(isLoading || isRefreshing) && <ActivityIndicator size="small" color="#0000ff" className="mt-1"/>}
        </View>

        {/* Connected Children List */}
        {!monitoringChildId && (
             <View style={styles.childrenListContainer}>
                <Text className="text-lg font-semibold p-2 bg-gray-100">Connected Children:</Text>
                <FlatList
                    data={allChildren}
                    renderItem={renderChildItem}
                    keyExtractor={(item) => String(item.id)}
                    ListEmptyComponent={<Text className="p-2 text-gray-500">No children currently connected.</Text>}
                />
             </View>
        )}

        <MapView
            ref={mapRef}
            style={styles.map}
            region={mapRegion}
            initialRegion={{
                latitude: 37.78825, longitude: -122.4324,
                latitudeDelta: 0.0922, longitudeDelta: 0.0421,
            }}
            showsUserLocation={true}
        >
            {/* Render markers based on monitoring state */}
            {monitoringChildId ? (
                // Show only the specifically monitored child
                allChildLocations[monitoringChildId] && (
                    <Marker
                        coordinate={{
                            latitude: allChildLocations[monitoringChildId].latitude,
                            longitude: allChildLocations[monitoringChildId].longitude,
                        }}
                        title={`Child: ${allChildLocations[monitoringChildId].username}`}
                        description={`ID: ${monitoringChildId} | Last Update: ${new Date(allChildLocations[monitoringChildId].timestamp).toLocaleTimeString()}`}
                        pinColor="blue"
                    />
                )
            ) : (
                // Show all connected children
                Object.values(allChildLocations).map(locData => (
                     <Marker
                        key={locData.userId}
                        coordinate={{
                            latitude: locData.latitude,
                            longitude: locData.longitude,
                        }}
                        title={`Child: ${locData.username}`}
                        description={`ID: ${locData.userId} | Last Update: ${new Date(locData.timestamp).toLocaleTimeString()}`}
                        pinColor="green" // Different color for general view
                    />
                ))
            )}
        </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1, // Map takes remaining space
  },
  childrenListContainer: {
      maxHeight: 150, // Limit height of the list
      borderBottomWidth: 1,
      borderColor: '#ccc',
  }
});
