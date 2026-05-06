---
description: "Phase 43a - GET /mileage/monthly + /mileage/stats (drives + odometer)"
---

# Prompt 0004 — Mileage endpoints

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-43a-0004-mileage.log` |
| Depends on | `phase-43a-0003-state-timeline.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/api/mileage_handler.go`, `internal/api/mileage_handler_test.go`, `internal/database/mileage_repo.go`, `internal/database/mileage_repo_test.go`, `internal/api/router.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-43a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== DESIGN ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

`useAnalytics.ts` calls 2 missing routes:

- `GET /mileage/monthly?vehicle_id=${id}` — array of monthly mileage rows
- `GET /mileage/stats?vehicle_id=${id}` — lifetime + 7d/30d/365d totals

Data sources: `drives` table (per-trip distance) AND `signal_log`
odometer field (`VehicleSpeedKilometersPerHour` integral OR
`Odometer` direct reading). Drive sum is authoritative for completed
trips; odometer-delta is the cross-check.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **Monthly response shape** | `{ vehicle_id, months: [{ year_month: 'YYYY-MM', drive_count, total_km, total_kwh_consumed?, avg_efficiency_wh_per_km? }] }`. Include last 24 months by default; oldest first. |
| 2 | **Stats response shape** | `{ vehicle_id, lifetime_km, last_7d_km, last_30d_km, last_365d_km, drive_count_lifetime, drive_count_30d, first_drive_at, last_drive_at }`. |
| 3 | **Query params** | `vehicle_id` required. `months` optional (default 24, max 120). |
| 4 | **Source-of-truth** | `drives.distance_km` SUM grouped by `date_trunc('month', started_at)`. Odometer is NOT used here — drives is the official trip-distance accountant; using odometer would double-count or under-count if Tesla's odometer reset/correction events happen. |
| 5 | **Energy fields** | If `drives.energy_used_kwh` column exists (verify in AUDIT_EVIDENCE), include `total_kwh_consumed` + `avg_efficiency_wh_per_km`. If not, omit those fields (don't fabricate). |
| 6 | **Empty handling** | Vehicle with 0 drives returns 200 + `months:[]` and `lifetime_km:0`. Unknown vehicle → 404. |
| 7 | **Tests** | (a) Monthly grouping correctness. (b) Months clamp 24/120/121→400. (c) Stats lifetime = sum of monthly. (d) Stats last_7d = drives in last 7 days. (e) NULL distance_km handled (skipped not erroring). |

## Action Steps

1. `git status` clean.
2. Predecessor 0003 DONE.
3. `=== AUDIT_EVIDENCE ===` capture:
   - Schema of `drives`: `Get-Content migrations/000185_*.up.sql` (or wherever drives is defined).
   - Confirm column names: `vehicle_id`, `started_at`, `distance_km`, `energy_used_kwh` (note absence if applicable).
   - `grep -n 'mileage' internal/api/router.go` (must be 0).
   - Hook URL: `grep -n 'mileage' web/src/api/hooks/useAnalytics.ts`.
4. `=== DESIGN ===` worked example: 3 drives in month X, sum km, group, return row.
5. Implement repo + handler + 2 route registrations.
6. Tests per Decision #7.
7. Gate:
   - `go build ./...`, `go vet ./...`, `go test -race ./internal/api/... ./internal/database/...`
   - `git status --short` allowed only.
8. Commit `feat(api): GET /mileage/monthly + /mileage/stats`.
9. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If `drives` table column names differ (e.g., `total_distance` instead of
`distance_km`), use the actual names + document the variance.
If `energy_used_kwh` is absent, omit the energy fields from BOTH shapes;
do NOT compute from odometer × consumption — that's a derivation, not
data, and belongs in a separate analytics endpoint.
