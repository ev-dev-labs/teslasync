---
description: "Phase 41-rewrite F009 - battery-handler null-vs-zero response shape"
---

# Prompt 0140 — F009: Battery handler null shape

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN | **Finding:** F009 (MED, response-shape)

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-41-rewrite-0140-F009-battery-handler-null-shape.log` |
| Depends on | `phase-41-rewrite-0000-preflight-and-baseline.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/api/battery_handler.go`, `internal/api/battery_handler_test.go`, `internal/models/battery.go` (if response struct lives there), the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem (verbatim from `findings` table, F009)

Battery / capacity / range fields serialize as 0 when source telemetry
is absent. The frontend cannot distinguish "no data" from "value is
truly zero" — a fully-discharged battery (real 0%) and a missing
reading look identical. Cited:
- `internal/api/battery_handler.go:59-61`
- `internal/api/battery_handler.go:75-95`
- `internal/api/battery_handler.go:121-137`
- `internal/api/battery_handler.go:198-210`

## Invariant

Response-shape values that represent a measurement MUST distinguish
"absent" from "zero". JSON convention: `null` for absent, numeric for
present. Go convention: `*float64` / `*int` with `omitempty`.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Type rewrite | Convert affected struct fields to `*float64` / `*int`. Update JSON tags with `,omitempty`. |
| 2 | Handler logic | When the source repo returns `sql.NullFloat64{Valid: false}` (or equivalent), DO NOT assign — leave the pointer nil. When valid, take address of a local variable: `v := row.Column.Float64; resp.Field = &v`. |
| 3 | Tests | Add table-driven tests asserting: (a) absent source → JSON omits the field (or sets `null`); (b) zero source → JSON includes `0`. Use `json.Marshal` + raw string comparison or `json.Unmarshal` into a map and check key presence. |
| 4 | Frontend coordination | NONE in this prompt. The frontend already coalesces `?? 0` for display per existing convention. The fix is server-side correctness; the SPA can be updated later to render "—" for null. |
| 5 | Build/test gate | `go build ./...` + `go test -count=1 ./internal/api/...`. |

## Action Steps

1. `git status` clean. `=== PREFLIGHT ===`.
2. `=== AUDIT_EVIDENCE ===`:
   - Dump each cited range BEFORE.
   - Dump the response struct field types.
3. `=== IMPLEMENTATION ===`:
   - Convert field types to pointers + omitempty.
   - Refactor handler assignments to skip on absent source.
   - Add tests.
4. `=== GATE ===` — build / vet / test.
5. `=== COMMIT ===` commit `fix(api): F009 — distinguish absent from zero in battery response shape`.
