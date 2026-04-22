---
description: "Phase 6 — Bucket atomics by hot-target-table; cold residue accumulates in a slice"
---

# 🔵 Write-Path 22 — Extract Bucket Step

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 22 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/api/telemetry_handler.go` (edit) |
| Depends on | `21-extract-flatten-loop` |
| Blocks | `23-extract-build-hot-rows` |
| ADR refs | ADR-002 |

## Single Goal

Add the routing pass: walk `atomics`, call `telemetry.LookupHot`, and partition into:
1. `hotByTable map[string][]telemetry.Atomic` (per-table queues for hot writes)
2. `cold []telemetry.Atomic` (everything not in `HotCatalog`)

Transformer application is deferred to prompt 23.

## Recommendation

```go
type bucketResult struct {
    HotByTable map[string][]telemetry.Atomic
    Cold       []telemetry.Atomic
    AllNames   []string // for catalog upsert (prompt 25)
}

func bucketAtomics(atomics []telemetry.Atomic) bucketResult {
    res := bucketResult{
        HotByTable: map[string][]telemetry.Atomic{},
        Cold:       make([]telemetry.Atomic, 0),
        AllNames:   make([]string, 0, len(atomics)),
    }
    for _, a := range atomics {
        res.AllNames = append(res.AllNames, a.Name)
        hot := telemetry.LookupHot(a.Name)
        if hot == nil || hot.Column == "" {
            // Compound parent (Column=="") should never reach here — Flatten
            // already expanded it. If it does, it's an unmapped atomic -> cold.
            res.Cold = append(res.Cold, a)
            continue
        }
        res.HotByTable[hot.Table] = append(res.HotByTable[hot.Table], a)
    }
    return res
}
```

Wire into `ProcessBatch` after the flatten loop:

```go
buckets := bucketAtomics(atomics)
log.Debug().
    Int("hot_tables", len(buckets.HotByTable)).
    Int("cold_atomics", len(buckets.Cold)).
    Msg("bucket step complete")
```

## Acceptance Criteria

- [ ] `bucketAtomics` returns hot-by-table map + cold slice + name slice
- [ ] Compound parents (empty Column) never appear in hot bucket — they fall through to cold
- [ ] `AllNames` includes every atomic name (used by prompt 25's catalog upsert)
- [ ] `go build ./internal/api/...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/api/...
Select-String -Path internal\api\telemetry_handler.go -Pattern 'bucketAtomics'
```

## Out of Scope

- Don't apply transformers here (prompt 23)
- Don't write to DB here (prompts 23–26)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/api/telemetry_handler.go
git commit -m "telemetry(db-refactor): bucket atomics by hot table + cold residue

Returns HotByTable map, Cold slice, AllNames. Compound parents that
escape Flatten are routed cold (defensive — should never happen).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 6 prompts 02 (LookupHot), 21
