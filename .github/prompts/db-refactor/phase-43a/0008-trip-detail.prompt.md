---
description: "Phase 43a - GET /trips/{id} (single-trip detail with tick data)"
---

# Prompt 0008 — Trip detail endpoint

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-43a-0008-trip-detail.log` |
| Depends on | `phase-43a-0007-signal-catalog.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/api/trips_detail_handler.go`, `internal/api/trips_detail_handler_test.go`, `internal/database/trips_detail_repo.go`, `internal/database/trips_detail_repo_test.go`, `internal/api/router.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-43a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== DESIGN ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

`useTrips.ts` calls `GET /trips/${id}` — single trip detail with route
geometry + per-tick telemetry. Today returns 404. The `/drives/{id}`
endpoint exists but the SPA's TripDetailPage uses the `/trips/` path —
verify whether the SPA is calling the wrong path OR there's a separate
"trip" concept (multi-drive grouping).

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **Trip vs drive disambiguation** | First step is to determine which case applies. (a) If `trips` table exists in migrations: trip = multi-drive grouping; build new endpoint querying `trips` + JOIN `drives`. (b) If no `trips` table: TripDetailPage is misnamed; `/trips/{id}` is an alias for `/drives/{id}` and the right fix is to ALIAS the route (chi mount with the same handler). Verify in AUDIT. |
| 2 | **Response shape (case b: alias)** | Identical to `GET /drives/{id}` response. Add the route as a literal mount: `r.Get("/trips/{trip_id}", h.getDriveByID)` mapping trip_id → driveID. Document the alias in route comment. |
| 3 | **Response shape (case a: real trips)** | `{ id, vehicle_id, started_at, ended_at, drives: [...drive summaries...], total_distance_km, total_duration_seconds, route_polyline?: string, energy_used_kwh? }`. |
| 4 | **Per-tick data** | If TripDetailPage shows charts (speed/elevation over time), the response includes `telemetry: [{ts, speed_kph, elevation_m, lat, lng}]` from positions table. Cap at 5000 points; downsample if needed via TimescaleDB time_bucket(). |
| 5 | **Auth + ownership** | Same as `/drives/{id}` — authenticated + must belong to a vehicle the user can read. |
| 6 | **Tests** | Case (b): assert `/trips/{id}` returns same body as `/drives/{id}`. Case (a): assert grouping correctness + drive list. |

## Action Steps

1. `git status` clean.
2. Predecessor 0007 DONE.
3. `=== AUDIT_EVIDENCE ===` capture:
   - `Get-ChildItem migrations/*trips*.up.sql 2>$null` — does a `trips` table migration exist?
   - `grep -rn 'trips\b' internal/database/ --include='*.go' | head -20`
   - `grep -n '/drives/{' internal/api/router.go` — confirm /drives/{id} handler exists.
   - `Get-Content web/src/api/hooks/useTrips.ts` — read the hook to see exactly what shape it expects.
   - `Get-ChildItem web/src/features/*/pages/Trip*.tsx` — find TripDetailPage to understand consumer expectations.
4. `=== DESIGN ===` document case (a) vs (b) with evidence and chosen path.
5. Implement chosen path. Case (b) is shorter (route alias only); case (a) is full repo + handler.
6. Tests per Decision #6.
7. Gate:
   - `go build ./...`, `go vet ./...`, `go test -race ./internal/api/...`
   - `cd web && npx tsc --noEmit`
   - `git status --short` allowed only.
8. Commit `feat(api): GET /trips/{id}` (commit body specifies case a or b).
9. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If neither case fits cleanly (e.g., TripDetailPage expects fields not
present in `/drives/{id}` response AND no trips table exists), the
correct answer is to EXTEND the drives response to include the missing
fields rather than to invent a new `trips` concept. Surface the
extension fields in `=== DESIGN ===` and add them to the existing
drives handler — but only if the file budget allows; else BLOCK and
defer.
