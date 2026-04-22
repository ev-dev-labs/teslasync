---
description: "Phase 6 — Audit SSE EventHub payloads; rewrite raw_state/raw_json/signals payloads to typed payloads"
---

# 🔵 Write-Path 30 — SSE Payload Audit

> **Severity:** Quality gate | **Priority:** High | **Prompt #:** 30 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `internal/api/sse/eventhub.go`, telemetry_handler push points |
| Depends on | `29-cache-invalidation-audit` |
| Blocks | `31-build-and-vet` |
| ADR refs | ADR-002 |

## Single Goal

Find every SSE/EventHub publish that emits `raw_state`, `raw_json`, `signals` (jsonb), or any other now-removed JSONB shape. Rewrite to push typed payloads keyed by table, matching the new write-path's hot-row structures.

## Recommendation

### Audit

```powershell
cd D:\repos\teslasync

# Find EventHub publish sites
Select-String -Path internal\api\sse\*.go,internal\api\telemetry_handler.go -Pattern '(eventhub|hub|sse)\.(Publish|Broadcast|Push|Emit)' -Context 0,3

# Find payloads still referencing legacy shapes
Select-String -Path internal\api\sse\*.go,internal\api\telemetry_handler.go -Pattern '"raw_state"|"raw_json"|"signals"|signalsJSON'
# Expected: 0 hits after this prompt
```

### Replacement publish

After the dispatch step in `ProcessBatch`:

```go
// Build typed SSE payload from the hot rows we just wrote.
ssePayload := map[string]any{
    "vehicle_id": veh.ID,
    "ts":         ts,
    "tables":     map[string]map[string]any{},
}
for table, row := range hotRows {
    if len(row) == 0 {
        continue
    }
    ssePayload["tables"].(map[string]map[string]any)[table] = row
}
if len(coldObs) > 0 {
    cold := make([]map[string]any, 0, len(coldObs))
    for _, o := range coldObs {
        cold = append(cold, map[string]any{
            "name":      o.SignalName,
            "value":     pickValue(o), // returns whichever value_* is non-nil
        })
    }
    ssePayload["cold"] = cold
}

h.eventHub.Publish(fmt.Sprintf("vehicle:%d", veh.ID), ssePayload)
```

`pickValue` helper:
```go
func pickValue(o models.SignalObservation) any {
    switch {
    case o.ValueNumeric != nil: return *o.ValueNumeric
    case o.ValueText    != nil: return *o.ValueText
    case o.ValueBool    != nil: return *o.ValueBool
    default: return nil
    }
}
```

### Frontend impact

Note: Phase 7 frontend agent will update SSE consumers to read from `tables.<name>.<column>` instead of `raw_state.<field>`. This prompt establishes the wire format; frontend follows.

## Acceptance Criteria

- [ ] Zero references to `raw_state`, `raw_json`, `signals`, `signalsJSON` in SSE/handler files
- [ ] New SSE payload shape: `{vehicle_id, ts, tables:{<table>:{<col>:<val>}}, cold:[{name,value}]}`
- [ ] EventHub publish call uses the new payload
- [ ] `pickValue` helper covers all 3 value_* columns
- [ ] `go build ./internal/api/...` exits 0
- [ ] Committed (frontend SSE-consumer rewrite is Phase 7's responsibility — note in commit body)

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/api/...

Select-String -Path internal\api\sse\*.go,internal\api\telemetry_handler.go -Pattern '"raw_state"|"raw_json"|"signals"|signalsJSON'
# Expected: 0 hits
```

## Out of Scope

- Don't touch frontend SSE consumers (Phase 7 owns)
- Don't change EventHub topic naming convention (`vehicle:<id>` stays)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/api/sse/eventhub.go internal/api/telemetry_handler.go
git commit -m "telemetry(db-refactor): SSE payloads switched to typed-tables shape

Eliminates raw_state/raw_json/signals legacy fields. New shape:
{vehicle_id, ts, tables:{<table>:{<col>:<val>}}, cold:[...]}. Frontend
SSE-consumer update is Phase 7 responsibility.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `internal/api/sse/eventhub.go`
- ADR-002
