---
description: "Phase 6 — Implement flattenLocation: {lat,lng} map -> 2 atomic numeric signals"
---

# 🔵 Write-Path 13 — Implement `flattenLocation`

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 13 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/flatten.go` (extend) |
| Depends on | `12-flatten-implement-typetime` |
| Blocks | `14-flatten-implement-typeshiftstate` |
| ADR refs | ADR-002 |

## Single Goal

Replace the `flattenLocation` stub. Tesla `Location` arrives as `{Latitude: 37.123, Longitude: -122.456}`. Emit 2 atomics: `Latitude` and `Longitude` (both float64). These then route via prompt 04's catalog entries to `positions.latitude` / `positions.longitude`.

## Recommendation

```go
func flattenLocation(raw any) ([]Atomic, error) {
    m, ok := raw.(map[string]any)
    if !ok {
        return nil, fmt.Errorf("Location: expected map[string]any, got %T", raw)
    }
    lat, err := toFloat64(m["Latitude"])
    if err != nil {
        return nil, fmt.Errorf("Location.Latitude: %w", err)
    }
    lng, err := toFloat64(m["Longitude"])
    if err != nil {
        return nil, fmt.Errorf("Location.Longitude: %w", err)
    }
    if lat < -90 || lat > 90 {
        return nil, fmt.Errorf("Location.Latitude out of range: %v", lat)
    }
    if lng < -180 || lng > 180 {
        return nil, fmt.Errorf("Location.Longitude out of range: %v", lng)
    }
    return []Atomic{
        {Name: "Latitude",  Value: lat},
        {Name: "Longitude", Value: lng},
    }, nil
}

func toFloat64(v any) (float64, error) {
    switch x := v.(type) {
    case nil:
        return 0, fmt.Errorf("nil")
    case float64:
        return x, nil
    case float32:
        return float64(x), nil
    case int:
        return float64(x), nil
    case int64:
        return float64(x), nil
    case string:
        f, err := strconv.ParseFloat(x, 64)
        if err != nil {
            return 0, fmt.Errorf("parse float %q: %w", x, err)
        }
        return f, nil
    default:
        return 0, fmt.Errorf("unexpected type %T", v)
    }
}
```

## Acceptance Criteria

- [ ] Returns exactly 2 atomics: `Latitude` then `Longitude`
- [ ] Out-of-range coordinates return descriptive errors
- [ ] `toFloat64` accepts float64/float32/int/int64/string
- [ ] Atomic names exactly match the catalog entries from prompt 04
- [ ] `go build ./internal/telemetry/...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/telemetry/...
```

## Out of Scope

- Don't compute geohash here (handled in positions repo if needed)
- Don't reverse-geocode (out of telemetry scope; Phase 5 adapter)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/flatten.go
git commit -m "telemetry(db-refactor): implement flattenLocation

Location compound -> {Latitude, Longitude} atomic floats. Range-checked
(±90 / ±180). Routes via positions catalog entries.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 6 prompt 04 (positions catalog)
