#!/usr/bin/env bash
# Preflights a TeslaSync PWA for manual MSIX packaging at PWABuilder.com.
#
#   ./package.sh https://teslasync.example.com [output-dir]
set -euo pipefail

SITE_URL="${1:-}"
[ -n "$SITE_URL" ] || { echo "usage: ./package.sh https://your-domain.example" >&2; exit 2; }
[ "$#" -eq 1 ] || { echo "usage: ./package.sh https://your-domain.example" >&2; exit 2; }

# Localhost is a secure context, so PWABuilder accepts it for smoke tests.
# Note the packaged app keeps this URL — a localhost build only ever
# talks to the machine it runs on. Ship builds need your https:// domain.
case "$SITE_URL" in
  https://*) ;;
  http://localhost|http://localhost:*|http://localhost/*) ;;
  http://127.0.0.1|http://127.0.0.1:*|http://127.0.0.1/*) ;;
  *) echo "error: site must be an https:// URL (http://localhost:* allowed for local smoke tests; got $SITE_URL)" >&2; exit 1 ;;
esac

command -v curl >/dev/null 2>&1 || { echo "error: curl is required" >&2; exit 1; }

echo "-> validating PWA manifest at ${SITE_URL%/}/manifest.webmanifest"
if ! curl -fsSL --max-time 20 "${SITE_URL%/}/manifest.webmanifest" | grep -q '"start_url"'; then
  echo "error: no installable PWA manifest there. Is the server up and serving the web UI over HTTPS?" >&2
  exit 1
fi

echo "Manifest found. Open https://www.pwabuilder.com/ and enter $SITE_URL."
echo "Select Windows to generate the MSIX; the @pwabuilder/cli does not support packaging."
