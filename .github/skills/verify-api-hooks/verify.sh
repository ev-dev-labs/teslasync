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

# Extract hook URLs (paths passed to request())
echo "▸ Extracting hook URLs from $HOOKS_DIR..."
HOOK_URLS=$(grep -rn "request<" "$HOOKS_DIR" --include="*.ts" | grep -oP "['\"]\`?/[^'\"]+['\"]\`?" | tr -d "'\"" | sed 's/\`//g' | sed 's/\${[^}]*}/\{PARAM\}/g' | sort -u)
HOOK_COUNT=$(echo "$HOOK_URLS" | wc -l)
echo "  Found $HOOK_COUNT unique URL patterns"
echo ""

# Check for double prefix
echo "▸ Checking for double /api/v1/ prefix..."
DOUBLE=$(grep -rn "'/api/v1/\|\"\/api\/v1\/" "$HOOKS_DIR" --include="*.ts" 2>/dev/null || true)
if [ -n "$DOUBLE" ]; then
  echo "  ❌ DOUBLE PREFIX found:"
  echo "$DOUBLE" | head -20
else
  echo "  ✅ No double prefix issues"
fi
echo ""

# Extract backend routes
echo "▸ Extracting backend routes from $ROUTER..."
ROUTES=$(grep -P 'r\.(Get|Post|Put|Delete|Patch)\(' "$ROUTER" | grep -oP '"[^"]*"' | tr -d '"' | sort -u)
ROUTE_COUNT=$(echo "$ROUTES" | wc -l)
echo "  Found $ROUTE_COUNT route patterns"
echo ""

# Check for camelCase params in hooks
echo "▸ Checking for camelCase query parameters..."
CAMEL=$(grep -rn 'vehicleId=\|driveId=\|sessionId=\|chargingId=' "$HOOKS_DIR" --include="*.ts" 2>/dev/null || true)
if [ -n "$CAMEL" ]; then
  echo "  ❌ camelCase params found (should be snake_case):"
  echo "$CAMEL" | head -20
else
  echo "  ✅ All params use snake_case"
fi
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "  Hook URL Patterns:"
echo "═══════════════════════════════════════════════════════════"
echo "$HOOK_URLS" | while read -r url; do
  # Normalize: remove query params for matching
  BASE=$(echo "$url" | sed 's/\?.*$//' | sed 's/\{PARAM\}/{id}/g')
  if echo "$ROUTES" | grep -qF "$BASE" 2>/dev/null; then
    echo "  ✅ $url"
  elif echo "$ROUTES" | grep -q "$(echo "$BASE" | sed 's/{id}//')" 2>/dev/null; then
    echo "  ⚠️  $url (partial match — verify structure)"
  else
    echo "  ❌ $url (NO MATCHING BACKEND ROUTE)"
  fi
done

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Review any ❌ or ⚠️ entries above"
echo "═══════════════════════════════════════════════════════════"
