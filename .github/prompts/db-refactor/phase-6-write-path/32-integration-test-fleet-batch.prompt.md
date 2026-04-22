---
description: "Phase 6 — End-to-end integration test: feed sample Fleet Telemetry batch + assert typed columns / zero JSONB / catalog growth / cold rows"
---

# 🔴 Write-Path 32 — Integration Test (Fleet Batch Replay)

> **Severity:** Merge-gate | **Priority:** Critical | **Prompt #:** 32 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/api/telemetry_handler_integration_test.go` (new), fixtures, log |
| Depends on | `31-build-and-vet` |
| Blocks | `phase-7-frontend/01` (frontend kickoff) |
| ADR refs | ADR-002 |

## Single Goal

Run a real batch through `ProcessBatch` against a fresh DB at the latest migration. Assert:
1. **All expected typed columns populated** (battery, location, climate, etc.)
2. **Zero JSONB writes** (no `signals` / `raw_state` columns referenced anywhere)
3. **`signal_catalog` grew** by the expected new-name count
4. **`signal_observations` rows present** for cold signals
5. **FSM transitions fired** as expected

## Recommendation

### Test fixtures

```
internal/api/testdata/telemetry_batches/
  001_park_charge_complete.json
  002_drive_start_to_park.json
  003_compound_doorstate_open.json
  004_compound_location.json
  005_unknown_signals.json
  006_mixed_500_signals.json
  007_partial_payload.json
```

### Integration test

```go
//go:build integration

package api_test

import (
    "context"
    "encoding/json"
    "os"
    "path/filepath"
    "testing"
    // ...
)

func TestTelemetryReplay(t *testing.T) {
    db := setupFreshDB(t)            // applies all migrations
    h := buildHandler(t, db)

    cases := []struct {
        name             string
        fixture          string
        wantPositionRows int
        wantClimateRows  int
        wantColdRows     int
        wantNewCatalog   int
        wantFSMState     string
    }{
        {"park-charge-complete", "001_park_charge_complete.json", 0, 1, 3, 8,  "PARKED_CHARGING"},
        {"drive-cycle",          "002_drive_start_to_park.json",  5, 0, 2, 4,  "PARKED"},
        {"compound-doors",       "003_compound_doorstate_open.json", 0, 0, 0, 6, ""},
        {"compound-location",    "004_compound_location.json",    1, 0, 0, 2,  ""},
        {"unknown-only",         "005_unknown_signals.json",      0, 0, 5, 5,  ""},
        {"large-mixed",          "006_mixed_500_signals.json",    1, 1, 100, 50, ""},
        {"partial",              "007_partial_payload.json",      0, 0, 1, 1,  ""},
    }

    for _, c := range cases {
        t.Run(c.name, func(t *testing.T) {
            batch := loadBatch(t, filepath.Join("testdata/telemetry_batches", c.fixture))
            require.NoError(t, h.ProcessBatch(context.Background(), batch))

            require.Equal(t, c.wantPositionRows, dbCount(t, db, "positions"),  "positions")
            require.Equal(t, c.wantClimateRows,  dbCount(t, db, "climate_snapshots"), "climate")
            require.GreaterOrEqual(t, dbCount(t, db, "signal_observations"), c.wantColdRows, "cold")
            require.GreaterOrEqual(t, dbCount(t, db, "signal_catalog"),       c.wantNewCatalog, "catalog")

            // Zero JSONB invariant: no jsonb 'signals' column anywhere
            jsonbCols := dbScalar(t, db,
                `SELECT count(*) FROM information_schema.columns
                 WHERE column_name IN ('signals','raw_state','raw_json')
                   AND table_schema='public'`)
            require.Equal(t, 0, jsonbCols, "no legacy jsonb cols allowed")
        })
    }
}
```

### Run

```powershell
cd D:\repos\teslasync
$logDir = ".github\prompts\db-refactor\logs"
$ts = Get-Date -Format yyyyMMdd-HHmmss

go test -tags integration -race -count=1 ./internal/api/... -run TestTelemetryReplay -v 2>&1 |
  Tee-Object -FilePath "$logDir\phase-6-32-replay-$ts.log"
```

## Acceptance Criteria

- [ ] At least 5 fixture batches under `internal/api/testdata/telemetry_batches/`
- [ ] `go test -tags integration -race ./internal/api/...` exits 0
- [ ] Information-schema check confirms ZERO `signals` / `raw_state` / `raw_json` columns post-migration
- [ ] `signal_catalog` grew by expected per-fixture counts
- [ ] FSM state transitions match expectations (e516fef regression net)
- [ ] Test runs in CI (existing PG service container reused)
- [ ] Replay log captured under `logs/phase-6-32-replay-*.log`
- [ ] Committed

## Verification

```powershell
Get-Content (Get-ChildItem .github\prompts\db-refactor\logs\phase-6-32-replay-*.log | Select-Object -Last 1).FullName -Tail 20
```

## Out of Scope

- Don't load-test here (Phase 10 staging soak)
- Don't fixture every Tesla model — representative few suffice
- Don't compare query plans against legacy (Phase 10)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/api/testdata/telemetry_batches/ internal/api/telemetry_handler_integration_test.go
git add -f .github/prompts/db-refactor/logs/phase-6-32-replay-*.log
git commit -m "test(db-refactor): Phase 6.32 — Fleet batch replay integration test

5+ captured Fleet Telemetry batches replayed against fresh DB at
latest migration. Asserts typed columns populated, zero JSONB
columns surviving, signal_catalog growth, signal_observations cold
rows, FSM state transitions. CI integration lane wired.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-002
- All Phase 6 prompts 01–31
- Plan checkpoint 004 (FSM nil-map regression)
