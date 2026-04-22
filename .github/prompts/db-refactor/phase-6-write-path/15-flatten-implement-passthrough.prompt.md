---
description: "Phase 6 — Implement flattenWindows + verify flattenPassthrough already correct"
---

# 🔵 Write-Path 15 — Implement `flattenWindows` + Verify Passthrough

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 15 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/flatten.go` (extend) |
| Depends on | `14-flatten-implement-typeshiftstate` |
| Blocks | `16-flatten-test-fixtures-typedoors` |
| ADR refs | ADR-002 |

## Single Goal

Replace the `flattenWindows` stub and re-confirm `flattenPassthrough` (added as actual logic in prompt 10). Window state expands to 4 atomics with text values normalized to lower-case (matches migration 000132's CHECK constraint enum: `closed`, `open`, `vented`, `partial`).

## Recommendation

```go
func flattenWindows(raw any) ([]Atomic, error) {
    m, ok := raw.(map[string]any)
    if !ok {
        return nil, fmt.Errorf("WindowState: expected map[string]any, got %T", raw)
    }
    parts := []string{"DriverFront", "PassengerFront", "DriverRear", "PassengerRear"}
    out := make([]Atomic, 0, len(parts))
    for _, p := range parts {
        v, present := m[p]
        if !present {
            continue
        }
        s, ok := v.(string)
        if !ok {
            return nil, fmt.Errorf("WindowState.%s: expected string, got %T", p, v)
        }
        out = append(out, Atomic{
            Name:  "WindowState_" + p,
            Value: strings.ToLower(strings.TrimSpace(s)),
        })
    }
    return out, nil
}
```

Add `"strings"` to imports if missing.

### Passthrough sanity (verify, no change expected)

```go
func flattenPassthrough(name string, raw any) ([]Atomic, error) {
    return []Atomic{{Name: name, Value: raw}}, nil
}
```

## Acceptance Criteria

- [ ] `flattenWindows` emits one Atomic per present window part with lowercase value
- [ ] Atomic names match prompt 07's `WindowState_*` catalog entries
- [ ] Final normalization to migration 000132's enum set happens via `NormalizeWindowState` transformer at apply time (not duplicated here)
- [ ] `flattenPassthrough` unchanged
- [ ] `go build ./internal/telemetry/...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/telemetry/...
Select-String -Path internal\telemetry\flatten.go -Pattern 'WindowState_' | Measure-Object | ForEach-Object { "WindowState_ refs: $($_.Count)" }
```

## Out of Scope

- Don't duplicate enum validation here — `NormalizeWindowState` transformer owns it

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/flatten.go
git commit -m "telemetry(db-refactor): implement flattenWindows + verify passthrough

WindowState compound -> 4 atomic text signals (lower-cased).
Final enum normalization deferred to NormalizeWindowState transformer
applied at hot-route time. Passthrough confirmed unchanged.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 6 prompt 07 (window catalog entries)
- migration 000132 (window state enum)
