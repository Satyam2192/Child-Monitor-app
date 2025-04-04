const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Add custom resolver to handle react-native-maps web issue
config.resolver = {
  ...config.resolver,
  resolveRequest: (context, moduleName, platform) => {
    if (
      platform === 'web' &&
      moduleName.includes('react-native-maps') &&
      context.originModulePath.includes('react-native-maps') &&
      moduleName === 'react-native/Libraries/Utilities/codegenNativeCommands'
    ) {
      // Return false to effectively ignore this import on web
      return false;
    }
    // Fallback to default resolver
    return context.resolveRequest(context, moduleName, platform);
  },
};


module.exports = withNativeWind(config, { input: './app/globals.css' });
