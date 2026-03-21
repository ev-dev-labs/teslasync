#!/bin/bash
set -e

echo "🚀 TeslaSync E2E Test Suite"
echo "=========================="

BASE_URL="${BASE_URL:-http://localhost:8080}"
WEB_URL="${WEB_URL:-http://localhost:3000}"

pass=0
fail=0

check() {
    local name="$1" url="$2" expected="$3" method="${4:-GET}"

    if [ "$method" = "POST" ]; then
        status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$url" -H 'Content-Type: application/json' -d '{}')
    else
        status=$(curl -s -o /dev/null -w '%{http_code}' "$url")
    fi

    if [ "$status" = "$expected" ]; then
        echo "  ✅ $name (HTTP $status)"
        pass=$((pass + 1))
    else
        echo "  ❌ $name (expected $expected, got $status)"
        fail=$((fail + 1))
    fi
}

check_json() {
    local name="$1" url="$2" field="$3" expected="$4"

    value=$(curl -s "$url" | python3 -c "import sys,json; print(json.load(sys.stdin).get('$field',''))" 2>/dev/null)

    if [ "$value" = "$expected" ]; then
        echo "  ✅ $name ($field=$value)"
        pass=$((pass + 1))
    else
        echo "  ❌ $name (expected $field=$expected, got $value)"
        fail=$((fail + 1))
    fi
}

echo ""
echo "📡 Health Endpoints"
check "Healthz" "$BASE_URL/healthz" "200"
check "Readyz" "$BASE_URL/readyz" "200"
check_json "Health status" "$BASE_URL/healthz" "status" "ok"

echo ""
echo "🌐 Web UI"
check "Frontend loads" "$WEB_URL" "200"
check "Frontend via proxy" "$WEB_URL/api/v1/auth/status" "200"

echo ""
echo "🔐 Auth Endpoints"
check "Auth status" "$BASE_URL/api/v1/auth/status" "200"
check_json "Not authenticated" "$BASE_URL/api/v1/auth/status" "authenticated" "False"

echo ""
echo "🚗 Vehicle Endpoints"
check "List vehicles" "$BASE_URL/api/v1/vehicles" "200"

echo ""
echo "📊 Data Endpoints"
check "Drives" "$BASE_URL/api/v1/drives?limit=5" "200"
check "Charging" "$BASE_URL/api/v1/charging?limit=5" "200"
check "Energy stats" "$BASE_URL/api/v1/energy/stats?vehicle_id=1&days=30" "200"
check "Battery report" "$BASE_URL/api/v1/battery/report?vehicle_id=1" "200"
check "Fleet analytics" "$BASE_URL/api/v1/analytics/fleet" "200"
check "Mileage daily" "$BASE_URL/api/v1/mileage/daily?vehicle_id=1" "200"
check "Mileage monthly" "$BASE_URL/api/v1/mileage/monthly?vehicle_id=1" "200"
check "Tire pressure" "$BASE_URL/api/v1/tire-pressure?vehicle_id=1" "200"
check "Vampire drain" "$BASE_URL/api/v1/vampire-drain/events?vehicle_id=1" "200"
check "Software updates" "$BASE_URL/api/v1/software-updates" "200"
check "Locations" "$BASE_URL/api/v1/locations" "200"
check "Timeline" "$BASE_URL/api/v1/timeline?vehicle_id=1" "200"
check "Trips" "$BASE_URL/api/v1/trips" "200"

echo ""
echo "⚙️ System Endpoints"
check "Settings" "$BASE_URL/api/v1/settings" "200"
check "Alert rules" "$BASE_URL/api/v1/alerts/rules" "200"
check "Alerts" "$BASE_URL/api/v1/alerts" "200"
check "Notifications" "$BASE_URL/api/v1/notifications" "200"
check "Geofences" "$BASE_URL/api/v1/geofences" "200"

echo ""
echo "📈 Export Endpoints"
check "Export drives CSV" "$BASE_URL/api/v1/export/drives?format=csv" "200"
check "Export charging JSON" "$BASE_URL/api/v1/export/charging?format=json" "200"

echo ""
echo "=========================="
echo "Results: $pass passed, $fail failed"
echo ""

if [ $fail -gt 0 ]; then
    exit 1
fi
echo "🎉 All tests passed!"
