---
description: "Phase-14 — Live active drive/charge in UI"
---
# Prompt 27 — Live Active Session: In-Progress Drive/Charge Detail in UI
> **Severity:** Feature | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-27-live-session.log` |
| Allowed files to change | `internal/api/drive_handler.go`, `internal/api/charging_handler.go`, frontend files if needed, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompts 06 (SnapshotAt), 23 (Pivot), 24 (drive telemetry)

## Problem

When a drive or charge is in progress (`end_ts IS NULL`), the detail page should show:
- **Live updating** distance, duration, battery, speed
- **Growing position trace** on the map
- **Growing telemetry chart** (speed/power/battery over time)

Today this works because the in-memory store + snapshot tables are written to
continuously. After Phase 14, the data is in signal_log + Redis.

## Task

### 1. Drive detail API — handle in-progress drives

In the `GET /drives/{id}` endpoint, when the drive has `end_ts IS NULL`:

```go
func (h *DriveHandler) Get(w http.ResponseWriter, r *http.Request) {
    drive, _ := h.driveRepo.Get(ctx, driveID)

    if drive.EndTs == nil {
        // In-progress drive — compute live values
        startSnap, _ := h.signalLogReader.SnapshotAt(ctx, drive.VehicleID, drive.StartTs)
        currentSnap, _ := h.redisCache.GetAll(ctx, drive.VehicleID) // live from Redis

        startOdo := toFloat(startSnap["Odometer"])
        currentOdo := toFloat(currentSnap["Odometer"])
        drive.DistanceMi = currentOdo - startOdo
        drive.DurationMin = time.Since(drive.StartTs).Minutes()
        drive.StartBatteryPct = toInt(startSnap["BatteryLevel"])
        drive.EndBatteryPct = toInt(currentSnap["BatteryLevel"])
        drive.AvgSpeedMph = drive.DistanceMi / (drive.DurationMin / 60)
        // Mark as live for frontend
        drive.Live = true
    }

    writeJSON(w, http.StatusOK, drive)
}
```

### 2. Telemetry + positions for in-progress drives

Prompts 24 already handle this — when `end_ts IS NULL`, they use `time.Now()`.
Verify this works: the telemetry chart and position trace should grow as new
signals arrive in signal_log.

### 3. Charging detail — same pattern

For `GET /charging/{id}` when `end_ts IS NULL`:
- Start battery from `SnapshotAt(start_ts)`
- Current battery from Redis
- Energy added from `ACChargingEnergyIn` delta
- Mark as live

### 4. Frontend considerations

Check if the frontend drive/charge detail pages already handle `live: true` or
`end_ts: null` to show "in progress" state. If not, ensure:
- The page polls/refetches when `end_ts` is null (already likely via `refetchInterval`)
- A "Live" badge or indicator is shown
- Charts auto-extend as new data arrives

### Constraints

- **Redis reads for current state** (sub-ms) — don't query signal_log for "right now"
- **signal_log reads for start state** — need the snapshot at drive/charge start time
- The `drives` table row is NOT updated during the drive — only at completion.
  Live values are computed on-the-fly from Redis + signal_log.
- If Redis is unavailable, fall back to signal_log `SnapshotAt(now)` (slower but works)

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
# Verify in-progress drive returns live data
# (need an active drive for this — may need to replay signals without completing)
```

Log result. STATUS=DONE only if build passes.



## Commit

After gate passes, commit all changes:
```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-14/27-live-session: <brief description>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Include `phase-14/27-live-session` as the commit message prefix.

