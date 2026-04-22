---
description: "Phase 6 — Test that every signal in enums/signal_types.go is either hot-routed or explicitly cold (no orphans)"
---

# 🔵 Write-Path 09 — Hot Catalog Coverage Test

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 9 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/hot_catalog_coverage_test.go` (new) |
| Depends on | `08-populate-hot-catalog-charging` |
| Blocks | `10-flatten-define-types` |
| ADR refs | ADR-002, ADR-009 |

## Single Goal

Add a unit test that walks every signal name declared in `internal/enums/signal_types.go` (the legacy classification source) and asserts each is either:
1. Present in `HotCatalog` (hot path), OR
2. Listed in an explicit `KnownColdSignals` set in this test (cold by design)

Any orphan = test fails. This is the regression net for "we forgot to route a new signal."

## Recommendation

```go
package telemetry

import (
    "testing"
    "github.com/ev-dev-labs/teslasync/internal/enums"
)

// KnownColdSignals are signals deliberately routed to signal_observations
// (not promoted to typed columns). Promoting one means moving it OUT of
// this set and INTO a hot_catalog_*.go file.
var KnownColdSignals = map[string]struct{}{
    "BatteryHeaterOn":          {},
    "ChargePortColdWeatherMode": {},
    "DCDCEnable":               {},
    // ... ~200 cold signals enumerated here, alphabetized
}

func TestHotCatalogCoverage(t *testing.T) {
    var orphans []string
    for _, name := range enums.AllSignalNames() {
        if _, hot := HotCatalog[name]; hot {
            continue
        }
        if _, cold := KnownColdSignals[name]; cold {
            continue
        }
        orphans = append(orphans, name)
    }
    if len(orphans) > 0 {
        t.Fatalf("orphan signals (neither hot nor explicitly cold): %v", orphans)
    }
}

func TestHotAndColdAreDisjoint(t *testing.T) {
    for name := range KnownColdSignals {
        if _, hot := HotCatalog[name]; hot {
            t.Errorf("%s is in BOTH HotCatalog and KnownColdSignals", name)
        }
    }
}
```

## Suggested Fix

1. Read `internal/enums/signal_types.go` to enumerate every defined signal name (the file likely has constant blocks or a slice — adapt accordingly; add an `AllSignalNames()` helper if missing)
2. Run the test once → it will fail with the orphan list
3. For each orphan, decide: hot (add to a `hot_catalog_*.go`) or cold (add to `KnownColdSignals`)
4. Re-run until green

## Acceptance Criteria

- [ ] `TestHotCatalogCoverage` passes (zero orphans)
- [ ] `TestHotAndColdAreDisjoint` passes
- [ ] `KnownColdSignals` is alphabetized for easy review
- [ ] `go test -count=1 ./internal/telemetry/...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go test -count=1 ./internal/telemetry/... -run TestHotCatalogCoverage -v
go test -count=1 ./internal/telemetry/... -run TestHotAndColdAreDisjoint -v
```

## Out of Scope

- Don't promote signals here without first updating their hot_catalog_*.go file
- Don't suppress orphans — the test failing is a feature

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/hot_catalog_coverage_test.go internal/enums/signal_types.go
git commit -m "telemetry(db-refactor): catalog coverage test (no orphan signals)

Asserts every signal in enums/signal_types.go is either in HotCatalog
or KnownColdSignals. Disjointness checked. Promoting a signal becomes
a single grep+edit per ADR-009.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-002, ADR-009
- `internal/enums/signal_types.go`
