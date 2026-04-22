---
description: "Phase 6 — Extract the Flatten loop in ProcessBatch (per-NamedValue dispatch + accumulation)"
---

# 🔵 Write-Path 21 — Extract Flatten Loop

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 21 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/api/telemetry_handler.go` (edit) |
| Depends on | `20-extract-normalize-step` |
| Blocks | `22-extract-bucket-step` |
| ADR refs | ADR-002 |

## Single Goal

Add the post-normalize loop in `ProcessBatch` that calls `telemetry.Flatten` per named value, accumulates atomics, and `log.Warn`-and-skips on flatten errors (never abort the batch on one bad signal).

## Recommendation

```go
// In ProcessBatch, after normalize:
normalized := telemetry.NormalizeFleetUnits(decoded)

atomics := make([]telemetry.Atomic, 0, len(normalized)*2)
var flattenErrs int
for _, nv := range normalized {
    flat, err := telemetry.Flatten(nv.Name, nv.Value)
    if err != nil {
        flattenErrs++
        log.Warn().
            Err(err).
            Str("signal", nv.Name).
            Msg("flatten failed; skipping signal")
        continue
    }
    atomics = append(atomics, flat...)
}
log.Debug().
    Int("normalized", len(normalized)).
    Int("atomics", len(atomics)).
    Int("flatten_errors", flattenErrs).
    Msg("flatten step complete")
```

## Acceptance Criteria

- [ ] Loop calls `telemetry.Flatten` for every NamedValue
- [ ] Errors logged at `Warn` level with signal name + skipped (NOT returned)
- [ ] `flattenErrs` counter incremented and emitted in debug log
- [ ] Atomics accumulator pre-sized for typical 2x growth
- [ ] `go build ./internal/api/...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/api/...
Select-String -Path internal\api\telemetry_handler.go -Pattern 'telemetry\.Flatten'
# Expected: ≥ 1 hit
```

## Out of Scope

- Don't bucket by table here (prompt 22)
- Don't lookup hot routes here (prompt 22 starts that)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/api/telemetry_handler.go
git commit -m "telemetry(db-refactor): extract Flatten loop in ProcessBatch

Per-NamedValue dispatch through telemetry.Flatten with warn-and-skip
error handling. Debug log emits normalized/atomics/flatten_errors
counts.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 6 prompts 10–19
