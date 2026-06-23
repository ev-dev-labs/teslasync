# TeslaSync Native

React Native foundation for TeslaSync parity across Android, iOS, Windows, and later macOS.

## Stack

- React Native 0.81.6, pinned because React Native Windows and macOS both publish compatible 0.81.x packages.
- React 19.1.4.
- React Native Windows generated with the modern `cpp-app` WinAppSDK template.
- TanStack Query for API data.

## Commands

```powershell
cd apps\native
npm run typecheck
npm test
npm run android
npm run ios
npm run windows
```

The native API client auto-adds `/api/v1`, so app code must call paths like `/vehicles` and use snake_case query params.

## Current scope

This is the phase-0 app shell: premium dark glass UI, API client, dashboard, vehicles, settings, Android/iOS scaffold, and Windows WinAppSDK scaffold. It intentionally does not use Electron or WebView.
