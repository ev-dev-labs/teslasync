#!/usr/bin/env bash
# schema_parity_test.sh — Compare schemas between fresh install and migrated database.
#
# Verifies that a fresh database (all migrations applied from scratch) produces
# the exact same schema as a database that was migrated forward from an older
# baseline. Catches drift between baseline + incremental migrations.
#
# Usage:
#   FRESH_DB=teslasync_fresh MIGRATED_DB=teslasync_migrated \
#   PGURL_BASE=postgres://teslasync:teslasync@localhost:5432 \
#       bash scripts/schema_parity_test.sh
set -euo pipefail

FRESH_DB="${FRESH_DB:-teslasync_fresh}"
MIGRATED_DB="${MIGRATED_DB:-teslasync_migrated}"
PGURL_BASE="${PGURL_BASE:-postgres://teslasync:teslasync@localhost:5432}"
MIGRATION_DIR="${MIGRATION_DIR:-./migrations}"

echo "=== Schema Parity Test ==="
echo "Fresh DB:    $FRESH_DB"
echo "Migrated DB: $MIGRATED_DB"

# 1. Recreate the fresh database from scratch and apply every migration.
psql "$PGURL_BASE/postgres" -c "DROP DATABASE IF EXISTS $FRESH_DB;"
psql "$PGURL_BASE/postgres" -c "CREATE DATABASE $FRESH_DB;"

DATABASE_URL="$PGURL_BASE/$FRESH_DB?sslmode=disable" \
    go run ./cmd/teslasync --migrate-only

# 2. Dump both schemas, normalize whitespace and comments for a clean diff.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

dump_schema() {
    local db="$1" out="$2"
    pg_dump --schema-only --no-owner --no-privileges \
        "$PGURL_BASE/$db?sslmode=disable" \
        | grep -v '^--' | grep -v '^$' | sort > "$out"
}

dump_schema "$FRESH_DB"    "$TMP/fresh.sql"
dump_schema "$MIGRATED_DB" "$TMP/migrated.sql"

# 3. Diff and report.
if diff -u "$TMP/fresh.sql" "$TMP/migrated.sql" > "$TMP/diff.txt"; then
    echo "PASS: schemas are identical"
    exit 0
else
    echo "FAIL: schema differences found"
    cat "$TMP/diff.txt"
    exit 1
fi
