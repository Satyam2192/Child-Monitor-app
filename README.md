npx expo start --clear


cd client/android && ./gradlew assembleRelease

# For a development build (recommended for testing)
eas build --profile development --platform android

# Or for a production build
# eas build --profile production --platform android