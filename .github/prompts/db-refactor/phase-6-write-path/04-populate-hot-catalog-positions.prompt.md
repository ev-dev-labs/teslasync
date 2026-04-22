---
description: "Phase 6 — Populate HotCatalog entries for positions typed columns"
---

# 🔵 Write-Path 04 — Populate `positions` Routes

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 4 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/hot_catalog_positions.go` (new) |
| Depends on | `03-populate-hot-catalog-vehicle-live-state` |
| Blocks | `05-populate-hot-catalog-climate` |
| ADR refs | ADR-002 |

## Single Goal

Register Tesla signal routes that land in the `positions` hypertable: latitude, longitude, speed, heading, altitude. Note `Location` is a compound (handled via Flatten in prompt 13) but we still register it here so the bucketer recognizes its target table.

## Recommendation

```go
package telemetry

func init() {
    add := func(r HotRoute) { HotCatalog[r.Name] = r }

    add(HotRoute{Name: "Location",  Table: "positions", Column: "",            Kind: KindCompoundLocation})
    add(HotRoute{Name: "Latitude",  Table: "positions", Column: "latitude",    Kind: KindNumeric})
    add(HotRoute{Name: "Longitude", Table: "positions", Column: "longitude",   Kind: KindNumeric})
    add(HotRoute{Name: "VehicleSpeed", Table: "positions", Column: "speed_mps", Kind: KindNumeric, Transformer: ConvertMphToMps})
    add(HotRoute{Name: "Speed",        Table: "positions", Column: "speed_mps", Kind: KindNumeric, Transformer: ConvertMphToMps}) // alias when emitted in position context
    add(HotRoute{Name: "Heading",   Table: "positions", Column: "heading_deg", Kind: KindNumeric})
    add(HotRoute{Name: "Elevation", Table: "positions", Column: "altitude_m",  Kind: KindNumeric})
    add(HotRoute{Name: "Altitude",  Table: "positions", Column: "altitude_m",  Kind: KindNumeric}) // alias
}
```

## Acceptance Criteria

- [ ] All typed columns on `positions` covered
- [ ] `Location` registered as `KindCompoundLocation` with empty `Column`
- [ ] `go build ./internal/telemetry/...` exits 0
- [ ] Smoke: `LookupHot("Latitude").Column == "latitude"`
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/telemetry/...
Select-String -Path internal\telemetry\hot_catalog_positions.go -Pattern 'Table:\s*"positions"' | Measure-Object | ForEach-Object { "positions entries: $($_.Count)" }
```

## Out of Scope

- Don't implement Flatten for Location here (prompt 13)
- Don't populate other tables

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/hot_catalog_positions.go
git commit -m "telemetry(db-refactor): populate positions hot routes

Latitude/Longitude/Speed/Heading/Altitude. Location compound is
registered as KindCompoundLocation (Flatten handles expansion in
prompt 13).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 3 schema for `positions`
