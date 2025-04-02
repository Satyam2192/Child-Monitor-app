const { withAndroidManifest } = require('@expo/config-plugins');

// Function to add permissions if they don't exist
function addPermissions(androidManifest, permissions) {
  if (!Array.isArray(androidManifest.manifest['uses-permission'])) {
    androidManifest.manifest['uses-permission'] = [];
  }
  permissions.forEach(permission => {
    if (!androidManifest.manifest['uses-permission'].some(p => p.$['android:name'] === permission)) {
      androidManifest.manifest['uses-permission'].push({
        $: { 'android:name': permission },
      });
      console.log(`Added permission: ${permission}`);
    }
  });
  return androidManifest;
}

const withAndroidBackgroundLocation = (config) => {
  // Add necessary permissions for foreground service and boot completion
  config = withAndroidManifest(config, (config) => {
    config.modResults = addPermissions(config.modResults, [
      'android.permission.ACCESS_BACKGROUND_LOCATION', // Already likely requested by expo-location, but ensures it
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION', // For Android 12+
      'android.permission.RECEIVE_BOOT_COMPLETED', // To allow restarting task after boot
    ]);
    return config;
  });

  return config;
};

module.exports = withAndroidBackgroundLocation;
