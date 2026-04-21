#!/usr/bin/env bash
# schema_parity_test.sh — Prove a fresh DB (migrated from empty) and an
# upgraded DB (restore + migrate) produce an identical schema.
#
# Usage:
#   DATABASE_URL=postgres://teslasync:pass@localhost:5432/teslasync \
#   MIGRATED_DB=teslasync \
#   bash scripts/validation/schema_parity_test.sh
#
# Requires: psql, pg_dump, go (to run migrations via cmd/teslasync).

set -euo pipefail

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-teslasync}"
DB_PASS="${DB_PASS:-pass}"
FRESH_DB="${FRESH_DB:-teslasync_fresh}"
MIGRATED_DB="${MIGRATED_DB:-teslasync}"

export PGPASSWORD="$DB_PASS"
PSQL_ADMIN="psql -h $DB_HOST -p $DB_PORT -U $DB_USER postgres"
FRESH_DSN="postgres://$DB_USER:$DB_PASS@$DB_HOST:$DB_PORT/$FRESH_DB?sslmode=disable"

echo "=== Schema Parity Test ==="
echo "Fresh DB    : $FRESH_DB"
echo "Migrated DB : $MIGRATED_DB"
echo

# 1. Rebuild fresh database from migrations
$PSQL_ADMIN -c "DROP DATABASE IF EXISTS $FRESH_DB;" >/dev/null
$PSQL_ADMIN -c "CREATE DATABASE $FRESH_DB;" >/dev/null

DATABASE_URL="$FRESH_DSN" go run ./cmd/teslasync --migrate-only

# 2. Dump both schemas (sorted, comment-stripped)
normalize() {
  pg_dump --schema-only --no-owner --no-privileges "$1" \
    | grep -v '^--' \
    | grep -v '^SET ' \
    | grep -v '^SELECT pg_catalog' \
    | grep -v '^$' \
    | sort
}

FRESH_FILE=$(mktemp)
MIGRATED_FILE=$(mktemp)
DIFF_FILE=$(mktemp)
trap 'rm -f "$FRESH_FILE" "$MIGRATED_FILE" "$DIFF_FILE"' EXIT

normalize "postgres://$DB_USER:$DB_PASS@$DB_HOST:$DB_PORT/$FRESH_DB"    > "$FRESH_FILE"
normalize "postgres://$DB_USER:$DB_PASS@$DB_HOST:$DB_PORT/$MIGRATED_DB" > "$MIGRATED_FILE"

if diff -u "$FRESH_FILE" "$MIGRATED_FILE" > "$DIFF_FILE"; then
  echo "✅ PASS — schemas are identical"
  $PSQL_ADMIN -c "DROP DATABASE IF EXISTS $FRESH_DB;" >/dev/null
  exit 0
fi

echo "❌ FAIL — schema differences detected:"
echo "---"
head -200 "$DIFF_FILE"
echo "---"
echo "(full diff kept at $DIFF_FILE — $FRESH_DB preserved for inspection)"
trap - EXIT
exit 1
