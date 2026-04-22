---
description: "Phase 6 — Aggregate per-step errors; fail batch only on systemic failure"
---

# 🔵 Write-Path 28 — Error Aggregation

> **Severity:** Quality gate | **Priority:** High | **Prompt #:** 28 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/api/telemetry_handler.go` (edit) |
| Depends on | `27-integrate-fsm-hooks` |
| Blocks | `29-cache-invalidation-audit` |
| ADR refs | ADR-002 |

## Single Goal

Decide the batch outcome from the accumulated `writeErrs` and per-step counters. Per-signal warnings already logged in earlier prompts. Here: if ALL writes failed → return error (systemic — likely DB down). If SOME failed → log error per failure, return nil (partial success acceptable; cold path captures lost data on next batch). Always emit a final summary log line.

## Recommendation

```go
total := len(hotRows) + boolToInt(len(coldObs) > 0)
failed := len(writeErrs)

for _, we := range writeErrs {
    log.Error().
        Err(we.err).
        Str("table", we.table).
        Msg("telemetry write failed")
}

log.Info().
    Str("vin", batch.VIN).
    Int64("vehicle_id", veh.ID).
    Int("normalized", len(normalized)).
    Int("atomics", len(atomics)).
    Int("hot_writes", len(hotRows)).
    Int("cold_writes", len(coldObs)).
    Int("write_failures", failed).
    Dur("duration", time.Since(startedAt)).
    Msg("telemetry batch processed")

if total > 0 && failed == total {
    return fmt.Errorf("all %d write targets failed (systemic)", total)
}
return nil

// boolToInt helper — package-private
func boolToInt(b bool) int { if b { return 1 }; return 0 }
```

`startedAt` is captured at the top of `ProcessBatch`:
```go
startedAt := time.Now()
```

## Acceptance Criteria

- [ ] Final summary log line includes `vin`, `vehicle_id`, all 4 counters, `duration`
- [ ] All-failed → returns error (caller can retry whole batch)
- [ ] Partial-failed → returns nil (caller advances; failed signals lost-but-logged)
- [ ] `startedAt` captured at function entry, `duration` measured
- [ ] No `panic` paths in `ProcessBatch` body (only `recover` in MQTT subscriber, untouched)
- [ ] `go build ./internal/api/...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/api/...
Select-String -Path internal\api\telemetry_handler.go -Pattern 'telemetry batch processed'
# Expected: 1 hit
```

## Out of Scope

- Don't add Prometheus metrics here (separate metrics pass; counters already in log fields)
- Don't add per-table retry — repo layer owns transient retries

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/api/telemetry_handler.go
git commit -m "telemetry(db-refactor): aggregate write errors + summary log

Partial failures log + drop; full failure returns error so caller
retries. Summary log emits the 4 counters + duration per batch for
ops dashboards.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 6 prompts 21–27
