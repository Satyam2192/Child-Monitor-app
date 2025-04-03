package com.anonymous.FlashGet

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise // Import Promise

class LocationModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "LocationModule"
        // Must match the keys used in BootReceiver
        private const val SHARED_PREFS_NAME = "LocationPrefs"
        private const val KEY_TRACKING_ENABLED = "isTrackingEnabled"
    }

    // Required by ReactContextBaseJavaModule
    override fun getName() = "LocationModule"

    private val sharedPreferences: SharedPreferences by lazy {
        reactApplicationContext.getSharedPreferences(SHARED_PREFS_NAME, Context.MODE_PRIVATE)
    }

    @ReactMethod
    fun startTrackingService(promise: Promise) {
        Log.d(TAG, "startTrackingService called from JS")
        try {
            val context = reactApplicationContext
            val serviceIntent = Intent(context, LocationTrackingService::class.java)

            // Use ContextCompat to handle different Android versions
            ContextCompat.startForegroundService(context, serviceIntent)

            // Save state to SharedPreferences so BootReceiver knows to restart it
            setTrackingPreference(true)

            Log.d(TAG, "LocationTrackingService started via startForegroundService.")
            promise.resolve("Foreground service started successfully.") // Inform JS about success

        } catch (e: Exception) {
            Log.e(TAG, "Failed to start LocationTrackingService", e)
            promise.reject("SERVICE_START_ERROR", "Failed to start location tracking service.", e) // Inform JS about failure
        }
    }

    @ReactMethod
    fun stopTrackingService(promise: Promise) {
        Log.d(TAG, "stopTrackingService called from JS")
        try {
            val context = reactApplicationContext
            val serviceIntent = Intent(context, LocationTrackingService::class.java)
            context.stopService(serviceIntent)

            // Save state to SharedPreferences
            setTrackingPreference(false)

            Log.d(TAG, "LocationTrackingService stopped.")
             promise.resolve("Service stopped successfully.") // Inform JS about success

        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop LocationTrackingService", e)
            promise.reject("SERVICE_STOP_ERROR", "Failed to stop location tracking service.", e) // Inform JS about failure
        }
    }

    // Helper method to save tracking state (used by start/stop and BootReceiver)
    private fun setTrackingPreference(isEnabled: Boolean) {
         Log.d(TAG, "Setting tracking preference to: $isEnabled")
        try {
            sharedPreferences.edit().putBoolean(KEY_TRACKING_ENABLED, isEnabled).apply()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save tracking preference", e)
        }
    }

     // Optional: Expose a method to check if the service is running (might be complex/less reliable)
    // @ReactMethod
    // fun isServiceRunning(promise: Promise) {
    //     // Checking service status accurately from outside is tricky.
    //     // It's often better to rely on the state managed by start/stop calls.
    //     // You could check a static flag in the Service, but that has limitations.
    //     promise.resolve(false); // Placeholder
    // }

}
