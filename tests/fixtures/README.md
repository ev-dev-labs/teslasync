# tests/fixtures/

Test data fixtures for local development and integration testing.

## Files

| File | Purpose | Usage |
|---|---|---|
| `seed_test_vehicle.sql` | Seeds a test vehicle + units + live state + settings | Run once after `docker compose up` |
| `replay_signals.ps1` | Replays prod signal CSV against local MQTT | After seeding, with CSV from prod |
| `EXPECTED_RESULTS.md` | Expected DB state after D→P replay test | Verification checklist |

## Quick Start

```powershell
# From repo root — seed after docker compose up
Get-Content tests\fixtures\seed_test_vehicle.sql | docker exec -i teslasync-postgres psql -U teslasync -d teslasync
```

## Test Vehicle

| Field | Value |
|---|---|
| ID | auto-assigned (typically 1) |
| Tesla ID | 1234567890 |
| VIN | TEST00000000000VIN |
| Display Name | Test Model Y |
| Car Units | Miles / Fahrenheit / PSI |

## Signal Replay Testing

After seeding, you can replay production signals against the local MQTT broker:

```powershell
# 1. Export signals from prod (example — adjust kubectl context)
kubectl exec -n postgres-v17 postgres-v17-postgresql-0 -c postgresql -- \
  psql -U teslasync -d teslasync -c \
  "COPY (SELECT * FROM signal_history WHERE vehicle_id = <PROD_VID> ORDER BY ts DESC LIMIT 1000) TO STDOUT WITH CSV HEADER" \
  > tests/fixtures/prod-replay/signal_history_last_1k.csv

# 2. Publish to local MQTT using scripts/publish_test.sh or a custom script
# The telemetry handler listens on teslasync/+/# and routes by VIN
```

All scripts are idempotent — safe to run multiple times.
