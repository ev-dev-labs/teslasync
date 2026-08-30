#!/usr/bin/env bash
# TeslaSync Violations Audit Script
# Usage: bash audit.sh [path]
# Default: audits web/src/features/

set -euo pipefail

TARGET="${1:-web/src/features/}"
TOTAL=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACT_PATHS="$SCRIPT_DIR/../verify-api-hooks/contract-paths.cjs"
GREP_EXCLUDES=(
  --exclude="*.test.ts"
  --exclude="*.test.tsx"
  --exclude="*.spec.ts"
  --exclude="*.spec.tsx"
  --exclude-dir="__tests__"
)
if command -v node >/dev/null 2>&1; then
  NODE_BIN="node"
elif command -v node.exe >/dev/null 2>&1; then
  NODE_BIN="node.exe"
  CONTRACT_PATHS="$(wslpath -w "$CONTRACT_PATHS")"
else
  echo "Node.js is required to audit request URL contracts." >&2
  exit 2
fi

echo "═══════════════════════════════════════════════════════════"
echo "  TeslaSync Engineering Guidelines Audit"
echo "  Target: $TARGET"
echo "═══════════════════════════════════════════════════════════"
echo ""

# --- 1. Static inline styles with var(--*) ---
echo "▸ [1/7] Static inline styles (var(--*))..."
MATCHES=$(grep -rn 'style={{' "$TARGET" --include="*.tsx" "${GREP_EXCLUDES[@]}" 2>/dev/null | grep 'var(--' | grep -v '?' | grep -v '\[' || true)
COUNT=$(printf '%s\n' "$MATCHES" | grep -c . || true)
if [ "$COUNT" -gt 0 ]; then
  echo "  ❌ $COUNT violation(s):"
  printf '%s\n' "$MATCHES" | sed -n '1,20p'
  TOTAL=$((TOTAL + COUNT))
else
  echo "  ✅ 0 violations"
fi
echo ""

# --- 2. Raw HTML elements ---
echo "▸ [2/7] Raw HTML elements..."
# Exclude components/ directories (they ARE the shared components)
MATCHES=$(grep -rnP '<button\b|<input\b|<textarea\b|<select\b|<table\b' "$TARGET" --include="*.tsx" "${GREP_EXCLUDES[@]}" 2>/dev/null | grep -v 'components/ui/' | grep -v 'components/charts/' | grep -v 'components/maps/' | grep -v 'components/forms/' | grep -vP ':[0-9]+:\s*(//|/\*|\*)' || true)
COUNT=$(printf '%s\n' "$MATCHES" | grep -c . || true)
if [ "$COUNT" -gt 0 ]; then
  echo "  ❌ $COUNT violation(s):"
  printf '%s\n' "$MATCHES" | sed -n '1,20p'
  TOTAL=$((TOTAL + COUNT))
else
  echo "  ✅ 0 violations"
fi
echo ""

# --- 3. Direct library imports ---
echo "▸ [3/7] Direct library imports..."
MATCHES=$(grep -rn "from 'recharts'\|from 'react-leaflet'\|from 'framer-motion'" "$TARGET" --include="*.tsx" --include="*.ts" "${GREP_EXCLUDES[@]}" 2>/dev/null | grep -v 'components/charts/index' | grep -v 'components/maps/index' | grep -v 'components/motion/' || true)
COUNT=$(printf '%s\n' "$MATCHES" | grep -c . || true)
if [ "$COUNT" -gt 0 ]; then
  echo "  ❌ $COUNT violation(s):"
  printf '%s\n' "$MATCHES" | sed -n '1,20p'
  TOTAL=$((TOTAL + COUNT))
else
  echo "  ✅ 0 violations"
fi
echo ""

# --- 4. Old API imports ---
echo "▸ [4/7] Old API imports..."
MATCHES=$(grep -rn "from '\.\./api'\|from '\.\./\.\./api'" "$TARGET" --include="*.tsx" --include="*.ts" "${GREP_EXCLUDES[@]}" 2>/dev/null || true)
COUNT=$(printf '%s\n' "$MATCHES" | grep -c . || true)
if [ "$COUNT" -gt 0 ]; then
  echo "  ❌ $COUNT violation(s):"
  printf '%s\n' "$MATCHES" | sed -n '1,20p'
  TOTAL=$((TOTAL + COUNT))
else
  echo "  ✅ 0 violations"
fi
echo ""

# --- 5. Double prefix in hooks ---
echo "▸ [5/7] Double /api/v1/ prefix..."
if [ "$#" -eq 0 ]; then
  HOOK_TARGET="web/src/api/hooks"
else
  HOOK_TARGET="$TARGET"
fi
REQUEST_ROWS=$("$NODE_BIN" "$CONTRACT_PATHS" requests "$HOOK_TARGET")
DOUBLE_PREFIX=$(printf '%s\n' "$REQUEST_ROWS" | awk -F '\t' '$2 ~ /^\/api\/v1(\/|$)/ { print $1 ": " $2 }')
COUNT=$(printf '%s\n' "$DOUBLE_PREFIX" | grep -c . || true)
if [ "$COUNT" -gt 0 ]; then
  echo "  ❌ $COUNT violation(s):"
  printf '%s\n' "$DOUBLE_PREFIX" | sed -n '1,20p'
  TOTAL=$((TOTAL + COUNT))
else
  echo "  ✅ 0 violations"
fi
echo ""

# --- 6. camelCase query params ---
echo "▸ [6/7] camelCase query params (vehicleId=)..."
CAMEL_PARAMS=$(printf '%s\n' "$REQUEST_ROWS" | awk -F '\t' '$2 ~ /[?&](vehicleId|driveId|sessionId|chargingId)=/ { print $1 ": " $2 }')
COUNT=$(printf '%s\n' "$CAMEL_PARAMS" | grep -c . || true)
if [ "$COUNT" -gt 0 ]; then
  echo "  ❌ $COUNT violation(s):"
  printf '%s\n' "$CAMEL_PARAMS" | sed -n '1,20p'
  TOTAL=$((TOTAL + COUNT))
else
  echo "  ✅ 0 violations"
fi
echo ""

# --- 7. TypeScript ---
echo "▸ [7/7] TypeScript compilation..."
cd web
if npx tsc --noEmit 2>&1; then
  echo "  ✅ TypeScript passes"
else
  echo "  ❌ TypeScript errors found"
  TOTAL=$((TOTAL + 1))
fi
cd ..

echo ""
echo "═══════════════════════════════════════════════════════════"
if [ "$TOTAL" -eq 0 ]; then
  echo "  ✅ ALL CHECKS PASSED — 0 total violations"
else
  echo "  ❌ AUDIT FAILED — $TOTAL total violation(s)"
fi
echo "═══════════════════════════════════════════════════════════"
