package com.anonymous.FlashGet

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Build.VERSION_CODES // Import VERSION_CODES
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey // Use MasterKey builder
import com.google.android.gms.location.*
import kotlinx.coroutines.* // Import Coroutines
import okhttp3.* // Import OkHttp
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject // Import JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

// Import R class for resources (adjust if your R class location is different)
// import com.anonymous.FlashGet.R // Assuming R is generated in this package

class LocationTrackingService : Service() {

    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private lateinit var locationRequest: LocationRequest

    private var isServiceRunning = false
    private val serviceScope = CoroutineScope(Dispatchers.IO + Job()) // Coroutine scope for background tasks
    private val okHttpClient = OkHttpClient() // OkHttp client instance

    companion object {
        private const val TAG = "LocationTrackingService"
        private const val NOTIFICATION_CHANNEL_ID = "LocationTrackingChannel"
        private const val NOTIFICATION_ID = 12345
        private const val LOCATION_UPDATE_INTERVAL_MS = 60 * 1000L // 1 minute (matches JS setting)
        private const val FASTEST_UPDATE_INTERVAL_MS = 30 * 1000L // 30 seconds

        // Key for storing/retrieving auth token (ensure RN side uses the same key)
        private const val SHARED_PREFS_AUTH_NAME = "AuthPrefs"
        private const val AUTH_TOKEN_KEY = "authToken"
        // Backend endpoint for location updates
        private const val LOCATION_API_ENDPOINT = "https://flashgo.onrender.com/api/location" // Needs to be created on server
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "onCreate called")
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        createLocationRequest()
        createLocationCallback()
    }

    private fun createLocationRequest() {
        locationRequest = LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, LOCATION_UPDATE_INTERVAL_MS)
            .setWaitForAccurateLocation(false) // Balanced: don't wait indefinitely for GPS fix
            .setMinUpdateIntervalMillis(FASTEST_UPDATE_INTERVAL_MS)
            // .setMaxUpdateDelayMillis(LOCATION_UPDATE_INTERVAL_MS * 2) // Optional: Allow batching
            .build()
    }

    private fun createLocationCallback() {
        locationCallback = object : LocationCallback() {
            override fun onLocationResult(locationResult: LocationResult) {
                super.onLocationResult(locationResult)
                locationResult.lastLocation?.let { location ->
                    Log.d(TAG, "New location received: ${location.latitude}, ${location.longitude}")
                    // TODO: Get Auth Token from secure storage (e.g., EncryptedSharedPreferences)
                    val authToken = getAuthToken() // Placeholder function
                    if (authToken != null) {
                        sendLocationToBackend(location.latitude, location.longitude, location.time, authToken)
                    } else {
                        Log.w(TAG, "Auth token not found, cannot send location.")
                        // Consider stopping service if auth is lost permanently?
                    }
                } ?: Log.w(TAG, "Location result received but lastLocation is null")
            }

             override fun onLocationAvailability(locationAvailability: LocationAvailability) {
                super.onLocationAvailability(locationAvailability)
                Log.d(TAG, "Location availability changed: ${locationAvailability.isLocationAvailable}")
                // Handle cases where location becomes unavailable (e.g., GPS turned off)
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand called")
        startForegroundServiceWithNotification()
        startLocationUpdates()
        isServiceRunning = true
        // START_STICKY: Try to recreate the service after it's killed
        return START_STICKY
    }

    private fun startForegroundServiceWithNotification() {
        createNotificationChannel()

        // Intent to open the app when notification is tapped
        val notificationIntent = Intent(this, MainActivity::class.java) // Adjust MainActivity if needed
        val pendingIntentFlags = if (Build.VERSION.SDK_INT >= VERSION_CODES.S) { // Use VERSION_CODES.S
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
         val pendingIntent = PendingIntent.getActivity(this, 0, notificationIntent, pendingIntentFlags)


        // Use application context to get resources if needed, ensure R is imported correctly
        val notification: Notification = NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("Location Tracking Active") // Use string resources ideally
            .setContentText("FlashGet is tracking your location.") // Use string resources ideally
            .setSmallIcon(R.mipmap.ic_launcher) // IMPORTANT: Replace with your actual notification icon resource ID
            .setContentIntent(pendingIntent)
            .setOngoing(true) // Makes the notification non-dismissible
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW) // Low priority for background service notification
            .build()

        try {
             if (Build.VERSION.SDK_INT >= VERSION_CODES.Q) { // Use VERSION_CODES.Q
                 startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
             } else {
                 startForeground(NOTIFICATION_ID, notification)
             }
             Log.d(TAG, "startForeground successful")
        } catch (e: Exception) {
             Log.e(TAG, "Error starting foreground service", e)
             // Handle specific exceptions like ForegroundServiceStartNotAllowedException on Android 12+ if needed
        }
    }

     private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= VERSION_CODES.O) { // Use VERSION_CODES.O
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Location Tracking", // User visible channel name
                NotificationManager.IMPORTANCE_LOW // Low importance for background service notifications
            ).apply {
                description = "Channel for FlashGet location tracking service notification" // User visible description
                // Configure other channel properties if needed (e.g., lockscreen visibility)
                setShowBadge(false)
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
            Log.d(TAG, "Notification channel created")
        }
    }


    private fun startLocationUpdates() {
        if (ActivityCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            ActivityCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "Location permissions not granted. Cannot start updates.")
            // Service should ideally not be started if permissions aren't granted.
            // Consider stopping the service here if permissions are revoked while running.
            stopSelf()
            return
        }
        try {
            fusedLocationClient.requestLocationUpdates(locationRequest, locationCallback, Looper.getMainLooper())
            Log.d(TAG, "Location updates requested successfully.")
        } catch (unlikely: SecurityException) {
            // This should not happen due to the check above, but handle defensively
            Log.e(TAG, "Lost location permission somehow?", unlikely)
            stopSelf()
        } catch (e: Exception) {
             Log.e(TAG, "Error requesting location updates", e)
             stopSelf()
        }
    }

    private fun stopLocationUpdates() {
        try {
            fusedLocationClient.removeLocationUpdates(locationCallback)
            Log.d(TAG, "Location updates stopped.")
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping location updates", e)
        }
    }

    // --- Auth Token Retrieval (Using EncryptedSharedPreferences) ---
    private fun getAuthToken(): String? {
        try {
            // 1. Create or retrieve the master key using the recommended builder pattern
            val masterKey = MasterKey.Builder(this, MasterKey.DEFAULT_MASTER_KEY_ALIAS)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()

            // 2. Initialize EncryptedSharedPreferences using the MasterKey object
            val sharedPreferences = EncryptedSharedPreferences.create(
                this, // Context
                SHARED_PREFS_AUTH_NAME, // File name
                masterKey, // Use the MasterKey object
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )

            // 3. Read the token
            val token = sharedPreferences.getString(AUTH_TOKEN_KEY, null)
            if (token == null) {
                 Log.w(TAG, "Auth token not found in EncryptedSharedPreferences ($SHARED_PREFS_AUTH_NAME / $AUTH_TOKEN_KEY).")
            }
             // TODO: Add token validation (expiry check) if necessary before returning
            return token
        } catch (e: Exception) {
            Log.e(TAG, "Error reading auth token from EncryptedSharedPreferences", e)
            return null
        }
    }

     // --- Send Location to Backend (Using OkHttp and Coroutines) ---
    private fun sendLocationToBackend(latitude: Double, longitude: Double, timestamp: Long, authToken: String) {
        // Launch a coroutine in the service's IO scope
        serviceScope.launch {
            try {
                val jsonObject = JSONObject()
                jsonObject.put("latitude", latitude)
                jsonObject.put("longitude", longitude)
                jsonObject.put("timestamp", timestamp)

                val requestBody = jsonObject.toString()
                    .toRequestBody("application/json; charset=utf-8".toMediaType())

                val request = Request.Builder()
                    .url(LOCATION_API_ENDPOINT)
                    .header("Authorization", "Bearer $authToken")
                    .post(requestBody)
                    .build()

                Log.d(TAG, "Sending location via OkHttp to $LOCATION_API_ENDPOINT")

                // Execute the request asynchronously
                okHttpClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        Log.w(TAG, "Error sending location. Code: ${response.code}, Message: ${response.message}")
                        // Log response body for more details if available
                         response.body?.string()?.let { Log.e(TAG, "Error response body: $it") }
                    } else {
                        Log.i(TAG, "Location successfully sent via OkHttp. Response: ${response.code}")
                        // Consume response body to release resources (even if not used)
                        response.body?.close()
                    }
                }
            } catch (e: IOException) {
                Log.e(TAG, "IOException sending location data", e)
                // Handle network errors (e.g., no internet)
            } catch (e: Exception) {
                Log.e(TAG, "Exception sending location data", e)
                // Handle other errors (e.g., JSON creation)
            }
        }
    }
    // --- End Implemented Functions ---


    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "onDestroy called")
        isServiceRunning = false
        stopLocationUpdates()
        serviceScope.cancel() // Cancel ongoing coroutines
        stopForeground(true) // Ensure foreground state is removed
    }

    // Binding is not used for started services like this one
    override fun onBind(intent: Intent?): IBinder? {
        return null
    }
}
