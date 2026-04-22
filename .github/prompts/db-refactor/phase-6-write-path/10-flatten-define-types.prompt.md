---
description: "Phase 6 — Define Atomic struct + Flatten() dispatch fn signature in internal/telemetry/flatten.go"
---

# 🔵 Write-Path 10 — Define Flatten Types

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 10 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/flatten.go` (new) |
| Depends on | `09-test-hot-catalog-coverage` |
| Blocks | `11-flatten-implement-typedoors` |
| ADR refs | ADR-002 |

## Single Goal

Create `flatten.go` with ONLY: the `Atomic` struct, the `Flatten` dispatch function shell, and stubs for the 5 per-kind helpers. No body logic yet — that lands in prompts 11–15.

## Recommendation

```go
package telemetry

// Atomic is one (name, value) pair after compound expansion. The handler
// re-routes each Atomic through LookupHot.
type Atomic struct {
    Name  string
    Value any
}

// Flatten dispatches a (name, raw) pair to the appropriate per-kind expander.
// For non-compound names it returns a single-element slice containing the
// raw value unchanged (pass-through). Compound names expand to N atomics.
func Flatten(name string, raw any) ([]Atomic, error) {
    switch name {
    case "DoorState":
        return flattenDoors(raw)
    case "WindowState":
        return flattenWindows(raw)
    case "Location":
        return flattenLocation(raw)
    case "ScheduledChargingStartTime", "ScheduledDepartureTime":
        return flattenTime(name, raw)
    case "ShiftState":
        return flattenShiftState(raw)
    default:
        return flattenPassthrough(name, raw)
    }
}

// Stubs — implementations land in prompts 11-15.
func flattenDoors(raw any) ([]Atomic, error)              { return nil, nil }
func flattenWindows(raw any) ([]Atomic, error)            { return nil, nil }
func flattenLocation(raw any) ([]Atomic, error)           { return nil, nil }
func flattenTime(name string, raw any) ([]Atomic, error)  { return nil, nil }
func flattenShiftState(raw any) ([]Atomic, error)         { return nil, nil }
func flattenPassthrough(name string, raw any) ([]Atomic, error) {
    return []Atomic{{Name: name, Value: raw}}, nil
}
```

## Acceptance Criteria

- [ ] `Atomic` struct + `Flatten` switch dispatcher present
- [ ] All 6 helper functions exist (5 stubs + passthrough actual)
- [ ] Passthrough returns `[{name, raw}], nil` for unknown names
- [ ] `go build ./internal/telemetry/...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/telemetry/...
Select-String -Path internal\telemetry\flatten.go -Pattern '^func flatten\w+' | Measure-Object | ForEach-Object { "helper fns: $($_.Count)" }
# Expected: 6
```

## Out of Scope

- Don't implement helper bodies (prompts 11–15)
- Don't add tests yet (prompts 16–19)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/flatten.go
git commit -m "telemetry(db-refactor): scaffold Flatten() dispatcher + Atomic type

Switch dispatcher + per-kind stubs. Passthrough is the only helper
with real logic at this stage.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-002
