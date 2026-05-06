---
description: "Phase 43a - GET /tesla/fleet-telemetry/coverage handler + frontend page mount"
---

# Prompt 0002 — Fleet Telemetry coverage endpoint + page mount

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-43a-0002-coverage-mount.log` |
| Depends on | `phase-43a-0001-orphans.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/api/fleet_telemetry_coverage_handler.go`, `internal/api/fleet_telemetry_coverage_handler_test.go`, `internal/database/fleet_telemetry_coverage_repo.go`, `internal/database/fleet_telemetry_coverage_repo_test.go`, `internal/api/router.go` (add 1 route), `web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx` (or equivalent existing page if found in DESIGN), `web/src/App.tsx` (mount if missing), the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-43a baseline (see 0001). <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== DESIGN ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

`useFleetTelemetry.ts` calls `GET /tesla/fleet-telemetry/coverage`
which returns 404 today (phase-43 audit confirmed). Status:
ORPHAN+MISSING_ROUTE — both backend route AND frontend mount are
missing. This endpoint reports per-vehicle Fleet Telemetry coverage:
which fields the vehicle is sending, when each field was last seen, %
of routes covered.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **Response shape** | `{ vehicles: [{ vehicle_id, vin, last_payload_at, fields_seen: [{field, last_seen_at, sample_count_24h}], routing_total: int, routing_covered: int, coverage_pct: float }] }`. snake_case JSON per backend convention. |
| 2 | **Data source** | `signal_log` (mig 000188) — `SELECT field, MAX(ts) AS last_seen_at, COUNT(*) FILTER (WHERE ts > now() - '24 hours'::interval) AS sample_count_24h FROM signal_log WHERE vehicle_id=$1 GROUP BY field`. Routing total = count of unique fields in `routing.yaml` (excluding drop). |
| 3 | **Auth** | Read-only admin endpoint; existing admin auth middleware. |
| 4 | **Frontend mount** | Check if `FleetTelemetryCoveragePage.tsx` exists. If yes, verify it's mounted in `App.tsx` routes; if no, create with PageContainer + GlassPanel listing vehicles in a DataTable. Use `useFleetTelemetryCoverage` hook (already exists). |
| 5 | **Page route path** | `/admin/telemetry/coverage` (consistent with other admin pages). Also add to admin nav menu if one exists. |
| 6 | **Tests** | (a) Repo: query against pgxmock or testcontainers with seeded signal_log rows; assert grouping correct. (b) Handler: 200 with seeded data, 401 without auth, 500 on DB error. (c) TypeScript: tsc passes. |

## Action Steps

1. `git status` clean.
2. Predecessor 0001 DONE.
3. `=== AUDIT_EVIDENCE ===` capture:
   - `grep -n 'fleet-telemetry/coverage\|fleet_telemetry_coverage' internal/api/router.go` (must be 0).
   - `Test-Path web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx`.
   - `grep -n 'FleetTelemetryCoverage' web/src/App.tsx` (current mount status).
   - Routing yaml field count: `(Get-Content internal/tesla/router/routing.yaml | Select-String '^- field:').Count`.
4. `=== DESIGN ===` document the SQL query, response shape, and frontend page structure.
5. Implement repo + handler + route registration + page (or page mount).
6. Tests per Decision #6.
7. Gate:
   - `go build ./...`, `go vet ./...`, `go test -race ./internal/api/... ./internal/database/...`
   - `cd web && npx tsc --noEmit && npm run lint`
   - `git status --short` allowed only.
8. Commit `feat(api,web): GET /tesla/fleet-telemetry/coverage + admin coverage page`.
9. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If routing total can't be computed at request time (yaml not embedded in
binary), embed via `//go:embed routing.yaml` in a new package
`internal/tesla/router/coverage` and parse once at startup. If that
expands the file budget, surface and BLOCK.
