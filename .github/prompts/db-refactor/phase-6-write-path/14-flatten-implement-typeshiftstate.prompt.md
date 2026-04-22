---
description: "Phase 6 — Implement flattenShiftState: gear position enum normalization"
---

# 🔵 Write-Path 14 — Implement `flattenShiftState`

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 14 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/flatten.go` (extend) |
| Depends on | `13-flatten-implement-typelocation` |
| Blocks | `15-flatten-implement-passthrough` |
| ADR refs | ADR-002 |

## Single Goal

Replace the `flattenShiftState` stub. Tesla `ShiftState` arrives as a single string enum (`"P"`, `"R"`, `"N"`, `"D"`, sometimes `null` for "no reading"). Emit one atomic with name `Gear` (matching the catalog entry from prompt 03) and lower-cased text value: `"park"`/`"reverse"`/`"neutral"`/`"drive"`. Null becomes a zero-length slice (skip, not error).

## Recommendation

```go
func flattenShiftState(raw any) ([]Atomic, error) {
    if raw == nil {
        return nil, nil // null shift = no signal, not an error
    }
    s, ok := raw.(string)
    if !ok {
        return nil, fmt.Errorf("ShiftState: expected string, got %T", raw)
    }
    var gear string
    switch s {
    case "P", "p", "Park", "park":
        gear = "park"
    case "R", "r", "Reverse", "reverse":
        gear = "reverse"
    case "N", "n", "Neutral", "neutral":
        gear = "neutral"
    case "D", "d", "Drive", "drive":
        gear = "drive"
    case "":
        return nil, nil
    default:
        return nil, fmt.Errorf("ShiftState: unknown value %q", s)
    }
    return []Atomic{{Name: "Gear", Value: gear}}, nil
}
```

## Acceptance Criteria

- [ ] All 4 standard gears mapped (P/R/N/D, both single-letter and word forms)
- [ ] `nil` and `""` raw inputs return `(nil, nil)` (skip, not error)
- [ ] Unknown enum value returns descriptive error
- [ ] Output atomic name is `Gear` (matches `vehicle_live_state` catalog entry)
- [ ] `go build ./internal/telemetry/...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/telemetry/...
```

## Out of Scope

- Don't add Sport / Tow / Service modes — those route as separate signals
- Don't write to `gear_changes` event stream — repo concern

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/flatten.go
git commit -m "telemetry(db-refactor): implement flattenShiftState

ShiftState single-letter / word forms normalized to lowercase
park/reverse/neutral/drive. Null/empty -> skip silently. Routes via
vehicle_live_state.gear catalog entry.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 6 prompt 03 (vehicle_live_state Gear entry)
