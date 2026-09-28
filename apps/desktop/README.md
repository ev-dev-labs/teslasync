# TeslaSync desktop app (Electron — Windows)

Generic desktop shell around the web UI: one build serves every
self-hosted server — the app boots to the server picker (`/connect`)
on first launch, where the user enters their server address and (on
forward-auth servers) pastes an API key with **App sign-in** enabled.
The [privacy policy](https://teslasync.dev/privacy) explains what the
app stores locally and what is sent to the selected server.

## Run

```sh
cd apps/desktop
npm install
npm run build:web   # builds ../../web/dist (skip if already built)
npm start
```

## Ship (Windows)

```sh
npm run dist        # → release/TeslaSync-*.exe (NSIS installer)
```

Run on Windows to create an NSIS installer; signing and automatic
updates are **not** configured. `npm run dist:dir` produces an unpacked
folder for smoke-testing. Only Windows distribution is configured;
macOS and Linux require separate targets and testing.

## MSIX/AppX package (local validation)

Builds an **unsigned** AppX locally, then repacks it with the Windows
SDK's `makeappx.exe` into a real MSIX package (and verifies it can be
unpacked). Do not rename an `.appx` file to `.msix`. Installing it
requires a signing certificate, a matching
`appx.publisher` value, and a trusted certificate on the target
machine. Store submissions require your Partner Center publisher
identity.

```powershell
cd apps\desktop
npm run dist:appx   # → release\TeslaSync-*.appx
.\package-msix.ps1 -Appx 'release\TeslaSync 2.0.0.appx' -Msix 'release\TeslaSync-test.msix'
```

For local testing, configure electron-builder with a test PFX via
`CSC_LINK` and `CSC_KEY_PASSWORD`, set `appx.publisher` to the exact
certificate subject, and trust the certificate on your test device.
Then enable Windows Developer Mode and install the signed package with
`Add-AppxPackage`. The default `CN=TeslaSync` is only an example; do
not submit it to a store unchanged.

The release workflow attaches the unsigned `.msix` and unsigned NSIS
`.exe` installer to each GitHub Release. The MSIX is **not installable
without signing**; the installer may trigger a Windows reputation
warning. Neither asset is submitted to the Microsoft Store automatically.

## What's inside

- `main.js` — serves `web/dist` from the stable
  `teslasync-app://app` origin (so server settings persist), with SPA
  fallback, single-instance lock, `teslasync://` link handling, and
  a theme-matched Windows title bar. No Node access from the page
  (`contextIsolation` + `sandbox`).
- `preload.js` — exposes the shell marker and deep-link events, and keeps
  the native window controls and running taskbar icon synchronized with
  the app's theme. The packaged AppX tile and installer shortcut icons
  remain the build-time red artwork; they cannot follow arbitrary
  per-user colors selected after installation.
- `electron-builder.yml` — NSIS installer config, `teslasync://`
  protocol registration on install.

## Notes

- Login is the server's own: open-mode servers need just the address;
  forward-auth servers need an API key with **App sign-in** checked
  (Admin → API Keys on the server).
- During development, rebuild `web/dist` to pick up UI changes;
  installed users need a new installer for bundled UI changes.
