---
description: "Phase 6 — Implement flattenDoors: door_state map -> atomic bool signals"
---

# 🔵 Write-Path 11 — Implement `flattenDoors`

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 11 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/flatten.go` (extend) |
| Depends on | `10-flatten-define-types` |
| Blocks | `12-flatten-implement-typetime` |
| ADR refs | ADR-002 |

## Single Goal

Replace the `flattenDoors` stub with a real implementation: take `map[string]any` keyed by door positions, emit one `Atomic` per present door with name `DoorState_<Position>` and value `bool` (true = "Open"). Missing parts skipped (not error). Wrong types return descriptive errors.

## Recommendation

```go
func flattenDoors(raw any) ([]Atomic, error) {
    m, ok := raw.(map[string]any)
    if !ok {
        return nil, fmt.Errorf("DoorState: expected map[string]any, got %T", raw)
    }
    parts := []string{
        "DriverFront", "PassengerFront",
        "DriverRear",  "PassengerRear",
        "FrontTrunk",  "RearTrunk",
    }
    out := make([]Atomic, 0, len(parts))
    for _, p := range parts {
        v, present := m[p]
        if !present {
            continue
        }
        s, ok := v.(string)
        if !ok {
            return nil, fmt.Errorf("DoorState.%s: expected string, got %T", p, v)
        }
        out = append(out, Atomic{
            Name:  "DoorState_" + p,
            Value: s == "Open",
        })
    }
    return out, nil
}
```

Add `import "fmt"` at the top of `flatten.go` if not already present.

## Acceptance Criteria

- [ ] `flattenDoors` returns one Atomic per *present* door part
- [ ] Open → `true`, anything else → `false`
- [ ] Missing parts skipped silently
- [ ] Top-level wrong type → descriptive error
- [ ] Per-part wrong type → descriptive error citing the part
- [ ] Atomic names match the entries registered in `hot_catalog_security.go` (prompt 07)
- [ ] `go build ./internal/telemetry/...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/telemetry/...
# Smoke check: function body is no longer a stub
Select-String -Path internal\telemetry\flatten.go -Pattern 'DoorState_' | Measure-Object | ForEach-Object { "DoorState_ refs: $($_.Count)" }
```

## Out of Scope

- Don't add tests here (prompt 16)
- Don't add new door positions beyond Phase 3 columns

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/flatten.go
git commit -m "telemetry(db-refactor): implement flattenDoors

DoorState compound -> 6 atomic bool signals (one per door/trunk).
Open => true. Partial-payload tolerant. Aligns with security_events
typed columns from prompt 07.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 6 prompt 07 (door atomic catalog entries)
- migration 000131 (door widening)
