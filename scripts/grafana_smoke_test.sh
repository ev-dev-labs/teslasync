#!/usr/bin/env bash
# grafana_smoke_test.sh — Verify all Grafana dashboard SQL queries execute and
# return a row count without error.
#
# Variables in panel rawSql ($vehicle_id, $__timeFilter, $__interval,
# $__timeGroup) are substituted with reasonable defaults so the queries can be
# wrapped in `SELECT count(*) FROM (...) sub` and executed against the database.
#
# Usage:
#   GRAFANA_URL=http://localhost:3000 \
#   GRAFANA_TOKEN=glsa_xxx \
#   DB_URL=postgres://teslasync:teslasync@localhost:5432/teslasync \
#       bash scripts/grafana_smoke_test.sh
set -euo pipefail

DB_URL="${DB_URL:-postgres://teslasync:teslasync@localhost:5432/teslasync?sslmode=disable}"
GRAFANA_URL="${GRAFANA_URL:-http://localhost:3000}"
GRAFANA_TOKEN="${GRAFANA_TOKEN:-}"
VEHICLE_ID="${VEHICLE_ID:-1}"

if [ -z "$GRAFANA_TOKEN" ]; then
    echo "GRAFANA_TOKEN env var is required" >&2
    exit 2
fi

command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }

echo "=== Grafana Dashboard Smoke Test ==="
echo "Grafana: $GRAFANA_URL"
echo ""

DASHBOARDS=$(curl -fsS -H "Authorization: Bearer $GRAFANA_TOKEN" \
    "$GRAFANA_URL/api/search?type=dash-db" | jq -r '.[].uid')

PASS=0
FAIL=0
SKIP=0

substitute_vars() {
    sed \
        -e "s/\\\$vehicle_id/$VEHICLE_ID/g" \
        -e "s/\\\$__timeFilter(\\([^)]*\\))/\\1 > NOW() - INTERVAL '30 days'/g" \
        -e "s/\\\$__interval/'1 hour'/g" \
        -e "s/\\\$__timeGroup(\\([^,]*\\),[^)]*)/time_bucket('1 hour', \\1)/g"
}

for uid in $DASHBOARDS; do
    DASHBOARD=$(curl -fsS -H "Authorization: Bearer $GRAFANA_TOKEN" \
        "$GRAFANA_URL/api/dashboards/uid/$uid")

    TITLE=$(echo "$DASHBOARD" | jq -r '.dashboard.title')
    echo ""
    echo "Dashboard: $TITLE ($uid)"

    QUERIES=$(echo "$DASHBOARD" | jq -r '
        .dashboard.panels[]?
        | select(.targets)
        | .targets[]?
        | select(.rawSql)
        | .rawSql
    ' 2>/dev/null || true)

    if [ -z "$QUERIES" ]; then
        echo "  (no SQL queries)"
        SKIP=$((SKIP + 1))
        continue
    fi

    while IFS= read -r query; do
        [ -n "$query" ] || continue
        test_query=$(printf '%s' "$query" | substitute_vars)

        if ROW_COUNT=$(psql "$DB_URL" -At -c \
            "SELECT count(*) FROM ($test_query) sub;" 2>/dev/null); then
            echo "  PASS ($ROW_COUNT rows): ${query:0:70}"
            PASS=$((PASS + 1))
        else
            echo "  FAIL: ${query:0:70}"
            FAIL=$((FAIL + 1))
        fi
    done <<< "$QUERIES"
done

echo ""
echo "=== Results: $PASS passed, $FAIL failed, $SKIP dashboards skipped ==="
[ "$FAIL" -eq 0 ]
