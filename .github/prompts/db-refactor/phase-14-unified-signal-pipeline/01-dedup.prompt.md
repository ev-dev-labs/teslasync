---
description: "Phase-14 — Unique constraint + dedup guard for multi-pod"
---
# Prompt 01 — Dedup Guard (prevent double writes from rolling deploys)
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-01-dedup.log` |
| Allowed files to change | `internal/database/signal_history_writer.go`, `internal/database/migrations/` (new migration), the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 00 (signal_log hypertable)

## Problem

During rolling deploys, two pods subscribe to the same MQTT topic. Both process
the same signal and INSERT into signal_log. Duplicate rows cause SUM/AVG
aggregates to double-count.

## Task

### 1. The PK from prompt 00 `(created_at, vehicle_id, signal)` already prevents exact duplicates

If two pods process the same signal at the exact same `created_at` timestamp with
the same vehicle_id and signal name, the PK will reject the duplicate. But if they
use slightly different `NOW()` timestamps, both insert.

### 2. Use `ON CONFLICT DO NOTHING` in the batch writer

Update the CopyFrom in `signal_history_writer.go` to use a regular batch INSERT
with `ON CONFLICT (created_at, vehicle_id, signal) DO NOTHING` instead of CopyFrom.

OR: if CopyFrom performance is critical, add a dedup step before insert:
```go
// Dedup within the batch itself (same vehicle+signal+second = keep last)
seen := make(map[string]int) // key: "vehicleID:signal:truncated_ts"
for i, row := range rows {
    key := fmt.Sprintf("%d:%s:%d", row.VehicleID, row.Signal, row.CreatedAt.Unix())
    seen[key] = i // last one wins
}
```

### 3. Alternative: MQTT shared subscriptions

Document in a code comment that the MQTT client ID already has a random suffix
(`cfg.ClientID + "-" + randomSuffix(4)`), which means each pod gets its own
subscription. Mosquitto delivers to ALL subscribers by default.
If dedup at DB level is insufficient, switch to MQTT v5 shared subscriptions:
`$share/teslasync/telemetry/#` — broker delivers each message to exactly one subscriber.

Add a comment in `internal/mqtt/mqtt.go` near the Subscribe call explaining this option.

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
# Insert test: two identical signals should not create duplicates
docker exec teslasync-postgres psql -U teslasync -d teslasync -c "
INSERT INTO signal_log (created_at, vehicle_id, signal, value_num) VALUES (NOW(), 1, 'TestDedup', 42)
ON CONFLICT DO NOTHING;
INSERT INTO signal_log (created_at, vehicle_id, signal, value_num) VALUES (NOW(), 1, 'TestDedup', 42)
ON CONFLICT DO NOTHING;
SELECT COUNT(*) FROM signal_log WHERE signal = 'TestDedup';
DELETE FROM signal_log WHERE signal = 'TestDedup';
"
# Count should be 1 (not 2)
```

Log result. STATUS=DONE only if build passes AND dedup verified.



## Commit

After gate passes, commit all changes:
```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-14/01-dedup: <brief description>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Include `phase-14/01-dedup` as the commit message prefix.

