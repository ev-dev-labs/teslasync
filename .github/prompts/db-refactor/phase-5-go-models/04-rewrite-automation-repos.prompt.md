---
description: "Phase 5 — Rewrite automations repo for class-table-inheritance schema"
---

# 🔵 Models 04 — Automation Repos (CTI)

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 4 of 6

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output files | `internal/database/automations_repo.go` (rewrite), `internal/database/automation_steps_repo.go` (new) |
| Depends on | `01-regenerate-models`, `02-delete-eliminated-fields` |
| Blocks | `phase-9-acceptance` |
| ADR refs | ADR-004 (CTI for automations) |
| Estimated effort | medium (~1 day) |

## Single Goal

Replace the JSON-blob-based `automations_repo.go` with a CTI-aware repo that loads `automations` + `automation_steps` + the matching typed child row per step, and persists via the same multi-table dance.

## What's Being Established

Per ADR-004, automations are normalized into a parent + steps + 12 typed child tables. Reads return a composite `AutomationFull`. Writes happen in a transaction. The old "store the whole JSON blob in `trigger_config`/`conditions`/`actions`" pattern is gone.

## Recommendation

### Read shape

```go
// Returns Automation + ordered Steps, each with exactly one typed-detail pointer set.
func (r *AutomationsRepo) GetByID(ctx context.Context, id int64) (*models.AutomationFull, error)

// Lists summaries (no steps loaded — for index pages)
func (r *AutomationsRepo) ListSummaries(ctx context.Context, enabled *bool, limit, offset int) ([]models.Automation, error)

// Bulk load N automations with all their steps in 2 round-trips total
// (1 query for parents + steps via JOIN, 1 query for child details via UNION across child tables OR
// per-kind queries fanned out — see implementation note)
func (r *AutomationsRepo) ListFull(ctx context.Context, ids []int64) ([]models.AutomationFull, error)
```

### Implementation note — fetching child details

Avoid 12 separate round-trips per automation. Two options:

**Option A — UNION query** (preferred for read latency):
```sql
SELECT 'trigger_signal' AS kind, step_id, signal_name, op, threshold, NULL::interval AS window, NULL::int AS place_id, ...
  FROM automation_step_trigger_signal WHERE step_id = ANY($1)
UNION ALL
SELECT 'trigger_geofence', step_id, NULL, NULL, NULL, NULL, place_id, ...
  FROM automation_step_trigger_geofence WHERE step_id = ANY($1)
-- ... 10 more ...
```
Scan into a wide row struct, then dispatch to typed pointer based on `kind`.

**Option B — fan-out** (simpler code, more round-trips): one SELECT per child table filtered by `step_id IN (...)`. Acceptable if N(automations × steps) is small.

Pick A. Comment the trade-off.

### Write shape

```go
// CreateFull persists Automation + Steps + child rows in a single transaction.
// Order:
//   1. INSERT automations RETURNING id
//   2. For each step:
//      a. INSERT automation_steps (automation_id, position, kind) RETURNING id
//      b. INSERT into the matching child table (automation_step_<kind>) with step_id
//   3. INSERT automation_tags rows
//   4. COMMIT
//
// On any error: ROLLBACK; return wrapped error.
func (r *AutomationsRepo) CreateFull(ctx context.Context, full *models.AutomationFull) (int64, error)

// UpdateFull is delete-and-recreate for steps (children are CASCADE on step_id).
// Updates the automations row in place; deletes all old steps; inserts new ones.
// Same transaction.
func (r *AutomationsRepo) UpdateFull(ctx context.Context, full *models.AutomationFull) error

func (r *AutomationsRepo) Delete(ctx context.Context, id int64) error  // CASCADE handles children
func (r *AutomationsRepo) SetEnabled(ctx context.Context, id int64, enabled bool) error
```

### `automation_steps_repo.go`

A thin helper for the child-table dispatch logic — the parent repo delegates per-kind insert/select to this. Keeps `automations_repo.go` from sprawling.

```go
type AutomationStepsRepo struct{ db *DB }

// InsertChild dispatches based on step.Kind, inserting the matching typed-details row.
// Returns error on type mismatch (e.g. Kind=trigger_signal but TriggerSignal pointer is nil).
func (r *AutomationStepsRepo) InsertChild(ctx context.Context, tx pgx.Tx, step *models.AutomationStep) error

// LoadChildren bulk-loads typed children for a slice of step IDs (UNION query above)
func (r *AutomationStepsRepo) LoadChildren(ctx context.Context, stepIDs []int64) (map[int64]models.AutomationStep, error)
```

## Suggested Fix

1. Write `automation_steps_repo.go` with `InsertChild` switch
2. Rewrite `automations_repo.go` using the helpers
3. Replace HTTP handler glue in `internal/api/automation_handler.go` to call `CreateFull` / `UpdateFull` / `GetByID` instead of the old JSON-blob path
4. Ensure transaction rollback path is correct (returned error → caller sees ROLLBACK happened)
5. Add table-driven tests covering: create with all 12 step kinds, update (delete-and-recreate steps), get-by-id, list-summaries pagination
6. Build + tests + commit

## Acceptance Criteria

- [ ] `automations_repo.go` has no `RawJSON`, no `TriggerConfig`, no `Conditions`, no `Actions`
- [ ] `AutomationFull` returned from `GetByID` has steps in `position` order
- [ ] Each step has exactly one non-nil typed-detail pointer
- [ ] `CreateFull` and `UpdateFull` use a transaction (single `tx.Begin` / `tx.Commit`)
- [ ] Error in any step → `tx.Rollback` called (use `defer tx.Rollback(ctx)` pattern)
- [ ] Child loading uses ONE query (UNION), not 12 round-trips
- [ ] `Delete` relies on `ON DELETE CASCADE` (no explicit child deletes)
- [ ] HTTP handler wires through cleanly; old endpoint contracts preserved
- [ ] `go test -race ./internal/database/... -run TestAutomation` passes
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./...
go test -race -count=1 ./internal/database/... -run 'TestAutomation'
go test -race -count=1 ./internal/api/...      -run 'TestAutomation'

# UNION pattern present
Select-String -Path internal\database\automation_steps_repo.go -Pattern 'UNION ALL'
# Expected: at least 1 hit
```

## Out of Scope

- Don't add new automation step kinds (the 12 in Phase 3 are the complete set)
- Don't change the HTTP API contract — frontend in Phase 7 wants the same `AutomationFull` JSON shape
- Don't migrate old jsonb-based automation rows (none exist post-cutover; ADR-009)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/database/automations_repo.go internal/database/automation_steps_repo.go internal/api/automation_handler.go
git add internal/database/automations_repo_test.go internal/database/automation_steps_repo_test.go
git commit -m "repo(db-refactor): rewrite automations for CTI schema

ADR-004: automations + automation_steps + 12 typed child tables.
Single-transaction Create/Update; CASCADE-based Delete; UNION query
for child fan-in. HTTP handler unchanged externally.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-004
- `phase-3-schema/14-create-automations-parent.prompt.md`
- `phase-3-schema/15-create-automation-conditions.prompt.md`
- `phase-3-schema/16-create-automation-actions.prompt.md`
- `phase-3-schema/17-create-automation-step-children.prompt.md`
