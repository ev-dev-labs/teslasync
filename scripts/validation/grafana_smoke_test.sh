#!/usr/bin/env bash
# grafana_smoke_test.sh — Pull every Grafana dashboard's SQL panel queries
# and run them with test variable values. Flags queries that error out; 0-row
# results are reported as warnings (panel may legitimately be empty).
#
# Usage:
#   GRAFANA_URL=http://localhost:3000 \
#   GRAFANA_TOKEN=glsa_xxx \
#   DATABASE_URL=postgres://teslasync:pass@localhost:5432/teslasync \
#   bash scripts/validation/grafana_smoke_test.sh

set -euo pipefail

: "${GRAFANA_URL:?GRAFANA_URL required}"
: "${GRAFANA_TOKEN:?GRAFANA_TOKEN required}"
: "${DATABASE_URL:?DATABASE_URL required}"

VEHICLE_ID="${VEHICLE_ID:-1}"

echo "=== Grafana Dashboard Smoke Test ==="
echo "Grafana : $GRAFANA_URL"
echo

dashboards=$(curl -sf -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "$GRAFANA_URL/api/search?type=dash-db" | jq -r '.[].uid')

pass=0; fail=0; warn=0

for uid in $dashboards; do
  dash=$(curl -sf -H "Authorization: Bearer $GRAFANA_TOKEN" \
    "$GRAFANA_URL/api/dashboards/uid/$uid")
  title=$(echo "$dash" | jq -r '.dashboard.title')

  echo "▶ $title"

  queries=$(echo "$dash" | jq -r '
      [.dashboard.panels[]?,
       (.dashboard.panels[]?.panels[]? // empty)]
      | .[] | select(.targets) | .targets[]? | select(.rawSql) | .rawSql
  ')
  if [ -z "$queries" ]; then
    echo "    (no SQL panels)"
    continue
  fi

  # Macro substitution: replace Grafana template variables with safe defaults
  substituted=$(echo "$queries" | python3 -c '
import re, sys
text = sys.stdin.read()
def sub(t, vid):
    t = re.sub(r"\$vehicle_id", str(vid), t)
    t = re.sub(r"\$__timeFilter\(([^)]+)\)", r"\1 > NOW() - INTERVAL ''"'"''30 days''"'"''", t)
    t = re.sub(r"\$__timeGroup\(([^,]+),[^)]+\)", r"time_bucket(''"'"''1 hour''"'"'', \1)", t)
    t = re.sub(r"\$__interval", "1 hour", t)
    t = re.sub(r"\$__from", "extract(epoch from NOW() - INTERVAL ''"'"''30 days''"'"'') * 1000", t)
    t = re.sub(r"\$__to",   "extract(epoch from NOW()) * 1000", t)
    return t
for line in text.strip().split("\n"):
    if line.strip():
        print(sub(line, sys.argv[1]))
        print("---QEND---")
' "$VEHICLE_ID")

  # Iterate queries (separated by our sentinel)
  q=""
  while IFS= read -r line; do
    if [ "$line" = "---QEND---" ]; then
      [ -z "$q" ] && continue
      if out=$(psql "$DATABASE_URL" -Atqc "SELECT count(*) FROM ($q) sub;" 2>&1); then
        if [ "$out" -gt 0 ] 2>/dev/null; then
          pass=$((pass+1))
          echo "    ✅ ${out} rows  $(echo "$q" | head -c 60)…"
        else
          warn=$((warn+1))
          echo "    ⚠ 0 rows     $(echo "$q" | head -c 60)…"
        fi
      else
        fail=$((fail+1))
        echo "    ❌ ERROR     $(echo "$q" | head -c 60)…"
        echo "       $out" | head -c 200
        echo
      fi
      q=""
    else
      q="${q}${line}
"
    fi
  done <<< "$substituted"
done

echo
echo "=== $pass ok · $warn empty · $fail errored ==="
[ "$fail" -eq 0 ]
