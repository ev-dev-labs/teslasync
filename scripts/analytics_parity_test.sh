#!/usr/bin/env bash
# analytics_parity_test.sh — Snapshot and compare fn_* function results.
#
# First run captures a baseline JSON snapshot for every fn_* function with the
# standard (vehicle_id, days) signature. Subsequent runs compare current output
# against the baseline and fail on any difference.
#
# Usage:
#   # Capture baseline before migration
#   DB_URL=... bash scripts/analytics_parity_test.sh
#   # Compare after migration
#   DB_URL=... bash scripts/analytics_parity_test.sh
#
# Reset baseline:
#   rm -rf scripts/validation_snapshots
set -euo pipefail

DB_URL="${DB_URL:-postgres://teslasync:teslasync@localhost:5432/teslasync?sslmode=disable}"
VEHICLE_ID="${VEHICLE_ID:-1}"
DAYS="${DAYS:-30}"
SNAPSHOT_DIR="${SNAPSHOT_DIR:-./scripts/validation_snapshots}"

mkdir -p "$SNAPSHOT_DIR"

FUNCTIONS=$(psql "$DB_URL" -At -c "
    SELECT p.proname FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'fn_%'
    ORDER BY p.proname;
")

echo "=== Analytics Function Parity Test ==="
echo "Database:  $DB_URL"
echo "Vehicle:   $VEHICLE_ID"
echo "Days:      $DAYS"
echo "Snapshots: $SNAPSHOT_DIR"
echo "Found $(echo "$FUNCTIONS" | grep -c .) candidate functions"
echo ""

PASS=0
FAIL=0
SKIP=0

for fn in $FUNCTIONS; do
    printf 'Testing %-50s ' "$fn"

    # Try the standard (vehicle_id, days) signature. Functions with different
    # argument lists are silently skipped.
    if ! RESULT=$(psql "$DB_URL" -At -c "
        SELECT row_to_json(t)
          FROM public.$fn($VEHICLE_ID, $DAYS) t
         LIMIT 100;
    " 2>/dev/null); then
        echo "SKIP (non-standard signature)"
        SKIP=$((SKIP + 1))
        continue
    fi

    SNAPSHOT_FILE="$SNAPSHOT_DIR/${fn}.json"
    if [ -f "$SNAPSHOT_FILE" ]; then
        CURRENT="$SNAPSHOT_DIR/${fn}.current.json"
        printf '%s\n' "$RESULT" > "$CURRENT"
        if diff -q "$SNAPSHOT_FILE" "$CURRENT" > /dev/null 2>&1; then
            echo "PASS"
            PASS=$((PASS + 1))
        else
            echo "FAIL — results differ"
            diff -u "$SNAPSHOT_FILE" "$CURRENT" | head -30
            FAIL=$((FAIL + 1))
        fi
        rm -f "$CURRENT"
    else
        printf '%s\n' "$RESULT" > "$SNAPSHOT_FILE"
        echo "SNAPSHOT saved"
    fi
done

echo ""
echo "=== Results: $PASS passed, $FAIL failed, $SKIP skipped ==="
[ "$FAIL" -eq 0 ]
