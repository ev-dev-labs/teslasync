---
description: "Phase 6 — Implement LookupHot(name) and the empty HotCatalog map skeleton"
---

# 🔵 Write-Path 02 — `LookupHot` Function

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 2 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/hot_catalog.go` (extend) |
| Depends on | `01-define-hot-catalog-types` |
| Blocks | `03-populate-hot-catalog-vehicle-live-state` |
| ADR refs | ADR-002 |

## Single Goal

Add the empty `HotCatalog` map and the `LookupHot(name string) *HotRoute` accessor to the same file. No entries yet — population is prompts 03–08.

## Recommendation

```go
// HotCatalog is the static routing table. Keys are Tesla signal names exactly
// as Fleet Telemetry emits them. Populated by per-table init blocks in
// hot_catalog_*.go files (prompts 03-08).
var HotCatalog = map[string]HotRoute{}

// LookupHot returns the routing entry, or nil if the signal is cold
// (i.e., should land in signal_observations).
func LookupHot(name string) *HotRoute {
    if h, ok := HotCatalog[name]; ok {
        return &h
    }
    return nil
}
```

## Acceptance Criteria

- [ ] `HotCatalog` declared as `map[string]HotRoute{}` (empty initializer)
- [ ] `LookupHot` returns `*HotRoute` (nil for unknown)
- [ ] `go build ./internal/telemetry/...` exits 0
- [ ] Trivial test: `LookupHot("does-not-exist")` returns nil
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/telemetry/...
go test -count=1 ./internal/telemetry/... -run TestLookupHotNil
```

## Out of Scope

- Don't populate the map (prompts 03–08)
- Don't add transformers (prompts 03–08 add them inline with their entries)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/hot_catalog.go internal/telemetry/hot_catalog_test.go
git commit -m "telemetry(db-refactor): add LookupHot + empty HotCatalog map

Map skeleton + accessor. Per-table population follows in prompts 03-08.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 6 prompt 01
