---
description: "Phase 42 - migration: DROP CASCADE all 38 legacy telemetry tables"
---

# Prompt 0078 - Migration 000161 — DROP CASCADE all 38 legacy telemetry tables

> **Severity:** Gate (one-way) | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42-0078-mig-drop-legacy.log` |
| Depends on | `phase-42-0077a-strip-residual-comments.log` |
| Allowed files to change | `migrations/000161_drop_legacy_telemetry.up.sql`, `migrations/000161_drop_legacy_telemetry.down.sql`, `internal/database/fleet_subscription_repo.go` (DELETE), `internal/models/telemetry.go` (EDIT — drop `FleetTelemetrySubscription` struct only), `internal/api/devtools_handler.go` (EDIT — drop fleet-subscription audit trail), `internal/models/models.go` (EDIT — drop the moved-to-telemetry.go comment line for `FleetTelemetrySubscription`), the output log |

## Honesty Covenant

<!-- BEGIN COVENANT -->
1. No red-as-green - EXIT != 0 means STATUS=BLOCKED, no exceptions.
2. No scope narrowing - run the exact gate command, no subsets.
3. No skip-and-assume - cannot run gate means BLOCKED, never DONE.
4. No field resurrection - do not add back deleted fields to "fix" things.
5. No stubs - no `return nil`, `// TODO`, or `panic("not impl")`.
6. No delegation - NO sub-agents, NO parallel, NO background tasks.
7. No predecessor bypass - verify ALL consumer-migration logs (0060-0071 AND 0073-0077) STATUS=DONE before this prompt runs.
8. No commit on red - commit only the log when BLOCKED.
9. No silent drift - `git status` outside allowed files means BLOCKED.
10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED> on their own lines.
11. **ONE-WAY operation.** This prompt drops production tables (which are empty per ADR-004 #4 — no backfill — but the OPERATION is irreversible by re-running migrations). The down migration documents the data loss; it does NOT recreate the tables (that's the job of 0030-0036).
<!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== ALL_CONSUMERS_DONE ===`, `=== CONSUMERS_DELETED ===`, `=== ANCHORED_GREP_NO_REFS ===`, `=== TABLE_LIST ===`, `=== APPLIED ===`, `=== POST_DROP_VERIFY ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

Phase-42 replaces the broken pipeline with a new one. The old tables (positions, snapshot tables, legacy signal_log, derived caggs/MVs, FSM, drives/charging_sessions, etc.) were populated by code that silently corrupted data. Once consumers stop writing to them (Prompts 0060-0071), they are dead weight that:
- bloats backups
- confuses analytics queries that haven't been updated
- holds locks that complicate the recreation step
- makes the CASCADE detection of any forgotten consumer reference clean and immediate

This prompt drops all 38 of them in one transactional `DROP TABLE ... CASCADE` migration.

## Action Steps

1. Verify EVERY consumer-migration log (`phase-42-0060-*.log` … `phase-42-0071-*.log` and `phase-42-0073-*.log` … `phase-42-0077-*.log`) is `STATUS=DONE`. If any is missing or BLOCKED, this prompt is BLOCKED.

2. **Delete the last surviving `fleet_telemetry_subscriptions` consumer.** Predecessors 0073-0077 cleared every other dropped-table reference in the Go tree, but the audit-trail block in `internal/api/devtools_handler.go` (and its repo dependency) is the residual that keeps gate step #2 red. Phase-42 does not retain audit history for fleet-telemetry subscribe calls — the table is dropped without replacement (ADR-004 #4 forward-only). Apply these surgical edits:
   - **DELETE** `internal/database/fleet_subscription_repo.go` (entire file).
   - **EDIT** `internal/models/telemetry.go` — remove the `FleetTelemetrySubscription` struct definition only. Keep `RawTelemetrySignal`, `TeslaFleetTelemetryError`, `TeslaFleetTelemetryErrorVIN`. Keep the `import "time"` (still used by remaining structs).
   - **EDIT** `internal/models/models.go` — remove the line `// FleetTelemetrySubscription has moved to telemetry.go.` (the type no longer exists anywhere).
   - **EDIT** `internal/api/devtools_handler.go`:
     - Drop the `fleetSubRepo *database.FleetSubscriptionRepo` field from the `DevToolsHandler` struct.
     - Drop the `h.fleetSubRepo = database.NewFleetSubscriptionRepo(h.db)` line in the constructor.
     - Drop the entire "Persist subscription for audit trail" block (the `if h.fleetSubRepo != nil { ... }` block inside the FleetTelemetrySubscribe handler — currently ~lines 805-831).
     - Drop the `"github.com/ev-dev-labs/teslasync/internal/models"` import (becomes unused — `goimports` will fail otherwise).
   - Run `go build ./...` and `go vet ./...` and capture both transcripts under `=== CONSUMERS_DELETED ===`. Both MUST pass — if either fails, BLOCKED.

3. Run an anchored grep for direct SQL references to the **truly-dropped** tables across all `.go` files. The banned set is the 17 tables that 000161 drops AND that subsequent migrations (000168-000175) do NOT recreate. Tables like `positions`, `drives`, `charging_sessions`, `trips`, `cagg_battery_daily`, etc. ARE recreated under the same name with new SI columns (see migrations 000168-000175) and MUST NOT trip the banned-grep — that was the structural defect in the previous attempt's gate (153 false-positive hits, 150 against recreated tables). If any active code outside `_test.go` references any of the 17 truly-dropped tables, BLOCKED — predecessor consumer migrations failed to fully migrate.

4. Compose `migrations/000161_drop_legacy_telemetry.up.sql`:
   ```sql
   BEGIN;

   -- Bound the blast radius. If anything is holding a lock on these tables
   -- (e.g., a stray analytics query, an unmigrated worker), fail fast instead
   -- of stalling the deploy and blocking every other writer.
   SET LOCAL lock_timeout      = '30s';
   SET LOCAL statement_timeout = '5min';

   DROP TABLE IF EXISTS positions, positions_default,
     battery_snapshots, climate_snapshots, motor_snapshots,
     security_events, tire_pressure_snapshots, media_snapshots,
     safety_snapshots, location_snapshots,
     user_preference_snapshots, vehicle_config_snapshots, vehicle_meta_snapshots,
     charging_telemetry, charge_telemetry_readings, drive_telemetry_readings,
     signal_observations, signal_history, signal_catalog, vehicle_live_state,
     vehicle_units, fsm_transitions, fleet_telemetry_subscriptions,
     mv_energy_daily, mv_position_hourly, mv_signal_stats,
     cagg_battery_daily, cagg_climate_hourly, cagg_signal_hourly,
     cagg_fleet_stats, cagg_vehicle_daily, cagg_charging_summary,
     drives, charging_sessions, trips, trip_drives,
     vampire_drain_events, daily_mileage, visited_locations,
     vehicle_states, guard_events
   CASCADE;

   COMMIT;
   ```
   **Deploy ordering — CRITICAL.** golang-migrate applies one file per transaction. Migrations 000161 (this prompt) and 000162-000168 (Prompts 0040-0036) are SEPARATE files and do NOT share a transaction. The deploy MUST apply 000161 through 000168 as a single `migrate up` step BEFORE any application pod is rolled. Any pod started against a DB at version 161 (drop done, recreate not yet) will crash on first query. The runbook in Prompt 0090 is the operator-facing source of this requirement; this prompt's commit message must also call it out.

5. Compose `migrations/000161_drop_legacy_telemetry.down.sql`:
   ```sql
   -- Phase-42 dropped these tables in commit <fill in via prompt log marker>.
   -- The new SI-canonical schemas live in migrations 000162-000168 and own
   -- these names going forward. Re-running this down migration will NOT
   -- restore the legacy schemas; we raise loudly so an operator who runs
   -- `migrate down` by mistake gets a wall, not silence.
   DO $$
   BEGIN
     RAISE EXCEPTION
       'phase-42 migration 000161 has no rollback by design (ADR-004 #4). '
       'Restore from a pre-phase-42 backup if you need the legacy schema.';
   END
   $$;
   ```

6. **Migration apply is performed at deploy time, not by this gate.** Earlier revisions of this prompt asserted a `TestMigrationApply` Go test, but no such test exists in the repo (predecessor migration prompts 0030-0036 also did not author one) and adding a Postgres-backed test harness is out of scope. Structural validity of the SQL is verified by the gate's regex checks (BEGIN/COMMIT/CASCADE/lock_timeout/statement_timeout/RAISE EXCEPTION). The actual `migrate up` happens during the deploy described in runbook Prompt 0090, where 000161-000175 are applied as a single `migrate up` step before any pod is rolled.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-42-0078-mig-drop-legacy.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object -FilePath $log -Append

# Verify ALL consumer logs (0060-0071 and the late-author 0073-0077 chain) are DONE.
$missing = @()
$slots = @()
0060..0071 | ForEach-Object { $slots += ('{0:D4}' -f $_) }
0073..0077 | ForEach-Object { $slots += ('{0:D4}' -f $_) }
foreach ($slot in $slots) {
  $logs = Get-ChildItem ".github/prompts/db-refactor/logs/phase-42-$slot-*.log" -ErrorAction SilentlyContinue
  if (-not $logs) { $missing += $slot; continue }
  $found = $false
  foreach ($l in $logs) {
    $lines = Get-Content $l
    $lastExit   = ($lines | Where-Object { $_ -match '^EXIT=' }   | Select-Object -Last 1)
    $lastStatus = ($lines | Where-Object { $_ -match '^STATUS=' } | Select-Object -Last 1)
    if ($lastExit -eq 'EXIT=0' -and $lastStatus -eq 'STATUS=DONE') { $found = $true; break }
  }
  if (-not $found) { $missing += $slot }
}
if ($missing) {
  "Missing or not-DONE consumer logs: $($missing -join ', ')" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

# Verify the fleet_telemetry_subscriptions consumer cleanup completed: the repo
# file MUST be deleted, the model struct MUST be gone, and the devtools handler
# MUST no longer reference it. This is the residual that 0073-0077 did not touch.
if (Test-Path 'internal/database/fleet_subscription_repo.go') {
  "internal/database/fleet_subscription_repo.go must be deleted by step 2" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}
$residualRefs = git --no-pager grep -nE 'fleet_telemetry_subscriptions|FleetSubscriptionRepo|NewFleetSubscriptionRepo' -- '*.go' ':!*_test.go' ':!internal/database/migrations/' 2>$null
$modelHit = git --no-pager grep -nE 'type\s+FleetTelemetrySubscription\s+struct' -- 'internal/models/' 2>$null
if ($residualRefs -or $modelHit) {
  "Residual fleet_telemetry_subscriptions consumers remain — step 2 incomplete:" | Tee-Object -FilePath $log -Append
  if ($residualRefs) { $residualRefs | Tee-Object -FilePath $log -Append }
  if ($modelHit)     { $modelHit     | Tee-Object -FilePath $log -Append }
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

# Build + vet must be clean after the consumer cleanup. If either fails, the
# devtools_handler edits left dangling references (e.g., unused `models` import
# or a missed callsite).
& go build ./... 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) {
  "go build failed after consumer cleanup" | Tee-Object -FilePath $log -Append
  "EXIT=$LASTEXITCODE" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $LASTEXITCODE
}
& go vet ./... 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) {
  "go vet failed after consumer cleanup" | Tee-Object -FilePath $log -Append
  "EXIT=$LASTEXITCODE" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $LASTEXITCODE
}

# Anchored grep (Go): no .go file outside *_test.go references any TRULY-DROPPED
# table in active SQL. The previous gate revision banned 28 tables, but 11 of
# those (positions, security_events, drives, charging_sessions, trips, trip_drives,
# charging_telemetry, fsm_transitions, vehicle_live_state, motor_snapshots,
# climate_snapshots, tire_pressure_snapshots, media_snapshots, safety_snapshots,
# location_snapshots) are RECREATED under the same name with new SI columns by
# migrations 000168-000175. Banning them produced 150 false positives. The 17
# names below are exactly the set that 000161 drops AND no successor recreates.
$names = @(
  'positions_default',
  'battery_snapshots',
  'user_preference_snapshots',
  'vehicle_config_snapshots',
  'vehicle_meta_snapshots',
  'charge_telemetry_readings',
  'drive_telemetry_readings',
  'signal_observations',
  'signal_history',
  'signal_catalog',
  'vehicle_units',
  'fleet_telemetry_subscriptions',
  'vampire_drain_events',
  'daily_mileage',
  'visited_locations',
  'vehicle_states',
  'guard_events'
)
$violations = @()
foreach ($n in $names) {
  $hits = git --no-pager grep -nE "FROM\s+$n\b|INSERT\s+INTO\s+$n\b|UPDATE\s+$n\b|DELETE\s+FROM\s+$n\b|JOIN\s+$n\b" -- '*.go' ':!*_test.go' ':!internal/database/migrations/' 2>$null
  if ($hits) { $violations += $hits }
}
if ($violations) {
  "Active Go code still references truly-dropped tables — predecessor consumer migrations incomplete:" | Tee-Object -FilePath $log -Append
  $violations | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

# NOTE: The previous revision had a `\b<table>\b` cross-service grep against
# helm/, docs/, and web/src/. It produced 1028 false positives (English words
# like "trips"/"drives"/"positions", URL path segments, i18n labels, React
# component prop names) and provided no real coverage — frontend talks to
# backend via URL paths, not SQL table names. Removed. Schema-context refs in
# docs/migrations are owned by their own ADRs, not this gate.

# Required migration files.
foreach ($f in @('migrations/000161_drop_legacy_telemetry.up.sql','migrations/000161_drop_legacy_telemetry.down.sql')) {
  if (-not (Test-Path $f)) { "Missing: $f" | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }
}

# Up migration must be transactional, reference CASCADE, and bound lock/statement time.
$up = Get-Content "migrations/000161_drop_legacy_telemetry.up.sql" -Raw
foreach ($n in @('BEGIN','COMMIT','CASCADE','lock_timeout','statement_timeout')) {
  if ($up -notmatch $n) {
    "Up migration must reference: $n" | Tee-Object -FilePath $log -Append
    "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
  }
}

# Down migration must raise (no silent rollback).
$down = Get-Content "migrations/000161_drop_legacy_telemetry.down.sql" -Raw
if ($down -notmatch 'RAISE\s+EXCEPTION') {
  "Down migration must RAISE EXCEPTION (no silent rollback)" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

# NOTE: The previous revision asserted a `TestMigrationApply` Go test exists.
# No such test exists in the repo, predecessor migration prompts (0030-0036) did
# not author one, and adding a Postgres-backed test harness is out of scope.
# The structural regex checks above (BEGIN/COMMIT/CASCADE/timeouts/RAISE) are the
# ground truth for migration validity at gate time. The actual `migrate up` runs
# at deploy time per runbook Prompt 0090, where 000161-000175 are applied as one
# `migrate up` step before any pod is rolled.

# Allowed-files whitelist for git-status. Any file outside this list means
# unrelated drift and BLOCKS the prompt.
$status = git status --porcelain
$allowedPatterns = @(
  'migrations/000161_drop_legacy_telemetry',
  'internal/database/fleet_subscription_repo\.go',
  'internal/models/telemetry\.go',
  'internal/models/models\.go',
  'internal/api/devtools_handler\.go',
  [regex]::Escape($log)
)
$badLines = $status | Where-Object {
  if (-not $_) { return $false }
  foreach ($p in $allowedPatterns) { if ($_ -match $p) { return $false } }
  return $true
}
if ($badLines) { $badLines | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

"All gate checks passed." | Tee-Object -FilePath $log -Append
"EXIT=0" | Tee-Object -FilePath $log -Append
"STATUS=DONE" | Tee-Object -FilePath $log -Append
exit 0
```

## Commit

```powershell
cd D:\repos\teslasync
git add migrations/000161_drop_legacy_telemetry.up.sql migrations/000161_drop_legacy_telemetry.down.sql
# Consumer cleanup (Step 2): repo deletion + model trim + handler edit.
git add internal/database/fleet_subscription_repo.go
git add internal/models/telemetry.go
git add internal/models/models.go
git add internal/api/devtools_handler.go
git add -f .github/prompts/db-refactor/logs/phase-42-0078-mig-drop-legacy.log
git commit -m "phase-42(0078): DROP CASCADE 38 legacy telemetry tables

ONE-WAY migration. Down migration is intentionally a no-op — the new
SI-canonical schemas in migrations 000168-000175 own the recreated names
going forward; the 17 truly-dropped tables (snapshots/MVs/caggs that no
longer exist post-phase-42) have no replacement. Tag the repo as
'phase-42-pre-drop' BEFORE applying this migration in production (see
resubscribe runbook in 0090). Step 2 also retired the
\`fleet_telemetry_subscriptions\` audit-trail consumer (repo, model,
devtools handler block) — phase-42 does not retain subscription history.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
