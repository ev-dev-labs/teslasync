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
unpacked). Do not rename an `.appx` file to `.msix`. The package
identity in `electron-builder.yml` matches the TeslaSync MSIX app in
Partner Center (Store ID `9NKH07ZV3V96`). Submit the unsigned MSIX
through that product's **Packages** page for Microsoft to sign and
distribute; the EXE/MSI submission flow cannot accept it.

Packages built before this identity change, including the earlier
prerelease MSIX, have the old placeholder identity and must not be
uploaded to this product.
The package targets Windows 10 version 1809 or newer; Partner Center
rejects MSIX packages with `MinVersion` at or below `10.0.17134.0`.
The `assets/appx/` PNGs use the red-bolt launcher artwork from
`web/public/icons/icon-512.png` for the Store and Windows tiles;
electron-builder otherwise embeds its generic sample app logos.
The Store listing's optional square logo can be uploaded separately
on the **Store listings** page (`release/TeslaSync-Store-listing-logo-1080.png`,
1080×1080). The portrait poster is a separate 720×1080 PNG in `release/`;
do not upload it in the square-logo slot. Additional `release/TeslaSync-Store-screenshot-*.png`
images are existing app captures with sample vehicle data; review them
before uploading, since older captures may show earlier UI branding.
The branded MSIX is an update and must have a higher package version than
the published package.
The Electron full-trust app declares `runFullTrust`; explain its use
as a desktop application in Partner Center's **Submission options →
Restricted capabilities** section when submitting for certification.

The unsigned MSIX is not installable by sideloading. Local sideload
testing still requires a signing certificate with a subject matching
`appx.publisher`, trusted on the test machine. Microsoft Store signing
only applies to packages installed through the Store, not to the
unsigned file attached to a GitHub release.
The `publisher` and `identityName` values must remain matched to
**Product Identity** in Partner Center. The public publisher label
comes from the developer account's **Publisher display name** under
Account settings, not the app's product name. The manifest's
`publisherDisplayName` must match that account label (`Own Apps`),
while the assigned `publisher` and `identityName` stay unchanged.

```powershell
cd apps\desktop
npm run dist:appx   # → release\TeslaSync-*.appx
.\package-msix.ps1 -Appx 'release\TeslaSync 2.0.1.appx' -Msix 'release\TeslaSync-Store-2.0.1.msix'
```

For local testing, configure electron-builder with a test PFX via
`CSC_LINK` and `CSC_KEY_PASSWORD`, use a test certificate whose subject
matches the configured `appx.publisher`, and trust the certificate on
your test device. Then enable Windows Developer Mode and install the
signed package with `Add-AppxPackage`. Do not commit a test certificate
or its password, and do not upload a test-signed package to the Store.

The release workflow attaches the unsigned `.msix` and unsigned NSIS
`.exe` installer to each GitHub Release. The MSIX is **not installable
without signing**; the installer may trigger a Windows reputation
warning. Store submissions remain manual: download the `.msix` from
the GitHub Release and upload it to the TeslaSync product in Partner
Center. No Microsoft Entra tenant or billing setup is required for
this workflow.

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
