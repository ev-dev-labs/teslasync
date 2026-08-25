#!/usr/bin/env bash
# TeslaSync API Hook Verification Script
# Cross-references frontend hook URLs against backend router.go
set -euo pipefail

echo "═══════════════════════════════════════════════════════════"
echo "  TeslaSync API Hook Verification"
echo "═══════════════════════════════════════════════════════════"
echo ""

HOOKS_DIR="web/src/api/hooks"
ROUTER="internal/api/router.go"
TARGET="${1:-$HOOKS_DIR}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACT_PATHS="$SCRIPT_DIR/contract-paths.cjs"
ISSUES=0
if command -v node >/dev/null 2>&1; then
  NODE_BIN="node"
elif command -v node.exe >/dev/null 2>&1; then
  NODE_BIN="node.exe"
  CONTRACT_PATHS="$(wslpath -w "$CONTRACT_PATHS")"
else
  echo "Node.js is required to verify API hook contracts." >&2
  exit 2
fi

# Extract hook URLs (paths passed to request())
echo "▸ Extracting hook URLs from $TARGET..."
HOOK_ROWS=$("$NODE_BIN" "$CONTRACT_PATHS" requests "$TARGET")
HOOK_URLS=$(printf '%s\n' "$HOOK_ROWS" | cut -f2- | sort -u)
HOOK_COUNT=$(printf '%s\n' "$HOOK_URLS" | grep -c . || true)
echo "  Found $HOOK_COUNT unique URL patterns"
echo ""

# Check for double prefix
echo "▸ Checking for double /api/v1/ prefix..."
DOUBLE=$(printf '%s\n' "$HOOK_ROWS" | awk -F '\t' '$2 ~ /^\/api\/v1(\/|$)/ { print $1 ": " $2 }')
if [ -n "$DOUBLE" ]; then
  echo "  ❌ DOUBLE PREFIX found:"
  echo "$DOUBLE" | head -20
  ISSUES=$((ISSUES + $(printf '%s\n' "$DOUBLE" | grep -c .)))
else
  echo "  ✅ No double prefix issues"
fi
echo ""

# Extract backend routes
echo "▸ Extracting backend routes from $ROUTER and mounted route modules..."
ROUTES=$("$NODE_BIN" "$CONTRACT_PATHS" routes internal/api internal/handler/v1)
ROUTE_COUNT=$(printf '%s\n' "$ROUTES" | grep -c . || true)
echo "  Found $ROUTE_COUNT route patterns"
echo ""

# Check for camelCase params in hooks
echo "▸ Checking for camelCase query parameters..."
CAMEL=$(printf '%s\n' "$HOOK_ROWS" | awk -F '\t' '$2 ~ /[?&](vehicleId|driveId|sessionId|chargingId)=/ { print $1 ": " $2 }')
if [ -n "$CAMEL" ]; then
  echo "  ❌ camelCase params found (should be snake_case):"
  echo "$CAMEL" | head -20
  ISSUES=$((ISSUES + $(printf '%s\n' "$CAMEL" | grep -c .)))
else
  echo "  ✅ All params use snake_case"
fi
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "  Hook URL Patterns:"
echo "═══════════════════════════════════════════════════════════"
while read -r url; do
  if [ -z "$url" ]; then
    continue
  fi
  # Normalize: remove query params for matching
  BASE=$(echo "$url" | sed 's/\?.*$//' | sed 's/{[^}]*}/{PARAM}/g' | sed 's:/$::')
  # A final expression appended directly to a path is a query-string helper
  # whose implementation the TypeScript extractor cannot resolve
  # interprocedurally (for example `/alerts${buildQuery(params)}`). Preserve
  # real dynamic path segments (`/{PARAM}`) while removing only this suffix.
  BASE=$(echo "$BASE" | sed -E 's/([^/])\{PARAM\}$/\1/')
  # Generic hook factories legitimately receive a path segment as a function
  # parameter (for example `/fleet-ops/${resource}`). Treat extracted
  # `{PARAM}` segments as one-segment wildcards and require at least one
  # concrete registered route to match the complete shape.
  ROUTE_PATTERN=$(echo "$BASE" | sed 's/{PARAM}/[^\/]+/g')
  if printf '%s\n' "$ROUTES" | grep -Eq "^${ROUTE_PATTERN}$" 2>/dev/null; then
    echo "  ✅ $url"
  else
    echo "  ❌ $url (NO MATCHING BACKEND ROUTE)"
    ISSUES=$((ISSUES + 1))
  fi
done <<< "$HOOK_URLS"

echo ""
echo "═══════════════════════════════════════════════════════════"
if [ "$ISSUES" -eq 0 ]; then
  echo "  ✅ ALL EXTRACTED HOOK PATHS MATCH REGISTERED ROUTES"
else
  echo "  ❌ API HOOK VERIFICATION FAILED — $ISSUES issue(s)"
fi
echo "═══════════════════════════════════════════════════════════"

if [ "$ISSUES" -gt 0 ]; then
  exit 1
fi
