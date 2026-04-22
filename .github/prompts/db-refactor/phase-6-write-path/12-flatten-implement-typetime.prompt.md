---
description: "Phase 6 — Implement flattenTime: {hour,minute,second} map -> 'HH:MM:SS' text atomic"
---

# 🔵 Write-Path 12 — Implement `flattenTime`

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 12 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/flatten.go` (extend) |
| Depends on | `11-flatten-implement-typedoors` |
| Blocks | `13-flatten-implement-typelocation` |
| ADR refs | ADR-002 |

## Single Goal

Replace the `flattenTime` stub. Tesla emits `ScheduledChargingStartTime` / `ScheduledDepartureTime` as `{Hour, Minute, Second}` ints. Collapse to a single atomic with value `"HH:MM:SS"` (zero-padded). 1-to-1 collapse, not 1-to-N.

## Recommendation

```go
func flattenTime(name string, raw any) ([]Atomic, error) {
    m, ok := raw.(map[string]any)
    if !ok {
        return nil, fmt.Errorf("%s: expected map[string]any, got %T", name, raw)
    }
    h, err := toInt(m["Hour"])
    if err != nil {
        return nil, fmt.Errorf("%s.Hour: %w", name, err)
    }
    mn, err := toInt(m["Minute"])
    if err != nil {
        return nil, fmt.Errorf("%s.Minute: %w", name, err)
    }
    s, err := toInt(m["Second"])
    if err != nil {
        return nil, fmt.Errorf("%s.Second: %w", name, err)
    }
    if h < 0 || h > 23 || mn < 0 || mn > 59 || s < 0 || s > 59 {
        return nil, fmt.Errorf("%s: out-of-range %02d:%02d:%02d", name, h, mn, s)
    }
    return []Atomic{{Name: name, Value: fmt.Sprintf("%02d:%02d:%02d", h, mn, s)}}, nil
}

// toInt accepts float64 (default JSON number type), int, int64, json.Number, or numeric string.
func toInt(v any) (int, error) {
    switch x := v.(type) {
    case nil:
        return 0, fmt.Errorf("nil")
    case int:
        return x, nil
    case int64:
        return int(x), nil
    case float64:
        return int(x), nil
    case string:
        n, err := strconv.Atoi(x)
        if err != nil {
            return 0, fmt.Errorf("parse int %q: %w", x, err)
        }
        return n, nil
    default:
        return 0, fmt.Errorf("unexpected type %T", v)
    }
}
```

Add `"strconv"` to the imports.

## Acceptance Criteria

- [ ] `flattenTime` returns exactly one `Atomic` (1-to-1 collapse)
- [ ] Output value is zero-padded `"HH:MM:SS"` string
- [ ] Out-of-range values return descriptive error
- [ ] `toInt` handles float64 (JSON default), int, int64, string
- [ ] `go build ./internal/telemetry/...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/telemetry/...
```

## Out of Scope

- Don't add timezone handling (Tesla emits local time; downstream stays naive)
- Don't return a `time.Time` — the destination columns are `text`

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/flatten.go
git commit -m "telemetry(db-refactor): implement flattenTime

ScheduledChargingStartTime / ScheduledDepartureTime compounds collapse
to 'HH:MM:SS' text atomics. Range-checked. JSON-numeric tolerant via
toInt helper.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 6 prompt 08 (charging_telemetry compound time entries)
