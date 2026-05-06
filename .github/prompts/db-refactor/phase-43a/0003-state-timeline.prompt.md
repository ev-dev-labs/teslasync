---
description: "Phase 43a - GET /vehicle-states/timeline + /vehicle-states/summary (FSM transitions)"
---

# Prompt 0003 — Vehicle-state timeline + summary endpoints

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-43a-0003-state-timeline.log` |
| Depends on | `phase-43a-0002-coverage-mount.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/api/vehicle_states_handler.go`, `internal/api/vehicle_states_handler_test.go`, `internal/database/vehicle_states_repo.go`, `internal/database/vehicle_states_repo_test.go`, `internal/api/router.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-43a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== DESIGN ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

Phase-43 audit found 2 missing routes consumed by `useAdmin.ts` +
`useAnalytics.ts`:

- `GET /vehicle-states/timeline?vehicle_id=${id}&days=${days}` — chronological list of FSM transitions over N days
- `GET /vehicle-states/summary?vehicle_id=${id}` — aggregate time-in-state breakdown

Data lives in `fsm_transitions` table (mig 000187) populated by phase-42a
side-effect observer's FSM callback.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **Timeline response shape** | `{ vehicle_id, days, transitions: [{ ts, from_state, to_state, trigger_field, trigger_value }] }` ordered by ts ASC. snake_case. |
| 2 | **Summary response shape** | `{ vehicle_id, total_seconds, by_state: [{ state, total_seconds, percentage, transition_count }] }`. Computed by walking transitions and summing dwell time per state. |
| 3 | **Query params** | `vehicle_id` (required, int64). `days` (optional, default 7, max 90). All snake_case. |
| 4 | **Default days clamp** | If days > 90, return 400 with `{error:'days exceeds maximum',max:90}`. If days < 1, return 400. If days absent, default 7. |
| 5 | **Tables** | `fsm_transitions(vehicle_id, ts, from_state, to_state, trigger_field, trigger_value)` (mig 000187). Use `WHERE vehicle_id=$1 AND ts >= now() - $2::interval ORDER BY ts ASC`. |
| 6 | **Summary algorithm** | Window function: `LAG(ts) OVER (ORDER BY ts)` to compute dwell. State at window start = state of first transition's from_state. State at window end = open-ended (uses now() as end). |
| 7 | **Empty-vehicle handling** | Return 200 with `transitions:[]` or `by_state:[]` rather than 404 — vehicle may have just been onboarded with no transitions yet. 404 only when vehicle_id doesn't exist in `vehicles` table. |
| 8 | **Tests** | (a) Timeline ordering ASC. (b) Days clamp 7/30/90/91→400. (c) Summary percentages sum to 100±0.01. (d) Empty vehicle → 200 with empty array. (e) Unknown vehicle → 404. |

## Action Steps

1. `git status` clean.
2. Predecessor 0002 DONE.
3. `=== AUDIT_EVIDENCE ===` capture:
   - Schema of `fsm_transitions`: `Get-Content migrations/000187_*.up.sql`.
   - `grep -n 'vehicle-states\|vehicle_states' internal/api/router.go` (must be 0).
   - Hook URL site: `grep -n 'vehicle-states' web/src/api/hooks/useAdmin.ts web/src/api/hooks/useAnalytics.ts`.
4. `=== DESIGN ===` document the dwell-time algorithm with a worked example (3 transitions → 3-state summary).
5. Implement repo (timeline + summary) + handler (2 routes) + register routes.
6. Tests per Decision #8.
7. Gate:
   - `go build ./...`, `go vet ./...`, `go test -race ./internal/api/... ./internal/database/...`
   - `git status --short` allowed only.
8. Commit `feat(api): GET /vehicle-states/timeline + /vehicle-states/summary (FSM transitions)`.
9. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If `fsm_transitions` is empty for ALL vehicles (phase-42a side-effect
observer not yet run on production data), tests will need to seed rows
directly. Acceptable. If schema differs from what's documented above,
adjust columns + surface the discrepancy in `=== AUDIT_EVIDENCE ===`.
