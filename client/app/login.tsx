import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert, Pressable } from 'react-native';
import { router, Href } from 'expo-router'; // Import Href
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode } from 'jwt-decode'; // Ensure types are installed

// Re-use the token structure definition
interface DecodedToken {
  userId: number;
  username: string;
  role: 'parent' | 'child';
  iat: number;
  exp: number;
}

// Define your backend URL (replace with your actual IP/domain if not localhost)
const API_URL = 'http://192.168.1.13:7000'; // Use your computer's local IP and CORRECT PORT

export default function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    if (!username || !password) {
      Alert.alert('Error', 'Please enter both username and password.');
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      // Check if the response status indicates success (e.g., 200 OK)
      if (!response.ok) {
        // If not OK, try to parse the error message from the JSON body
        let errorMessage = 'Login failed';
        try {
            const errorData = await response.json(); // Attempt to parse error JSON
            errorMessage = errorData.message || `Server error: ${response.status}`;
        } catch (parseError) {
            // If parsing fails, use the status text or a generic message
            errorMessage = response.statusText || `Server error: ${response.status}`;
            console.error("Failed to parse error response:", parseError);
        }
        throw new Error(errorMessage);
      }

      // If response IS ok, parse the success JSON body
      const data = await response.json();

      if (data.token) {
        await AsyncStorage.setItem('authToken', data.token);
        // Decode token to redirect
        const decoded = jwtDecode<DecodedToken>(data.token);
        Alert.alert('Success', 'Logged in successfully!');
        // Redirect based on role
        if (decoded.role === 'parent') {
          router.replace('/parent' as Href); // Cast to Href
        } else if (decoded.role === 'child') {
          router.replace('/child' as Href); // Cast to Href
        } else {
           router.replace('/login' as Href); // Cast to Href - Fallback
        }
      } else {
        throw new Error('No token received');
      }
    } catch (error: any) {
      console.error('Login error:', error);
      Alert.alert('Login Failed', error.message || 'An error occurred during login.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container} className="bg-gray-100">
      <Text style={styles.title} className="text-3xl font-bold text-blue-600 mb-8">
        Login
      </Text>
      <TextInput
        style={styles.input}
        className="bg-white border border-gray-300 rounded-md px-4 py-3 mb-4 w-full"
        placeholder="Username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        className="bg-white border border-gray-300 rounded-md px-4 py-3 mb-6 w-full"
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      {/* Removed className from Pressable, applying styles directly */}
      <Pressable
        style={[styles.button, { backgroundColor: '#3b82f6', borderRadius: 6, paddingVertical: 12, paddingHorizontal: 24, width: '100%', alignItems: 'center', marginBottom: 16 }]}
        onPress={handleLogin}
        disabled={isLoading}
      >
        <Text style={styles.buttonText} className="text-white font-semibold text-lg">
          {isLoading ? 'Logging in...' : 'Login'}
        </Text>
      </Pressable>
       <Pressable onPress={() => router.push('/register' as Href)}> {/* Cast to Href */}
        {/* Reverted the previous change on Text as it didn't help */}
        <Text className="text-blue-500 mt-4">Don't have an account? Register</Text>
      </Pressable>
    </View>
  );
}

// Combine StyleSheet and NativeWind classes
const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    // Base styles if needed, NativeWind overrides/adds
  },
  input: {
    // Base styles if needed
    fontSize: 16, // Example base style
  },
   button: {
    // Base styles if needed
  },
  buttonText: {
     // Base styles if needed
  }
});
