# TeslaSync Android app (Trusted Web Activity)

Builds a native Android app (APK/AAB) that opens your TeslaSync server
fullscreen — Play-Store uploadable, with your icon and splash screen.
It runs your server's PWA inside Chrome, using the server's own login
and live updates. Browser notification support depends on the server
and platform configuration.

Because TeslaSync is self-hosted, the app is bound to **your** domain: every
owner builds their own with their own signing key (same as how Immich and
other self-hosted apps do per-server builds). Alternatively, use the
generic Capacitor app in `apps/mobile`.

## Prerequisites

- Your server reachable over **HTTPS** with a valid certificate
  (TWA refuses plain HTTP).
- JDK 17: `java -version` → `17.x`.
- Android SDK (via [Android Studio](https://developer.android.com/studio))
  with `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) set.
- Bubblewrap: `npm i -g @bubblewrap/cli` (needs Node 18+).
- `keytool` (ships with the JDK) and `openssl`.

## Build

```sh
cd apps/twa
./init.sh https://teslasync.example.com com.example.teslasync
```

`init.sh` validates the PWA manifest, scaffolds the TWA project, creates a
signing key (`android.keystore` — **back it up**, Play ties updates to it),
and prints the Digital Asset Links JSON for your domain.

Then tell the server about the key (enables fullscreen, hides the browser
chrome, shares login state with Chrome):

```sh
# .env on the server (single line, no spaces needed but allowed):
ANDROID_ASSETLINKS_JSON=<paste the JSON init.sh printed>
```

Restart the server and confirm it serves the file:

```sh
curl https://teslasync.example.com/.well-known/assetlinks.json
```

Finally build and install:

```sh
./build.sh        # produces app-release-bundle.aab (Play) + app-release.apk
```

Upload the `.aab` to a Play internal-testing track, or sideload the `.apk`.

## Files (generated, git-ignored)

- `twa-manifest.json` — Bubblewrap project (your domain + package).
- `android.keystore` + `android-keystore.passwords` — signing key. **Never
  commit these.** Lose the keystore and you cannot update the Play listing.
- `app-release-*` — build outputs.

## Updating the app

Rebuilding is only needed to change the icon, splash, package name, or
target SDK. Web UI updates ship with the server — no rebuild required.
