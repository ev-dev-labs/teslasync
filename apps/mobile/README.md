# TeslaSync mobile app (Capacitor — iOS + Android)

Generic native shell around the web UI: one build serves every
self-hosted server — the app boots to the server picker (`/connect`)
on first launch, where the user enters their server address and (on
forward-auth servers) pastes an API key with **App sign-in** enabled.
The [privacy policy](https://teslasync.dev/privacy) explains what the
app stores locally and what is sent to the selected server.

## Prerequisites

- A released web build: `npm run build` in `web/` (this shell copies
  `web/dist` into the native projects on `cap sync`).
- An HTTPS server with a trusted certificate for API access. iOS
  App Transport Security and Android WebView do not support arbitrary
  plain-HTTP LAN endpoints in this release.
- Android: [Android Studio](https://developer.android.com/studio) + SDK.
- iOS: macOS + Xcode + CocoaPods (`pod install` runs via `cap sync`).

## Run

```sh
cd apps/mobile
npm install
npx cap sync        # copy web/dist + update native dependencies
npx cap open android  # or: npx cap open ios
```

Then run from Android Studio / Xcode on an emulator or device.

## Ship

- GitHub Releases include a **debug-signed test APK** (`-debug.apk`)
  that can be installed on a device/emulator with `adb install`.
  It is not a production-signed release or a Play Store package. CI
  generates a fresh debug signing key for each build, so uninstall an
  older CI APK before installing a newer one (this clears its saved
  server address and other app data).
- Android: Build → Generate Signed Bundle/APK in Android Studio (`.aab`
  for Play). Back up the signing key.
- iOS: Product → Archive in Xcode, upload to App Store Connect.
- After any web UI change: rebuild `web/dist`, re-run `npx cap sync`,
  and ship a new binary. The UI is bundled rather than loaded from
  the remote server.

For a local test build on Windows after building the web UI:

```powershell
cd apps\mobile
npm install
npx cap sync android
cd android
.\gradlew.bat assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
adb shell am start -n com.teslasync.app/.MainActivity
```

## What's inside

- `capacitor.config.json` — app id `com.teslasync.app`, bundled `webDir`.
- `android/`, `ios/` — committed native projects (icons + splash
  generated from `assets/`).
- `assets/` — icon/splash sources; regenerate with
  `npx @capacitor/assets generate --ios --android` (needs the
  `@capacitor/assets` dev dependency). The installed Android/iOS
  launcher icon uses the packaged red artwork; unlike the web favicon,
  it cannot follow arbitrary per-user theme colors at runtime.
- Custom scheme `teslasync://` is registered on both platforms and
  routed in-app by `NativeDeepLinks` (top-level pages only).

## Notes

- Login is the server's own: open-mode servers need just the address;
  forward-auth servers need an API key with **App sign-in** checked
  (Admin → API Keys on the server).
- The WebView stores the server address in localStorage and the API key
  in sessionStorage, **not** the OS keychain. Android backup and device transfer of app
  data are disabled to reduce token exposure; anyone with access to
  the unlocked app can still use its key. Use a dedicated revocable
  app key and revoke it immediately if the device is lost.
- Set your own unique Android application ID and iOS bundle
  identifier before distributing on app stores.
- CocoaPods installation needs network access to the specs repository
  on first sync.
