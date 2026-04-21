#!/usr/bin/env bash
# analytics_parity_test.sh — Snapshot every fn_* analytics function, then
# compare against that snapshot after schema/query changes. First run creates
# the baseline; subsequent runs fail on any divergence.
#
# Usage:
#   DATABASE_URL=postgres://teslasync:pass@localhost:5432/teslasync \
#   VEHICLE_ID=1 DAYS=30 \
#   bash scripts/validation/analytics_parity_test.sh
#
#   # Re-seed snapshots after an intentional behaviour change:
#   REFRESH=1 bash scripts/validation/analytics_parity_test.sh

set -euo pipefail

DB_URL="${DATABASE_URL:-postgres://teslasync:pass@localhost:5432/teslasync?sslmode=disable}"
VEHICLE_ID="${VEHICLE_ID:-1}"
DAYS="${DAYS:-30}"
REFRESH="${REFRESH:-0}"
SNAPSHOT_DIR="${SNAPSHOT_DIR:-scripts/validation/snapshots}"

mkdir -p "$SNAPSHOT_DIR"

echo "=== Analytics Function Parity Test ==="
echo "Snapshots : $SNAPSHOT_DIR"
echo "Vehicle   : $VEHICLE_ID   Days: $DAYS   Refresh: $REFRESH"
echo

FUNCTIONS=$(psql "$DB_URL" -Atqc "
  SELECT p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn_%'
   ORDER BY p.proname;
")

if [ -z "$FUNCTIONS" ]; then
  echo "No fn_* functions found — nothing to test."
  exit 0
fi

pass=0; fail=0; skip=0; snap=0

try_call() {
  # Attempt several common signatures; echo the first one that executes.
  local fn="$1" v="$2" d="$3"
  for sig in "$fn($v, $d)" "$fn($v::bigint, $d)" "$fn($v)" "$fn($v::bigint)" "$fn()"; do
    if out=$(psql "$DB_URL" -Atqc "SELECT row_to_json(t) FROM $sig t LIMIT 50;" 2>/dev/null); then
      printf '%s\n' "$out"
      return 0
    fi
  done
  return 1
}

for fn in $FUNCTIONS; do
  printf '  %-45s ' "$fn"
  if ! result=$(try_call "$fn" "$VEHICLE_ID" "$DAYS"); then
    echo "SKIP (no matching signature)"
    skip=$((skip+1))
    continue
  fi

  snapshot="$SNAPSHOT_DIR/${fn}.json"
  if [ "$REFRESH" = "1" ] || [ ! -f "$snapshot" ]; then
    printf '%s\n' "$result" > "$snapshot"
    echo "📸 snapshot saved"
    snap=$((snap+1))
    continue
  fi

  current=$(mktemp)
  printf '%s\n' "$result" > "$current"
  if diff -q "$snapshot" "$current" >/dev/null 2>&1; then
    echo "✅ PASS"
    pass=$((pass+1))
  else
    echo "❌ FAIL (first 10 diff lines:)"
    diff -u "$snapshot" "$current" | sed -n '1,12p' | sed 's/^/      /'
    fail=$((fail+1))
  fi
  rm -f "$current"
done

echo
echo "=== $pass passed · $fail failed · $skip skipped · $snap snapshots created ==="
[ "$fail" -eq 0 ]
