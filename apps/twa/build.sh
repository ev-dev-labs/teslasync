#!/usr/bin/env bash
# Builds the TeslaSync TWA. Run ./init.sh first.
#
#   ./build.sh        # app bundle (.aab, for Play) + APK
set -euo pipefail

[ -f twa-manifest.json ] || { echo "error: run ./init.sh first" >&2; exit 1; }
[ -f android.keystore ] || { echo "error: android.keystore missing (run ./init.sh)" >&2; exit 1; }
[ -f android-keystore.passwords ] || { echo "error: android-keystore.passwords missing" >&2; exit 1; }
[ "$#" -eq 0 ] || { echo "usage: ./build.sh" >&2; exit 2; }
command -v bubblewrap >/dev/null 2>&1 || { echo "error: bubblewrap not installed (npm i -g @bubblewrap/cli)" >&2; exit 1; }

STORE_PASS="$(sed -n 1p android-keystore.passwords)"
KEY_PASS="$(sed -n 2p android-keystore.passwords)"
export BUBBLEWRAP_KEYSTORE_PASSWORD="$STORE_PASS"
export BUBBLEWRAP_KEY_PASSWORD="$KEY_PASS"

echo "-> bubblewrap build (AAB + APK)"
bubblewrap build --skipPwaValidation

echo
echo "Outputs:"
ls -1 ./*.aab ./*.apk 2>/dev/null || true
