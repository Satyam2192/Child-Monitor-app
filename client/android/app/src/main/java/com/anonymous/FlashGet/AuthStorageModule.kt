package com.anonymous.FlashGet

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

class AuthStorageModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "AuthStorageModule"
        // Must match the keys used in LocationTrackingService
        private const val SHARED_PREFS_AUTH_NAME = "AuthPrefs"
        private const val AUTH_TOKEN_KEY = "authToken"
    }

    override fun getName() = "AuthStorageModule"

    private val sharedPreferences: SharedPreferences by lazy {
        reactApplicationContext.getSharedPreferences(SHARED_PREFS_AUTH_NAME, Context.MODE_PRIVATE)
    }

    @ReactMethod
    fun saveAuthToken(token: String?, promise: Promise) {
        Log.d(TAG, "saveAuthToken called from JS.")
        if (token == null) {
            Log.w(TAG, "Token is null, clearing stored token.")
            // Allow clearing the token by passing null
        }
        try {
            sharedPreferences.edit().putString(AUTH_TOKEN_KEY, token).apply()
            Log.d(TAG, "Auth token saved/cleared in SharedPreferences.")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save auth token to SharedPreferences", e)
            promise.reject("SAVE_ERROR", "Failed to save auth token.", e)
        }
    }

    // Optional: Method to clear token (can also use saveAuthToken(null))
    @ReactMethod
    fun clearAuthToken(promise: Promise) {
         saveAuthToken(null, promise)
    }

    // Optional: Method to read token (primarily for debugging native side)
    // Not typically called from JS as AsyncStorage is used there.
    @ReactMethod
    fun getAuthToken(promise: Promise) {
         try {
            val token = sharedPreferences.getString(AUTH_TOKEN_KEY, null)
            promise.resolve(token)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to get auth token from SharedPreferences", e)
            promise.reject("GET_ERROR", "Failed to get auth token.", e)
        }
    }
}
