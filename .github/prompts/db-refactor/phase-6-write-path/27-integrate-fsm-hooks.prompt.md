---
description: "Phase 6 — Re-wire FSM trackStateTransition / commitStateTransition to fire from new bucket step"
---

# 🔵 Write-Path 27 — Integrate FSM Hooks

> **Severity:** Critical (regression risk) | **Priority:** Critical | **Prompt #:** 27 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/api/telemetry_handler.go` (edit) |
| Depends on | `26-extract-fan-out-bulk-writes` |
| Blocks | `28-extract-error-aggregation` |
| ADR refs | ADR-002 |

## Single Goal

Re-wire the existing connection-FSM hook (`connFSMs[veh.ID].ProcessSignals(...)`) to fire AFTER the bucket/transform step but BEFORE write fan-out, feeding it the typed `[]telemetry.Atomic` stream. This preserves the e516fef behavior (drives, charge sessions, automation rules) on the new pipeline.

## Recommendation

```go
// After buckets are computed and BEFORE dispatch:
h.fsmMu.Lock()
fsm, ok := h.connFSMs[veh.ID]
if !ok {
    fsm = telemetryfsm.NewConnectionFSM(veh.ID, h.eventBus)
    if h.connFSMs == nil {
        // Defensive: regression guard from commit e516fef (nil-map panic)
        h.connFSMs = map[int64]*telemetryfsm.ConnectionFSM{}
    }
    h.connFSMs[veh.ID] = fsm
}
h.fsmMu.Unlock()

// Feed FSM the same atomic stream the buckets were built from.
// The FSM's trackStateTransition / commitStateTransition logic is unchanged.
fsm.ProcessSignals(ctx, ts, atomics)
```

### Constructor invariant (verify, don't regress)

In `NewTelemetryHandler`:
```go
return &TelemetryHandler{
    // ...
    connFSMs: map[int64]*telemetryfsm.ConnectionFSM{}, // MUST be initialized (e516fef fix)
    fsmMu:    sync.Mutex{},
}
```

## Acceptance Criteria

- [ ] `connFSMs` map initialized in constructor (regression guard)
- [ ] `ProcessSignals` called exactly once per batch with the atomic stream
- [ ] FSM lookup wrapped in `fsmMu` (concurrent batches per-vehicle are rare but possible)
- [ ] `trackStateTransition` / `commitStateTransition` source unchanged (FSM internals untouched)
- [ ] Existing FSM unit tests still pass
- [ ] `go build ./internal/api/...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/api/...
go test -race -count=1 ./internal/api/... -run TestConnectionFSM -v
Select-String -Path internal\api\telemetry_handler.go -Pattern 'ProcessSignals'
Select-String -Path internal\api\telemetry_handler.go -Pattern 'connFSMs:\s*map\['
# Expected: both ≥ 1 hit
```

## Out of Scope

- Don't refactor FSM internals (out of scope; separate ADR if needed)
- Don't move FSM call to a goroutine — order with writes matters

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/api/telemetry_handler.go
git commit -m "telemetry(db-refactor): re-wire FSM hook on new atomic stream

ProcessSignals now fires from the post-bucket / pre-dispatch step,
fed by the typed atomics slice. connFSMs map init guarded (e516fef
regression). FSM internals unchanged.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Plan checkpoint 004-diagnosing-nil-map-fsm-panic
- commit e516fef
