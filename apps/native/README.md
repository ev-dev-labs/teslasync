# TeslaSync Native

React Native foundation for TeslaSync parity across Android, iOS, Windows, and macOS.

## Stack

- React Native 0.81.6, pinned because React Native Windows and macOS both publish compatible 0.81.x packages.
- React 19.1.4.
- React Native Web with Vite for browser parity smoke checks.
- React Native Windows generated with the modern `cpp-app` WinAppSDK template.
- React Native macOS generated from the `react-native-macos@0.81.6` packaged template.
- TanStack Query for API data.

## Commands

```powershell
cd apps\native
npm run typecheck
npm test
npm run web:dev
npm run web:build
npm run web:package
npm run bundle:android
npm run bundle:windows
npm run check:packaging
npm run gate:web
npm run android
npm run ios
npm run windows
npm run macos
```

The native API client auto-adds `/api/v1`, so app code must call paths like `/vehicles` and use snake_case query params.

## Packaging and signing

Packaging entrypoints are scripted so CI can run the same commands locally:

```powershell
cd apps\native
npm run package:web
npm run package:android
npm run package:ios
npm run package:windows
npm run package:macos
```

`npm run package:web` runs the RN web Vite production build and archives `.web-build` to `.packages\web\teslasync-native-web.zip`. `npm run check:packaging` verifies the RN web, Android, iOS, Windows, and macOS project/package entrypoints, confirms `react-native-macos` 0.81.x is installed, and checks that `npx react-native config` registers the generated macOS Xcode project with `build-macos` and `run-macos` commands. Android release packaging builds both APK and AAB artifacts when the Android SDK is available.

Signing secrets are never committed. Android release signing is enabled only when `ANDROID_UPLOAD_STORE_FILE`, `ANDROID_UPLOAD_STORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`, and `ANDROID_UPLOAD_KEY_PASSWORD` are present. Windows MSIX signing is enabled only when `WINDOWS_PACKAGE_CERTIFICATE_KEY_FILE` is present, with optional `WINDOWS_PACKAGE_CERTIFICATE_PASSWORD`. iOS and macOS package scripts run only on macOS hosts with Xcode and CocoaPods; they use unsigned local builds unless `IOS_DEVELOPMENT_TEAM`, or `MACOS_DEVELOPMENT_TEAM` plus `MACOS_CODE_SIGN_IDENTITY`, are provided by the environment.

## Current scope

This native parity shell includes premium dark glass UI, typed API hooks, dashboard widgets, vehicle/charging/driving surfaces, energy and system diagnostics, notifications, auth/settings, Android/iOS scaffolds, Windows WinAppSDK scaffolding, macOS project/package scaffolding, and a React Native Web target for browser smoke checks. It intentionally does not use Electron or WebView.

The native route manifest in `src/navigation/routes.ts` tracks all 157 `<Route path="...">` entries from `web/src/App.tsx`. The shell derives route counts from that typed manifest and shows implemented native evidence for every mapped route target.
