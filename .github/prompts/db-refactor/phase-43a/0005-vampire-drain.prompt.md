---
description: "Phase 43a - GET /vampire-drain + /vampire-drain/stats (battery loss while parked)"
---

# Prompt 0005 — Vampire drain endpoints

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-43a-0005-vampire-drain.log` |
| Depends on | `phase-43a-0004-mileage.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/api/vampire_drain_handler.go`, `internal/api/vampire_drain_handler_test.go`, `internal/database/vampire_drain_repo.go`, `internal/database/vampire_drain_repo_test.go`, `internal/api/router.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-43a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== DESIGN ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

`useEnergy.ts` calls 2 missing routes:

- `GET /vampire-drain?vehicle_id=${id}&limit=${limit}` — list of parked-window drain events
- `GET /vampire-drain/stats?vehicle_id=${id}` — aggregate avg/median/p95 drain rate

Vampire drain = battery % loss DURING a parked window where no charging
occurred. Window boundaries come from FSM transitions
(parked→{drive|charge}); battery values come from signal_log
(`BatteryLevel` field).

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **Drain event** | A parked window: `from_state='parked'` start, next non-parked transition end. During the window, signal_log has `BatteryLevel` samples; first vs last in window gives drain%. Charging during window invalidates the event (filter out). |
| 2 | **List response shape** | `{ vehicle_id, events: [{ started_at, ended_at, duration_hours, start_battery_pct, end_battery_pct, drain_pct, drain_pct_per_day, ambient_temp_c_avg? }] }`. Most recent first; default limit 50, max 500. |
| 3 | **Stats response shape** | `{ vehicle_id, event_count, total_observed_hours, avg_drain_pct_per_day, median_drain_pct_per_day, p95_drain_pct_per_day, sample_window_days }`. |
| 4 | **Query params** | `vehicle_id` required. `limit` optional (default 50, max 500). All snake_case. |
| 5 | **SQL approach** | Two-stage CTE: (a) parked windows from `fsm_transitions` (paired transitions). (b) For each window, JOIN signal_log on `field='BatteryLevel'` WHERE ts BETWEEN window start/end; take MIN(ts), MAX(ts), associated values via window functions. (c) Filter out windows where signal_log has any `field='ChargingState'` samples with value!='None' during the window. |
| 6 | **Stats percentile** | `percentile_disc(0.5) WITHIN GROUP (ORDER BY drain_pct_per_day)` for median, `percentile_cont(0.95)` for p95. |
| 7 | **Empty handling** | 0 parked windows → 200 + empty events / 0 stats. Unknown vehicle → 404. |
| 8 | **Tests** | (a) Window pairing correctness with 4-transition fixture. (b) Charging-window exclusion. (c) limit clamp 50/500/501→400. (d) drain_pct_per_day = drain_pct × (24/duration_hours). (e) Stats consistency: avg ≥ median for typical data; p95 ≥ avg. |

## Action Steps

1. `git status` clean.
2. Predecessor 0004 DONE.
3. `=== AUDIT_EVIDENCE ===` capture:
   - `Get-Content migrations/000187_*.up.sql` (fsm_transitions schema).
   - `Get-Content migrations/000188_*.up.sql` (signal_log schema; verify `field`, `ts`, `float_value`/`str_value` columns).
   - Verify `BatteryLevel` is a routed field: `Select-String 'BatteryLevel' internal/tesla/router/routing.yaml`.
   - `grep -n 'vampire' internal/api/router.go` (must be 0).
4. `=== DESIGN ===` walk through the CTE with a 6-transition + 4-battery-sample worked example.
5. Implement repo + handler + 2 route registrations.
6. Tests per Decision #8.
7. Gate:
   - `go build ./...`, `go vet ./...`, `go test -race ./internal/api/... ./internal/database/...`
   - `git status --short` allowed only.
8. Commit `feat(api): GET /vampire-drain + /vampire-drain/stats`.
9. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If `BatteryLevel` is NOT in routing.yaml, the field is named differently
(`Soc` or `BatteryStateOfCharge`); use the actual routed name +
document. If `ChargingState` exclusion is too coarse, filter on
charging_telemetry table presence in window instead. If percentile
syntax differs in TimescaleDB, fall back to pure Go computation in the
repo (acceptable for stats endpoint with bounded result set).
