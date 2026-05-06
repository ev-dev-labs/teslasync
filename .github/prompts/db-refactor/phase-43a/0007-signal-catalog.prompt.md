---
description: "Phase 43a - GET /signals/catalog + /signals/observations (signal_log discovery)"
---

# Prompt 0007 — Signal catalog + observations endpoints

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-43a-0007-signal-catalog.log` |
| Depends on | `phase-43a-0006-guard.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/api/signals_catalog_handler.go`, `internal/api/signals_catalog_handler_test.go`, `internal/database/signals_catalog_repo.go`, `internal/database/signals_catalog_repo_test.go`, `internal/api/router.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-43a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== DESIGN ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

`useTelemetry.ts` calls 2 missing routes:

- `GET /signals/catalog` — list of all signals known to the system (from routing.yaml + actually observed in signal_log)
- `GET /signals/observations?${params}` — query signal observations (paginated, filterable)

Used by the signal-explorer admin UI. Catalog is the index; observations
is the data fetch.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **Catalog response shape** | `{ signals: [{ field, destination, value_kind, last_seen_at?, sample_count_total?, vehicle_count? }] }`. Field + destination + value_kind from routing.yaml (always present); last_seen_at + counts from signal_log aggregates (NULL if never observed). |
| 2 | **Catalog query** | Two-step: (a) parse routing.yaml at startup (cache in memory). (b) On request, JOIN with `SELECT field, MAX(ts) AS last_seen_at, COUNT(*) AS sample_count_total, COUNT(DISTINCT vehicle_id) AS vehicle_count FROM signal_log GROUP BY field`. Left-join routing → aggregates. |
| 3 | **Observations response shape** | `{ count, total, observations: [{ vehicle_id, ts, field, value_kind, value }] }`. Pagination via `offset`+`limit`. |
| 4 | **Observations query params** | `vehicle_id` (optional, comma-separated for multi), `field` (optional, comma-separated), `since` (RFC3339, optional), `until` (RFC3339, optional), `limit` (default 100, max 1000), `offset` (default 0). All snake_case. |
| 5 | **Value rendering** | signal_log stores polymorphically (str/bool/int/float). Handler returns the appropriate field as `value` in the JSON, plus `value_kind` so consumer knows the type. |
| 6 | **Catalog caching** | Catalog endpoint is read-heavy + data changes slowly (one new signal per Tesla firmware update). Cache the routing-yaml-parsed slice for the lifetime of the process; aggregate query runs per request (1-2s on 100M-row signal_log → acceptable for admin UI). |
| 7 | **Tests** | (a) Catalog includes routed-but-unobserved fields (last_seen_at NULL). (b) Catalog includes observed fields with counts. (c) Observations filtering by field works. (d) Observations limit clamp. (e) Observations time-range filter. (f) value_kind matches the populated value column. |

## Action Steps

1. `git status` clean.
2. Predecessor 0006 DONE.
3. `=== AUDIT_EVIDENCE ===` capture:
   - `(Get-Content internal/tesla/router/routing.yaml | Select-String '^- field:').Count` (routing field count).
   - `Get-Content migrations/000188_*.up.sql` (signal_log schema; verify columns).
   - `grep -n 'signals/catalog\|signals/observations' internal/api/router.go` (must be 0).
   - Hook URLs: `grep -n 'signals/' web/src/api/hooks/useTelemetry.ts`.
4. `=== DESIGN ===` document the routing-yaml parse cache + aggregate JOIN strategy.
5. Implement repo + handler + 2 route registrations.
6. Tests per Decision #7.
7. Gate:
   - `go build ./...`, `go vet ./...`, `go test -race ./internal/api/... ./internal/database/...`
   - `git status --short` allowed only.
8. Commit `feat(api): GET /signals/catalog + /signals/observations`.
9. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If parsing routing.yaml inside the handler creates a new dependency on
the tesla/router package that violates layering, embed a pre-parsed JSON
catalog file at build time via `//go:embed signals_catalog.json`. If
the aggregate query exceeds 5s on the test dataset, drop sample_count
and vehicle_count from the catalog response (last_seen_at alone is
acceptable) and surface the perf decision in `=== DESIGN ===`.
