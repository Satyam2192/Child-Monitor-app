import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert, Pressable } from 'react-native';
import { router, Href } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode } from 'jwt-decode';
import { registerBackgroundSocketTask } from '../tasks/socketTask';
import { useSocket } from '../context/SocketContext'; // Import useSocket

interface DecodedToken {
  userId: number;
  username: string;
  role: 'parent' | 'child';
  iat: number;
  exp: number;
}

const API_URL = 'https://flashgo.onrender.com'; 

export default function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { updateAuthToken } = useSocket(); // Get the update function

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

      if (!response.ok) {
        let errorMessage = 'Login failed';
        try {
            const errorData = await response.json();
            errorMessage = errorData.message || `Server error: ${response.status}`;
        } catch (parseError) {
            errorMessage = response.statusText || `Server error: ${response.status}`;
            console.error("Failed to parse error response:", parseError);
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();

      if (data.token) {
        await AsyncStorage.setItem('authToken', data.token);
        updateAuthToken(data.token); // Notify SocketContext immediately
        const decoded = jwtDecode<DecodedToken>(data.token);

        if (decoded.role === 'parent') {
          await registerBackgroundSocketTask();
          router.replace('/parent' as Href);
        } else if (decoded.role === 'child') {
          await registerBackgroundSocketTask(); // Add socket registration for child
          router.replace('/child' as Href);
        } else {
           console.warn("Login successful but role is not parent or child:", decoded.role);
           router.replace('/login' as Href);
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
    <View style={styles.container}>
      <Text style={styles.title}>
        Login
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <Pressable
        style={styles.loginButton}
        onPress={handleLogin}
        disabled={isLoading}
      >
        <Text style={styles.loginButtonText}>
          {isLoading ? 'Logging in...' : 'Login'}
        </Text>
      </Pressable>
      <Pressable 
        style={styles.registerLink} 
        onPress={() => router.push('/register' as Href)}
      > 
        <Text style={styles.registerLinkText}>
          Don't have an account? Register
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f3f4f6',
  },
  title: {
    fontSize: 30,
    fontWeight: 'bold',
    color: '#2563eb',
    marginBottom: 32,
  },
  input: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
    width: '100%',
    fontSize: 16,
  },
  loginButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 6,
    paddingVertical: 12,
    paddingHorizontal: 24,
    width: '100%',
    alignItems: 'center',
    marginBottom: 16,
  },
  loginButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 18,
  },
  registerLink: {
    marginTop: 16,
  },
  registerLinkText: {
    color: '#3b82f6',
    fontSize: 16,
  }
});
