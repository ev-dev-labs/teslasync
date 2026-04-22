---
description: "Phase 6 — Assemble per-table row maps (column->value), apply Transformers"
---

# 🔵 Write-Path 23 — Build Hot Rows + Apply Transformers

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 23 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/api/telemetry_handler.go` (edit) |
| Depends on | `22-extract-bucket-step` |
| Blocks | `24-extract-build-cold-observations` |
| ADR refs | ADR-002 |

## Single Goal

For each (table, atomics) pair from the bucket, build one or more row maps `column -> value`, applying the route's `Transformer` if present. Transform errors demote the atomic to cold (don't fail the row).

## Recommendation

```go
// buildHotRow folds a slice of atomics that all target the same table into
// one column->value map. For tables that only ever take one row per batch
// (vehicle_live_state via UPSERT, snapshot tables via single per-tick row),
// this is one row. The handler decides per-table how to use the result
// (single Upsert vs batched Insert) in prompt 26.
func (h *TelemetryHandler) buildHotRow(table string, atomics []telemetry.Atomic, demoteCold *[]telemetry.Atomic) map[string]any {
    row := map[string]any{}
    for _, a := range atomics {
        hot := telemetry.LookupHot(a.Name)
        if hot == nil || hot.Column == "" {
            *demoteCold = append(*demoteCold, a)
            continue
        }
        v := a.Value
        if hot.Transformer != nil {
            tv, err := hot.Transformer(v)
            if err != nil {
                log.Warn().
                    Err(err).
                    Str("signal", a.Name).
                    Str("table", table).
                    Msg("transform failed; demoting to cold")
                *demoteCold = append(*demoteCold, a)
                continue
            }
            v = tv
        }
        row[hot.Column] = v
    }
    return row
}
```

Wire after bucket step:

```go
hotRows := map[string]map[string]any{}
for table, items := range buckets.HotByTable {
    hotRows[table] = h.buildHotRow(table, items, &buckets.Cold)
}
```

## Acceptance Criteria

- [ ] One `map[string]any` row built per hot table
- [ ] Transformer errors do NOT abort the row — atomic is appended to `buckets.Cold`
- [ ] Per-error log line includes signal name + table
- [ ] `go build ./internal/api/...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/api/...
Select-String -Path internal\api\telemetry_handler.go -Pattern 'buildHotRow'
```

## Out of Scope

- Don't materialize to typed structs here (prompt 26 owns per-repo type assembly)
- Don't write to DB

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/api/telemetry_handler.go
git commit -m "telemetry(db-refactor): build per-table hot rows + apply transformers

Transform errors demote the atomic to cold rather than failing the
row, so bad data lands losslessly in signal_observations.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 6 prompts 22, 26
