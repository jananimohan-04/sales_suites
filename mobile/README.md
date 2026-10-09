# Argus Field — Android app (APK)

A Capacitor shell that opens the hosted Argus server in a native WebView and adds native Google sign-in
(Google blocks its web sign-in inside WebViews). The server and web app are unchanged — one codebase, web + Android.

## Build
```powershell
cd mobile
$env:APP_URL = "https://your-server-address"      # HTTPS is required for camera + GPS
npx cap sync android
cd android; .\gradlew.bat assembleDebug
```
APK: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`

## Google sign-in for the APK (one-time)
In Google Cloud Console > Credentials create an **Android** OAuth client:
package name `ai.axioralabs.argusfield` + the SHA-1 of the signing key
(debug key: `keytool -list -v -keystore %USERPROFILE%\.android\debug.keystore -alias androiddebugkey -storepass android`).
Keep using the existing **Web** client ID in the server's `GOOGLE_CLIENT_ID` — no change needed.
