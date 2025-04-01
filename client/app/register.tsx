import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, Pressable } from 'react-native';
import { router, Href } from 'expo-router'; // Import Href

// Define your backend URL
const API_URL = 'http://192.168.1.13:7000'; // Use hosted backend URL

type Role = 'parent' | 'child';

export default function RegisterScreen() {
  const [email, setEmail] = useState(''); // Add email state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleRegister = async () => {
    // Add email validation
    if (!email || !username || !password || !selectedRole) {
      Alert.alert('Error', 'Please enter email, username, password, and select a role.');
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
         // Include email in the request body
        body: JSON.stringify({ email, username, password, role: selectedRole }),
      });

      // Use response.json() directly since server sends JSON errors now
      const data = await response.json();

      if (!response.ok) {
        // Throw error using the message from the JSON response
        throw new Error(data.message || `Registration failed with status: ${response.status}`);
      }

      // Use success message from response if available, otherwise default
      Alert.alert('Success', data.message || 'Registration successful! Please log in.');
      router.replace('/login' as Href); // Navigate to login screen after successful registration

    } catch (error: any) {
      console.error('Registration error:', error);
      Alert.alert('Registration Failed', error.message || 'An error occurred during registration.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container} className="bg-gray-100">
      <Text style={styles.title} className="text-3xl font-bold text-blue-600 mb-8">
        Register
      </Text>
      {/* Add Email Input */}
      <TextInput
        style={styles.input}
        className="bg-white border border-gray-300 rounded-md px-4 py-3 mb-4 w-full"
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
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

      <Text className="text-lg font-semibold mb-2 text-gray-700">Select Role:</Text>
      <View className="flex-row justify-around w-full mb-6">
        <Pressable
          className={`py-2 px-6 rounded-md border-2 ${selectedRole === 'parent' ? 'bg-blue-500 border-blue-700' : 'bg-white border-gray-300'}`}
          onPress={() => setSelectedRole('parent')}
        >
          <Text className={`${selectedRole === 'parent' ? 'text-white' : 'text-gray-700'} font-medium`}>Parent</Text>
        </Pressable>
        <Pressable
          className={`py-2 px-6 rounded-md border-2 ${selectedRole === 'child' ? 'bg-green-500 border-green-700' : 'bg-white border-gray-300'}`}
          onPress={() => setSelectedRole('child')}
        >
          <Text className={`${selectedRole === 'child' ? 'text-white' : 'text-gray-700'} font-medium`}>Child</Text>
        </Pressable>
      </View>

      <Pressable
        style={styles.button}
        className="bg-blue-500 rounded-md py-3 px-6 w-full items-center mb-4"
        onPress={handleRegister}
        disabled={isLoading}
      >
        <Text style={styles.buttonText} className="text-white font-semibold text-lg">
          {isLoading ? 'Registering...' : 'Register'}
        </Text>
      </Pressable>
       <Pressable onPress={() => router.back()}>
        <Text className="text-blue-500 mt-4">Already have an account? Login</Text>
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
    // Base styles if needed
  },
  input: {
    // Base styles if needed
    fontSize: 16,
  },
  button: {
    // Base styles if needed
  },
  buttonText: {
     // Base styles if needed
  }
});
