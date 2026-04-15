#!/usr/bin/env bash
# TeslaSync Violations Audit Script
# Usage: bash audit.sh [path]
# Default: audits web/src/features/

set -euo pipefail

TARGET="${1:-web/src/features/}"
TOTAL=0

echo "═══════════════════════════════════════════════════════════"
echo "  TeslaSync Engineering Guidelines Audit"
echo "  Target: $TARGET"
echo "═══════════════════════════════════════════════════════════"
echo ""

# --- 1. Static inline styles with var(--*) ---
echo "▸ [1/7] Static inline styles (var(--*))..."
COUNT=$(grep -rn 'style={{' "$TARGET" --include="*.tsx" | grep 'var(--' | grep -v '?' | grep -v '\[' | wc -l || true)
if [ "$COUNT" -gt 0 ]; then
  echo "  ❌ $COUNT violation(s):"
  grep -rn 'style={{' "$TARGET" --include="*.tsx" | grep 'var(--' | grep -v '?' | grep -v '\[' | head -20
  TOTAL=$((TOTAL + COUNT))
else
  echo "  ✅ 0 violations"
fi
echo ""

# --- 2. Raw HTML elements ---
echo "▸ [2/7] Raw HTML elements..."
# Exclude components/ directories (they ARE the shared components)
COUNT=$(grep -rnP '<button\b|<input\b|<textarea\b|<select\b|<table\b' "$TARGET" --include="*.tsx" | grep -v 'components/ui/' | grep -v 'components/charts/' | grep -v 'components/maps/' | grep -v 'components/forms/' | wc -l || true)
if [ "$COUNT" -gt 0 ]; then
  echo "  ❌ $COUNT violation(s):"
  grep -rnP '<button\b|<input\b|<textarea\b|<select\b|<table\b' "$TARGET" --include="*.tsx" | grep -v 'components/' | head -20
  TOTAL=$((TOTAL + COUNT))
else
  echo "  ✅ 0 violations"
fi
echo ""

# --- 3. Direct library imports ---
echo "▸ [3/7] Direct library imports..."
COUNT=$(grep -rn "from 'recharts'\|from 'react-leaflet'\|from 'framer-motion'" "$TARGET" --include="*.tsx" --include="*.ts" | grep -v 'components/charts/index' | grep -v 'components/maps/index' | grep -v 'components/motion/' | wc -l || true)
if [ "$COUNT" -gt 0 ]; then
  echo "  ❌ $COUNT violation(s):"
  grep -rn "from 'recharts'\|from 'react-leaflet'\|from 'framer-motion'" "$TARGET" --include="*.tsx" --include="*.ts" | grep -v 'components/' | head -20
  TOTAL=$((TOTAL + COUNT))
else
  echo "  ✅ 0 violations"
fi
echo ""

# --- 4. Old API imports ---
echo "▸ [4/7] Old API imports..."
COUNT=$(grep -rn "from '\.\./api'\|from '\.\./\.\./api'" "$TARGET" --include="*.tsx" --include="*.ts" | wc -l || true)
if [ "$COUNT" -gt 0 ]; then
  echo "  ❌ $COUNT violation(s):"
  grep -rn "from '\.\./api'\|from '\.\./\.\./api'" "$TARGET" --include="*.tsx" --include="*.ts" | head -20
  TOTAL=$((TOTAL + COUNT))
else
  echo "  ✅ 0 violations"
fi
echo ""

# --- 5. Double prefix in hooks ---
echo "▸ [5/7] Double /api/v1/ prefix..."
COUNT=$(grep -rn "'/api/v1/\|\"\/api\/v1\/" web/src/api/hooks/ --include="*.ts" 2>/dev/null | wc -l || true)
if [ "$COUNT" -gt 0 ]; then
  echo "  ❌ $COUNT violation(s):"
  grep -rn "'/api/v1/\|\"\/api\/v1\/" web/src/api/hooks/ --include="*.ts" 2>/dev/null | head -20
  TOTAL=$((TOTAL + COUNT))
else
  echo "  ✅ 0 violations"
fi
echo ""

# --- 6. camelCase query params ---
echo "▸ [6/7] camelCase query params (vehicleId=)..."
COUNT=$(grep -rn 'vehicleId=' "$TARGET" --include="*.tsx" --include="*.ts" | wc -l || true)
if [ "$COUNT" -gt 0 ]; then
  echo "  ❌ $COUNT violation(s):"
  grep -rn 'vehicleId=' "$TARGET" --include="*.tsx" --include="*.ts" | head -20
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
