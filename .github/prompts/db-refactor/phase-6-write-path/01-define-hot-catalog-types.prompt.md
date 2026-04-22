---
description: "Phase 6 — Define HotRoute struct + Transformer signature in internal/telemetry/hot_catalog.go"
---

# 🔵 Write-Path 01 — Define Hot Catalog Types

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 1 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/hot_catalog.go` (new) |
| Depends on | `phase-5-go-models/71-mod-tidy-and-tidy-check` |
| Blocks | `02-implement-lookup-hot-fn` |
| ADR refs | ADR-002 |

## Single Goal

Create `internal/telemetry/hot_catalog.go` with ONLY the type definitions (no map population, no lookup yet). One file: `SignalKind` enum, `Transformer` func type, `HotRoute` struct.

## Recommendation

```go
package telemetry

// SignalKind classifies how a raw Fleet Telemetry value is converted before write.
type SignalKind string

const (
    KindNumeric          SignalKind = "numeric"
    KindText             SignalKind = "text"
    KindBool             SignalKind = "bool"
    KindEnumNormalized   SignalKind = "enum_normalized"
    KindCompoundDoors    SignalKind = "compound_doors"
    KindCompoundWindows  SignalKind = "compound_windows"
    KindCompoundLocation SignalKind = "compound_location"
    KindCompoundTime     SignalKind = "compound_time"
    KindCompoundShift    SignalKind = "compound_shift"
)

// Transformer converts a raw Fleet Telemetry value to the typed value
// the destination column expects. nil = pass-through.
type Transformer func(raw any) (any, error)

// HotRoute tells the telemetry handler "for signal X, write to table T column C
// using transformer F". An empty Column means the entry is a compound that must
// be Flatten()-ed first into atomic sub-signals which then re-route through the
// catalog.
type HotRoute struct {
    Name        string
    Table       string
    Column      string
    Kind        SignalKind
    Transformer Transformer
}
```

## Acceptance Criteria

- [ ] File `internal/telemetry/hot_catalog.go` exists with the types above
- [ ] `go build ./internal/telemetry/...` exits 0
- [ ] No package-level `var` or `func` declarations beyond the types
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/telemetry/...
Select-String -Path internal\telemetry\hot_catalog.go -Pattern '^type (SignalKind|Transformer|HotRoute)'
# Expected: 3 matches
```

## Out of Scope

- Don't populate the catalog map yet (prompts 03–08)
- Don't implement `LookupHot` yet (prompt 02)
- Don't add transformer implementations here

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/hot_catalog.go
git commit -m "telemetry(db-refactor): define HotRoute + Transformer types

ADR-002 routing-table primitives. Pure type declarations; no map
population or lookup logic yet (those land in prompts 02-08).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-002
