package com.anonymous.FlashGet

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat

class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "BootReceiver"
        // Key to store tracking state in SharedPreferences (match this in your Native Module/JS)
        private const val SHARED_PREFS_NAME = "LocationPrefs"
        private const val KEY_TRACKING_ENABLED = "isTrackingEnabled"
    }

    override fun onReceive(context: Context?, intent: Intent?) {
        if (context == null) {
            Log.e(TAG, "Context is null in onReceive")
            return
        }

        if (intent?.action == Intent.ACTION_BOOT_COMPLETED) {
            Log.d(TAG, "Boot completed event received.")

            // Check SharedPreferences to see if tracking should be enabled
            val sharedPrefs = context.getSharedPreferences(SHARED_PREFS_NAME, Context.MODE_PRIVATE)
            val shouldStartTracking = sharedPrefs.getBoolean(KEY_TRACKING_ENABLED, false) // Default to false

            if (shouldStartTracking) {
                Log.d(TAG, "Tracking was enabled before reboot. Starting LocationTrackingService.")
                val serviceIntent = Intent(context, LocationTrackingService::class.java)
                try {
                    ContextCompat.startForegroundService(context, serviceIntent)
                    Log.d(TAG, "startForegroundService called successfully.")
                } catch (e: Exception) {
                    // Catch potential exceptions, especially on newer Android versions
                    // if the app is in a restricted state after reboot.
                    Log.e(TAG, "Error starting service from BootReceiver", e)
                }
            } else {
                Log.d(TAG, "Tracking was not enabled before reboot. Service not started.")
            }
        } else {
             Log.w(TAG, "Received unexpected intent action: ${intent?.action}")
        }
    }
}
