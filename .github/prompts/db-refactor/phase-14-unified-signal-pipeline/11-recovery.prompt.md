---
description: "Phase-14 — Session recovery on startup"
---
# Prompt 11 — Session Recovery: Complete Open Drives/Charges from signal_log
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-11-recovery.log` |
| Allowed files to change | `internal/api/telemetry_sessions.go` or `internal/service/session_recovery.go` (CREATE), the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompts 06 (SnapshotAt), 09 (drive completion), 10 (charge completion)

## Problem

Pod crash mid-drive/charge leaves `drives` or `charging_sessions` rows with `end_ts IS NULL`.
Today these stay incomplete forever. With signal_log, we can recover them.

## Task

### Create session recovery logic (run once at startup)

```go
func (t *TelemetrySessions) RecoverIncompleteSessions(ctx context.Context) {
    // 1. Find open drives
    openDrives, _ := t.driveRepo.FindOpen(ctx)  // WHERE end_ts IS NULL
    for _, drive := range openDrives {
        lastSignalTs, _ := t.signalLogReader.LatestTimestamp(ctx, drive.VehicleID)
        staleDuration := time.Since(lastSignalTs)

        if staleDuration < 5*time.Minute {
            // Vehicle likely still active — leave drive open
            log.Info().Int64("drive_id", drive.ID).Msg("recovery: drive still active, skipping")
            continue
        }

        // Stale — complete with last known data from signal_log
        log.Info().Int64("drive_id", drive.ID).Time("last_signal", lastSignalTs).
            Msg("recovery: completing stale drive from signal_log")

        startSnap, _ := t.signalLogReader.SnapshotAt(ctx, drive.VehicleID, drive.StartTs)
        endSnap, _ := t.signalLogReader.SnapshotAt(ctx, drive.VehicleID, lastSignalTs)

        // Use same completion logic as prompt 09
        t.completeRecoveredDrive(ctx, drive, startSnap, endSnap, lastSignalTs)
    }

    // 2. Find open charges
    openCharges, _ := t.chargeRepo.FindOpen(ctx)  // WHERE end_ts IS NULL
    for _, charge := range openCharges {
        lastSignalTs, _ := t.signalLogReader.LatestTimestamp(ctx, charge.VehicleID)
        staleDuration := time.Since(lastSignalTs)

        if staleDuration < 5*time.Minute {
            log.Info().Int64("charge_id", charge.ID).Msg("recovery: charge still active, skipping")
            continue
        }

        log.Info().Int64("charge_id", charge.ID).Msg("recovery: completing stale charge from signal_log")

        startSnap, _ := t.signalLogReader.SnapshotAt(ctx, charge.VehicleID, charge.StartTs)
        endSnap, _ := t.signalLogReader.SnapshotAt(ctx, charge.VehicleID, lastSignalTs)

        t.completeRecoveredCharge(ctx, charge, startSnap, endSnap, lastSignalTs)
    }
}
```

### 2. Add `LatestTimestamp` to SignalLogReader

```go
// LatestTimestamp returns the most recent signal timestamp for a vehicle.
func (r *SignalLogReader) LatestTimestamp(ctx context.Context, vehicleID int64) (time.Time, error)
```

### 3. Wire into startup

Call `RecoverIncompleteSessions()` after signal store hydration, before entering
the main processing loop. Add to `telemetry_handler.go` init or `cmd/teslasync/main.go`.

### Constraints

- 5-minute stale threshold is reasonable default — make it configurable later
- Recovery is best-effort: if SnapshotAt returns empty, mark session as "recovered"
  with whatever data is available (don't leave it open forever)
- Log all recovery actions clearly (drive_id, original start, recovered end)
- Run ONCE at startup, not periodically

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
```

Log result. STATUS=DONE only if build passes.
