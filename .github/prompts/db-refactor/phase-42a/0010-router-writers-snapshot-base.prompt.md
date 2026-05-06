---
description: "Phase 42a - shared snapshot writer helper for the 7 *_snapshot destinations"
---

# Prompt 0010 — `router/writers/snapshot_base.go` (shared helper)

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42a-0010-router-writers-snapshot-base.log` |
| Depends on | `phase-42a-0000-methodology-and-cutover-decision.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/tesla/router/writers/snapshot_base.go`, `internal/tesla/router/writers/snapshot_base_test.go`, `internal/tesla/router/writers/doc.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT -->
1. No red-as-green — EXIT != 0 means STATUS=BLOCKED, no exceptions.
2. No scope narrowing — run the exact gate command, no subsets.
3. No skip-and-assume — cannot run gate means BLOCKED, never DONE.
4. No field resurrection — do not add back deleted fields to "fix" things.
5. No stubs — no `return nil`, `// TODO`, or `panic("not impl")`.
6. No delegation — NO sub-agents, NO parallel, NO background tasks.
7. No predecessor bypass — verify predecessor STATUS=DONE first.
8. No commit on red — commit only the log when BLOCKED.
9. No silent drift — `git status` outside allowed files means BLOCKED.
10. Log MUST contain `EXIT=<int>` and `STATUS=<DONE|BLOCKED>` on their own lines.
11. No dead code retention.
12. No production blind spot.
<!-- END COVENANT -->

## Logging Requirements

Write `=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===` to the output log.

## Problem

Seven of the twelve `routing.yaml` destinations are "snapshot" tables that
share the exact same write shape: `(vehicle_id BIGINT, ts TIMESTAMPTZ,
<column> <type>)` with `ON CONFLICT (vehicle_id, ts) DO UPDATE SET
<column> = EXCLUDED.<column>`. They are:

- `climate_snapshot` → `climate_snapshots` (31 routes)
- `motor_snapshot` → `motor_snapshots` (36 routes)
- `tire_pressure_snapshot` → `tire_pressure_snapshots` (8 routes)
- `media_snapshot` → `media_snapshots` (11 routes)
- `safety_snapshot` → `safety_snapshots` (1 route)
- `location_snapshot` → `location_snapshots` (geocoded, sparse)
- `security_event` → `security_events` (3 routes)

Authoring 7 near-identical writers would violate DRY and create 7 sites
that drift independently when the upsert pattern needs to change. This
prompt creates the unexported `snapshotWriter` helper that the per-dest
wrappers in 0012-0018 will compose.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **File location** | `internal/tesla/router/writers/snapshot_base.go`. New `writers/` subpackage under `router/` (not under `router/` itself, to keep the public router API surface unchanged). Subpackage name: `package writers`. |
| 2 | **Helper signature** | `type snapshotWriter struct { db pgxPool; table string; columnFor func(field string) (col string, ok bool) }`. The `columnFor` callback is the only per-destination customisation — it maps `atomic.Field` to the destination column. Returning `ok=false` for an unknown field means "drop silently with metric increment" (this should never happen in practice because routing.yaml guarantees every routed field has an entry, but defence in depth). |
| 3 | **Idempotency** | `INSERT ... ON CONFLICT (vehicle_id, ts) DO UPDATE SET <col> = EXCLUDED.<col>`. Per-column upsert means two atomics for the same `(vehicle_id, ts)` with different fields produce one row with both columns set, not two rows. |
| 4 | **Type marshalling** | `atomic.SIValue` is a typed value wrapper. The helper uses a small switch on the underlying type (float64, int64, bool, string) to bind to the `$3` parameter. Compound atomics (lat/lng pairs, door states) are NOT routed to snapshot tables — they go to `positions` / `signal_log` — so the helper does NOT handle compound types. |
| 5 | **Idempotency contract enforcement** | A `// router.Writer` compile-time assertion in the file: `var _ router.Writer = (*snapshotWriter)(nil)`. |
| 6 | **Error wrapping** | Every error from `db.Exec` is wrapped with `fmt.Errorf("snapshotWriter[%s].%s: %w", w.table, atomic.Field, err)`. The router's classifyError tag set picks up timeouts/cancellations from the wrapped chain. |
| 7 | **Database dependency** | Use the project's existing `*pgxpool.Pool` directly. NO new repo abstraction; writers are the leaf-most layer and a repo wrapper would just forward calls. |
| 8 | **Tests** | Table-driven test against a recorded SQL exec. Use `pgxmock` or a small in-memory recorder (whichever the project already uses; check `go.mod`). 5 cases minimum: float64 column, int64 column, bool column, string column, unknown-field-returns-error. |

## Action Steps

1. Verify `git status` is clean.
2. Verify predecessor: `phase-42a-0000-methodology-and-cutover-decision.log` exists with EXIT=0/STATUS=DONE.
3. Create `internal/tesla/router/writers/doc.go` with package-level doc comment explaining the writers subpackage:
   ```
   // Package writers contains production router.Writer implementations for
   // every non-drop destination declared in routing.yaml. Each destination
   // has its own file. Snapshot writers (climate, motor, tire_pressure,
   // media, safety, location, security_event) compose the unexported
   // snapshotWriter helper in snapshot_base.go.
   //
   // Per ADR-004 #8 writers are best-effort, idempotent on (vehicle_id, ts,
   // field), and MUST NOT retry internally.
   package writers
   ```
4. Create `snapshot_base.go` per Decisions #1-#7. Reference packages:
   - `internal/tesla/codec` for `codec.Atomic`
   - `internal/tesla/router` for `router.Writer`, `router.Entry`
   - `github.com/jackc/pgx/v5/pgxpool` for the pool type
5. Create `snapshot_base_test.go` per Decision #8. Use whichever DB-mock library the project already imports (check `go.mod`).
6. Run gates in `=== GATE ===`:
   - `go build ./internal/tesla/router/writers/...` (must succeed)
   - `go vet ./internal/tesla/router/writers/...` (must succeed, no warnings)
   - `go test -race ./internal/tesla/router/writers/...` (must pass)
   - `git status --short` must show only allowed files modified
7. In `=== COMMIT ===`, commit with: `feat(tesla/router): add snapshot writer helper for *_snapshot dests`
   Trailer: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
8. Append `EXIT=0` and `STATUS=DONE` on their own lines.

## Escape hatch

If the project does NOT already use `pgxmock` or an equivalent SQL
recorder, do NOT add a new test dependency in this prompt. Instead, write
the test against a tiny in-file `recorder` type that implements just the
`Exec(ctx, sql, args...) (pgconn.CommandTag, error)` method the helper
calls. Document this choice in `=== IMPLEMENTATION ===`.
