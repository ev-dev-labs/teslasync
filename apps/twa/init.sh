#!/usr/bin/env bash
# Scaffolds the TeslaSync Trusted Web Activity project for your domain.
#
#   ./init.sh https://teslasync.example.com com.example.teslasync [App Name]
#
# Prints the ANDROID_ASSETLINKS_JSON value to set on the server when done.
set -euo pipefail

HOST_URL="${1:-}"
PACKAGE_ID="${2:-}"
APP_NAME="${3:-TeslaSync}"

usage() {
  echo "usage: ./init.sh https://your-domain.example com.yourname.teslasync [App Name]" >&2
  exit 2
}

[ -n "$HOST_URL" ] && [ -n "$PACKAGE_ID" ] || usage

case "$HOST_URL" in
  https://*) ;;
  *) echo "error: host must be an https:// URL (got $HOST_URL)" >&2; exit 1 ;;
esac
HOST_URL="${HOST_URL%/}"
if [[ ! "$HOST_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then
  echo "error: host must be an HTTPS origin without credentials, paths or query parameters" >&2
  exit 1
fi

if ! [[ "$PACKAGE_ID" =~ ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$ ]]; then
  echo "error: package id must look like com.example.teslasync (got $PACKAGE_ID)" >&2
  exit 1
fi

for tool in bubblewrap keytool openssl curl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: missing required tool: $tool" >&2
    exit 1
  fi
done

if [ -z "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ]; then
  echo "error: set ANDROID_HOME (or ANDROID_SDK_ROOT) to your Android SDK" >&2
  exit 1
fi

MANIFEST_URL="$HOST_URL/manifest.webmanifest"
echo "-> checking PWA manifest at $MANIFEST_URL"
if ! curl -fsSL --max-time 20 "$MANIFEST_URL" | grep -q '"start_url"'; then
  echo "error: no installable PWA manifest at $MANIFEST_URL" >&2
  echo "  Is the server up, and is it serving the built web UI over HTTPS?" >&2
  exit 1
fi

if [ ! -f twa-manifest.json ]; then
  echo "-> running bubblewrap init"
  bubblewrap init \
    --manifest="$MANIFEST_URL" \
    --packageId="$PACKAGE_ID" \
    --appName="$APP_NAME" \
    --host="${HOST_URL#https://}" \
    --startUrl="/" \
    --themeColor="#0b0d12" \
    --backgroundColor="#0b0d12"
else
  echo "-> twa-manifest.json already exists, skipping bubblewrap init"
fi

if [ ! -f android.keystore ]; then
  echo "-> generating signing key (android.keystore)"
  STORE_PASS="$(openssl rand -base64 24 | tr -d '\n')"
  # PKCS12 keystores use a single password for the store and key.
  KEY_PASS="$STORE_PASS"
  printf '%s\n%s\n' "$STORE_PASS" "$KEY_PASS" > android-keystore.passwords
  chmod 600 android-keystore.passwords
  keytool -genkeypair \
    -keystore android.keystore -storepass "$STORE_PASS" \
    -alias android -keypass "$KEY_PASS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=TeslaSync TWA, OU=Self-hosted, O=TeslaSync" \
    -storetype PKCS12
  echo "   BACK UP android.keystore + android-keystore.passwords (both git-ignored)."
else
  echo "-> android.keystore already exists, reusing it"
  [ -f android-keystore.passwords ] || { echo "error: missing android-keystore.passwords for existing keystore" >&2; exit 1; }
  STORE_PASS="$(sed -n 1p android-keystore.passwords)"
fi

SHA256="$(keytool -list -v -keystore android.keystore -storepass "$STORE_PASS" -alias android 2>/dev/null \
  | grep -i 'SHA256:' | head -n 1 | awk '{print $2}')"
if [ -z "$SHA256" ]; then
  echo "error: could not read SHA-256 fingerprint from android.keystore" >&2
  exit 1
fi

echo
echo "Done. Set this on the server (single line) and restart it:"
echo
printf 'ANDROID_ASSETLINKS_JSON=[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"%s","sha256_cert_fingerprints":["%s"]}}]\n' \
  "$PACKAGE_ID" "$SHA256"
echo
echo "Then run ./build.sh"
