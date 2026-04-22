---
description: "Phase 6 — Extract NormalizeFleetUnits as helper returning []NamedValue"
---

# 🔵 Write-Path 20 — Extract Normalize Step

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 20 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/normalize.go` (new), `internal/api/telemetry_handler.go` (edit) |
| Depends on | `19-flatten-test-coverage-end-to-end` |
| Blocks | `21-extract-flatten-loop` |
| ADR refs | ADR-002 |

## Single Goal

Pull the existing `normalizeFleetUnits` logic out of `telemetry_handler.go` into `internal/telemetry/normalize.go`. Change its return type from `map[string]any` to `[]NamedValue` so downstream prompts can iterate in a stable, ordered fashion (maps make race-y iteration order, which broke FSM state diff in the past).

## Recommendation

```go
// internal/telemetry/normalize.go
package telemetry

// NamedValue is one (name, value) pair preserving Tesla emission order.
// Order matters for FSM trackStateTransition because the same batch can
// contain prior+new values for a state-machine signal.
type NamedValue struct {
    Name  string
    Value any
}

// NormalizeFleetUnits applies the unit/format conversions Tesla Fleet
// Telemetry payloads need before downstream processing. Returns a slice
// (not a map) so callers can iterate deterministically.
func NormalizeFleetUnits(raw []NamedValue) []NamedValue {
    out := make([]NamedValue, 0, len(raw))
    for _, nv := range raw {
        // existing per-signal normalization rules (copy from old handler)
        // e.g.:
        //   case "VehicleSpeed": value as mph -> mps later in transformer; pass through
        //   case "InsideTemp": Tesla emits Celsius already -> pass through
        out = append(out, nv)
    }
    return out
}
```

In `telemetry_handler.go`:
- Replace inline normalization with `telemetry.NormalizeFleetUnits(...)` call
- Update batch decode path to produce `[]telemetry.NamedValue` (not `map[string]any`)

## Acceptance Criteria

- [ ] `internal/telemetry/normalize.go` exists with `NamedValue` + `NormalizeFleetUnits([]NamedValue) []NamedValue`
- [ ] `telemetry_handler.go` no longer defines its own normalize logic
- [ ] Batch decode produces `[]NamedValue` preserving Tesla emission order
- [ ] Existing handler unit tests adapted and passing
- [ ] `go build ./internal/api/... ./internal/telemetry/...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/api/... ./internal/telemetry/...
Select-String -Path internal\api\telemetry_handler.go -Pattern 'normalizeFleetUnits|NormalizeFleetUnits'
# Expected: only the call site, not a definition
```

## Out of Scope

- Don't change normalization rules (preserve behavior; refactor only)
- Don't add new fields to `NamedValue` (kept minimal for predictability)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/normalize.go internal/api/telemetry_handler.go
git commit -m "telemetry(db-refactor): extract NormalizeFleetUnits, return []NamedValue

Eliminates map-based normalize step. Order preservation needed for
deterministic FSM state-diff in trackStateTransition.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-002
