# TeslaSync apps (iOS, Android, Windows)

One app per platform, every self-hosted server. Install the app, enter
your server address on first launch, and sign in:

Read the [TeslaSync privacy policy](/privacy) before connecting a server.
Your server operator controls the data stored on that server.

- **Open-mode servers** (no login configured): the address is enough.
- **Forward-auth servers** (Authelia/Authentik/etc.): paste an API key
  with **App sign-in** checked, created under Admin → API Keys on your
  server. The key signs the app in as you; revoke it there if a device
  is lost. Enter the key again when starting a new app session; saving
  the server address does not save the key across restarts.

PWA and per-domain TWA/MSIX UI changes ship with the server. The generic
Electron and Capacitor shells **bundle** `web/dist`; installed users
must update their apps to receive bundled UI changes.

## The apps

| Platform | Project | What it is |
|---|---|---|
| iOS + Android | [apps/mobile](https://github.com/ev-dev-labs/teslasync/blob/main/apps/mobile/README.md) | Generic native shell (Capacitor). Server picker on first launch, `teslasync://` deep links. Signing and store identities require owner setup. |
| Windows | [apps/desktop](https://github.com/ev-dev-labs/teslasync/blob/main/apps/desktop/README.md) | Generic desktop shell (Electron, NSIS installer). Same server picker, `teslasync://` protocol registration. |

Build once, point at any server. See each project's README for
prerequisites and store/packaging steps.

Each GitHub Release includes a Windows NSIS installer (`.exe`), an
unsigned Windows MSIX (`.msix`), and a debug-signed Android test APK
(`-debug.apk`). An MSIX built from the current configuration has the
TeslaSync Partner Center identity for Store submission, but needs a
matching publisher certificate and trusted signing before sideloading.
Microsoft signs the Store-distributed package; it does not sign the
GitHub Release asset.

The prerelease MSIX built before the Store identity was configured
still has the placeholder identity and cannot be submitted to this
Store product. Rebuild from the current desktop configuration.

The APK is for local testing, **not** a Play Store release; CI's debug
signing key changes per build, so uninstall an older CI APK before
installing the next (clearing local app data). The unsigned
Windows installer may show a reputation warning. Native builds bundle
the UI from that release; configure your own server on first launch.

## Install from the browser instead (no build)

Every server also ships an installable PWA with the same UI:

- **iPhone/iPad:** open your server in Safari → Share → Add to Home
  Screen. (Full-screen, own icon, push-capable on iOS 16.4+.)
- **Android:** Chrome → menu ⋮ → Add to Home screen → Install.
- **Windows:** Edge/Chrome → address-bar Install icon (Start-menu
  entry, taskbar pin, title-bar integration).

## Per-domain store packages (alternative)

If you'd rather publish a package bound to one specific domain:

- **Android TWA** (Play `.aab`): [apps/twa](https://github.com/ev-dev-labs/teslasync/blob/main/apps/twa/README.md).
  Set the printed `ANDROID_ASSETLINKS_JSON` on the server so the app
  verifies fullscreen.
- **Windows MSIX**: [apps/msix](https://github.com/ev-dev-labs/teslasync/blob/main/apps/msix/README.md)
  (PWABuilder packaging).

These predate the generic shells and remain supported, but most owners
should prefer the generic apps above — no rebuild per server.

## Server configuration

| Variable | Needed for | Default |
|---|---|---|
| `ANDROID_ASSETLINKS_JSON` | Android TWA fullscreen + Play verification | empty (endpoint 404s) |
| `CORS_ORIGINS` | Browser origin and generic native-shell API access (including state-changing requests) | empty (development wildcard CORS without credentials; no explicit CSRF origin allowlist) |

PWA/TWA/MSIX load the server first-party. Generic shells instead
make cross-origin API calls from `teslasync-app://app` (Electron),
`https://localhost` (Android Capacitor 7's default bundled origin), and
`capacitor://localhost` (iOS Capacitor 7's default bundled origin).
These are **app origins**, not the server address the user enters.
Android's default in the committed Capacitor 7 project is
`https://localhost`, **not** `http://localhost`; do not allowlist the
latter unless you explicitly change `server.androidScheme` to `http`.
Electron uses a registered secure, standard `teslasync-app` scheme,
not `file://` (which would send an opaque `Origin: null`).

For all three generic shells, add their exact origins **and your public
browser origin** to the API's comma-separated `CORS_ORIGINS` before
deploying. For example, in the server's Compose `.env`:

```dotenv
CORS_ORIGINS=https://teslasync.example.com,teslasync-app://app,https://localhost,capacitor://localhost
```

With Helm, set `config.nativeAppOrigins` in your values file:

```yaml
config:
  nativeAppOrigins:
    - teslasync-app://app
    - https://localhost
    - capacitor://localhost
```

The chart joins these with `config.webEndpoint` (or the HTTPS ingress
host derived when that setting is empty) into `CORS_ORIGINS`. Preserve
the public browser origin; if ingress does not provide one, set
`config.webEndpoint` to its public URL.
If you distribute only some wrappers, list only their origins. If you
override Capacitor's `server.hostname` or native scheme, substitute
the resulting app origin. Do not add paths, trailing slashes, or a
wildcard (`*`). Check the effective deployment environment rather than
assuming an ingress proxy supplies these origins automatically.

The API's CORS middleware must handle OPTIONS preflights and allow
`Authorization` and `Content-Type`; the reverse proxy must pass these
requests through without an interactive-login redirect. Generic
remote-mode requests omit cookies (including forward-auth browser
cookies); forward-auth servers require a bearer app key instead. The
API's CSRF middleware also uses `CORS_ORIGINS` to trust browser-originated
mutations; a **validated** app-sign-in key bypasses the CSRF origin
check after authentication, not the CORS preflight or key validation.
Open mode also permits loopback origins, but other open-mode native
origins require this explicit allowlist. Do not rely on that development
exception when deploying the wrappers.
The development wildcard does not establish a production origin
allowlist. Generic mobile builds require a trusted HTTPS server;
arbitrary HTTP LAN URLs are not supported.

### Behind an auth proxy?

If TeslaSync sits behind Authelia/Authentik/etc., configure the proxy
to pass bearer-authorized API calls through without redirecting them to
interactive login. Allow CORS preflight requests too. Restrict the bypass
to TeslaSync API routes and keep the server's API-key validation enabled.
Browser sessions can continue to use the proxy's normal login.

For the bundled Traefik IngressRoute chart, enable the opt-in routes instead
of maintaining separate middleware manifests:

```yaml
config:
  forwardAuthHeader: X-Forwarded-User # use your proxy's actual subject header
ingressRoute:
  enabled: true
  nativeAppAuth:
    enabled: true
    host: teslasync.example.com
    identityHeaders: [] # list every OTHER identity header your proxy forwards
```

The chart always strips `config.forwardAuthHeader` on bearer requests; list
any additional forwarded identity headers in `identityHeaders`. The bearer
route skips only the interactive proxy login: the API still validates the
app key. OPTIONS requests reach the API's CORS handler. Keep the browser
catch-all behind forward auth. This opt-in requires a chart version that
includes `nativeAppAuth`; older published charts ignore unknown values.

## How app sign-in works

- Admin → API Keys → **App sign-in** binds a key to your login
  (forward-auth mode only; open servers need no keys).
- The app sends the key as `Authorization: Bearer`. The server
  validates it, acts as you, and skips cookie-session minting. Generic
  shells keep the key in `sessionStorage`, not `localStorage`: it is
  cleared when the app session ends. Re-enter it after restarting the
  app, even if the server address remains saved.
- Keys never mint other keys; revoke/delete per key applies instantly.
- Device keys (no subject, for watches) keep working exactly as
  before and are rejected as app credentials.

## Troubleshooting

- **"Install" option missing (browser path):** the site must be HTTPS
  with a valid cert, and `/manifest.webmanifest` must return HTTP 200.
- **App can't reach the server:** the address must be exactly the
  server origin (`https://host[:port]`, no `/path`). Local addresses
  (`http://192.168.x.x:4000`) are not supported by generic mobile
  builds; use a trusted HTTPS certificate.
- **"This server needs an access token":** the server uses
  forward-auth login — create a key with App sign-in checked.
- **TWA still shows a browser bar:** `/.well-known/assetlinks.json`
  must return your package + signing-key fingerprint with no
  redirects.
- **Push not arriving (iOS):** notifications require the Home-Screen
  install (not a Safari tab) on iOS 16.4+.
