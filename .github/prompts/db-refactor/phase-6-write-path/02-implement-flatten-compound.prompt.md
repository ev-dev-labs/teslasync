---
description: "Phase 6 — Implement compound-signal flattening (DoorState/WindowState/Location/Time)"
---

# 🔵 Write-Path 02 — Compound Signal Flattening

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 2 of 4

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/flatten.go` (new) |
| Depends on | `01-build-hot-signal-catalog` |
| Blocks | `03-rewrite-telemetry-handler` |
| ADR refs | ADR-002 |
| Estimated effort | small (~3-4 hours) |

## Single Goal

Implement `Flatten(name string, raw any) ([]Atomic, error)` which, given a compound signal, returns a slice of atomic `(name, value)` pairs ready to feed back through `LookupHot`. Compounds expand to multiple atomic writes.

## What's Being Established

Tesla emits 4 compound signal kinds. Without flattening, each lands as `map[string]any` and either gets dropped at the snapshot repo (current bug) or silently coerced to empty string (the bug captured in repo memories about TypeDoors / TypeTime). Flattening converts a single compound into N atomic signals BEFORE the routing pass.

## Compound types and expansions

### `DoorState` → 6 atomic bool signals
```
{DriverFront: "Open", PassengerFront: "Closed", DriverRear: "Open",
 PassengerRear: "Closed", FrontTrunk: "Closed", RearTrunk: "Closed"}
→
DoorState_DriverFront     = true   (Open => true, Closed => false)
DoorState_PassengerFront  = false
DoorState_DriverRear      = true
DoorState_PassengerRear   = false
DoorState_FrontTrunk      = false
DoorState_RearTrunk       = false
```
These then route via the catalog to typed bool columns on `security_events`.

### `WindowState` → 4 atomic text signals
```
{DriverFront: "Closed", PassengerFront: "Vented", ...}
→
WindowState_DriverFront    = "closed"
WindowState_PassengerFront = "vented"
WindowState_DriverRear     = "closed"
WindowState_PassengerRear  = "closed"
```
Normalized values from migration 000132. Route to text columns on `security_events`.

### `Location` → 2 atomic numeric signals
```
{Latitude: 37.123, Longitude: -122.456}
→
Latitude  = 37.123
Longitude = -122.456
```
Route to `positions.latitude` / `positions.longitude`.

### Compound time (e.g. `ScheduledChargingStartTime`) → 1 string
```
{Hour: 22, Minute: 30, Second: 0}
→
ScheduledChargingStartTime = "22:30:00"
```
This is a 1-to-1 collapse, not 1-to-N. Goes to `charging_telemetry.scheduled_charging_at` as text.

## Recommendation

```go
package telemetry

import "fmt"

type Atomic struct {
    Name  string
    Value any
}

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
    default:
        // Not a compound — caller routes raw through LookupHot directly.
        return []Atomic{{Name: name, Value: raw}}, nil
    }
}

func flattenDoors(raw any) ([]Atomic, error) {
    m, ok := raw.(map[string]any)
    if !ok { return nil, fmt.Errorf("DoorState: expected map, got %T", raw) }
    parts := []string{"DriverFront","PassengerFront","DriverRear","PassengerRear","FrontTrunk","RearTrunk"}
    out := make([]Atomic, 0, len(parts))
    for _, p := range parts {
        v, present := m[p]
        if !present { continue }
        s, ok := v.(string)
        if !ok { return nil, fmt.Errorf("DoorState.%s: expected string, got %T", p, v) }
        out = append(out, Atomic{Name: "DoorState_" + p, Value: s == "Open"})
    }
    return out, nil
}

func flattenWindows(raw any) ([]Atomic, error) { /* ... similar, normalize to lower-case ... */ }
func flattenLocation(raw any) ([]Atomic, error) { /* extract Latitude+Longitude */ }
func flattenTime(name string, raw any) ([]Atomic, error) {
    m, ok := raw.(map[string]any)
    if !ok { return nil, fmt.Errorf("%s: expected map, got %T", name, raw) }
    h, _ := toInt(m["Hour"])
    mn, _ := toInt(m["Minute"])
    s, _ := toInt(m["Second"])
    return []Atomic{{Name: name, Value: fmt.Sprintf("%02d:%02d:%02d", h, mn, s)}}, nil
}
```

### Catalog wiring (back-reference)

The flattened atomic names (`DoorState_DriverFront`, `WindowState_PassengerRear`, etc.) need to exist in `HotSignalCatalog` from prompt 01. Add them there if not already.

## Suggested Fix

1. Write `flatten.go`
2. Add per-part atomic-name entries to `HotSignalCatalog` (e.g. `DoorState_DriverFront → security_events.door_driver_front_open bool`)
3. Add table-driven tests for each compound:
   - Happy path with all parts present
   - Partial payload (some parts absent — must skip, not error)
   - Wrong type at top level (returns error)
   - Wrong type at part level (returns error)
4. Build + test + commit

## Acceptance Criteria

- [ ] `Flatten(name, raw)` handles all 4 compound kinds
- [ ] Non-compound names pass-through as `[{name, raw}]` (don't error, don't transform)
- [ ] Partial-payload tolerance: missing parts are skipped, not errors
- [ ] Wrong-type cases return descriptive errors (`%w`-friendly)
- [ ] Each compound's atomic names are present in `HotSignalCatalog` (cross-reference test)
- [ ] Unit tests cover: 4 happy paths, 4 partial-payload paths, 4 wrong-type paths = 12+ test cases
- [ ] Pure function — no DB, no I/O
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go test -race -count=1 ./internal/telemetry/... -run TestFlatten -v

# Cross-ref: every atomic name produced by Flatten is in HotSignalCatalog
go test -race -count=1 ./internal/telemetry/... -run TestFlattenCatalogCoverage
# (this test enumerates compound subkeys and asserts catalog membership)
```

## Out of Scope

- Don't add new compound types beyond the 4 above (Tesla doesn't emit any others currently)
- Don't merge with `LookupHot` — keep them as separate functions for testability
- Don't add per-vehicle compound aliases — Tesla format is uniform across fleet

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/flatten.go internal/telemetry/flatten_test.go internal/telemetry/hot_signals.go
git commit -m "telemetry(db-refactor): add Flatten() for 4 compound signal kinds

ADR-002: DoorState/WindowState/Location/Time compounds expand to N
atomic (name, value) pairs. Caller routes each atomic through
HotSignalCatalog. Partial-payload tolerant. Pure function, fully
unit-tested.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-002
- Repo memories on TypeDoors and TypeTime compound flattening
- Migrations 000131 (door_state widening), 000132 (window state), 000139 (HVAC), 000133 (turn signal)
