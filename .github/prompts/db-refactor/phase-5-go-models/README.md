# Phase 5 — Go Models & Repositories

> **Goal:** Bring `internal/models/` and `internal/database/*_repo.go` into alignment with the new typed schema. Eliminate every `json.RawMessage`, `pgtype.JSONB`, and `[]byte` field that corresponded to an eliminated jsonb column.
>
> **Pre-req:** Phase 4 complete — `000142_baseline_typed.up.sql` applies cleanly.
>
> **Scope:** Models, repos, and repo-level tests. Telemetry write-path refactor is **Phase 6**; HTTP handlers come along for the ride only where types changed.

## Prompts in this phase

| # | File | Purpose |
|--:|------|---------|
| 01 | `01-regenerate-models.prompt.md` | One Go struct per Phase 3 table; snake_case json tags; pointer types for nullable cols; typed enum aliases |
| 02 | `02-delete-eliminated-fields.prompt.md` | Remove `RawJSON`, `Signals map[string]any`, `TriggerConfig`, `Conditions`, `Actions` from all models; verify no readers remain |
| 03 | `03-rewrite-signal-repos.prompt.md` | New `SignalObservationsRepo` + `SignalCatalogRepo`; bulk insert path |
| 04 | `04-rewrite-automation-repos.prompt.md` | New `AutomationStepsRepo` (CTI children); composite `AutomationFull` read shape |
| 05 | `05-rewrite-snapshot-repos.prompt.md` | Drop `signals` jsonb writes from positions/charging/climate/motor/security repos; route through hot-typed columns only |
| 06 | `06-build-and-test.prompt.md` | `go build ./... && go test -race ./... && go vet ./... && golangci-lint run ./...` — all green |

## Binding rules

- One Go struct per Phase 3 table (no shared structs across CTI children)
- `json` tags = snake_case = column name (frontend depends on this)
- `db` tags = column name
- Nullable columns → `*T` pointer types
- Enums → typed string aliases with `const` block
- Every public function takes `context.Context` as first arg
- All queries parameterized (`$1`, `$2`)
- `defer rows.Close()` on every `Query`
- Wrap errors: `fmt.Errorf("op name: %w", err)`

## Reference

- Old monolith: `prompts/03-update-go-models-and-repos.prompt.md` (superseded)
- ADR-001, ADR-004 (CTI for automations)
- `phase-3-schema/README.md`
