# TeslaSync Native

React Native foundation for TeslaSync parity across Android, iOS, Windows, and macOS.

## Stack

- React Native 0.81.6, pinned because React Native Windows and macOS both publish compatible 0.81.x packages.
- React 19.1.4.
- React Native Windows generated with the modern `cpp-app` WinAppSDK template.
- React Native macOS generated from the `react-native-macos@0.81.6` packaged template.
- TanStack Query for API data.

## Commands

```powershell
cd apps\native
npm run typecheck
npm test
npm run bundle:android
npm run bundle:windows
npm run check:packaging
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
npm run package:android
npm run package:ios
npm run package:windows
npm run package:macos
```

Signing secrets are never committed. Android release signing is enabled only when `ANDROID_UPLOAD_STORE_FILE`, `ANDROID_UPLOAD_STORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`, and `ANDROID_UPLOAD_KEY_PASSWORD` are present. Windows MSIX signing is enabled only when `WINDOWS_PACKAGE_CERTIFICATE_KEY_FILE` is present, with optional `WINDOWS_PACKAGE_CERTIFICATE_PASSWORD`. iOS and macOS package scripts run only on macOS hosts with Xcode and CocoaPods; they use unsigned local builds unless `IOS_DEVELOPMENT_TEAM`, or `MACOS_DEVELOPMENT_TEAM` plus `MACOS_CODE_SIGN_IDENTITY`, are provided by the environment.

## Current scope

This is the phase-0 app shell: premium dark glass UI, API client, dashboard, vehicles, settings, Android/iOS scaffold, Windows WinAppSDK scaffold, and macOS Xcode scaffold. It intentionally does not use Electron or WebView.

The native route manifest in `src/navigation/routes.ts` tracks all 157 `<Route path="...">` entries from `web/src/App.tsx`. The shell derives implemented and pending route counts from that typed manifest and shows the pending evidence for each native target.
