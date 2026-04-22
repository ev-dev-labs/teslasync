---
description: "Phase 6 — Replay captured Fleet Telemetry batches against the new pipeline; verify zero jsonb writes, expected hot/cold split"
---

# 🔴 Write-Path 04 — Replay Integration Test

> **Severity:** Merge-gate | **Priority:** Critical | **Prompt #:** 4 of 4

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output | Test fixtures + integration test + run-log |
| Depends on | `01`, `02`, `03` |
| Blocks | Phase 7 (frontend) |
| ADR refs | ADR-002 |
| Estimated effort | small-medium (~half day) |

## Single Goal

Capture (or use existing) Fleet Telemetry batch payloads, replay them through `ProcessBatch` against a fresh DB at migration 142, and assert: zero jsonb writes, expected row counts in hot tables, expected `signal_observations` count, expected new entries in `signal_catalog`, FSM transitions fire as expected.

## What's Being Established

Unit tests in prompts 01-03 covered components in isolation. This is the first end-to-end test of the new pipeline against real-shape input. If this passes, the write path is ready for staging.

## Recommendation

### Test fixture

```
internal/api/testdata/telemetry_batches/
  001_park_charge_complete.json          # vehicle parked, charge state ChargingComplete
  002_drive_start_to_park.json           # full drive: D->R->P
  003_compound_doorstate_open.json       # exercises Flatten(DoorState, ...)
  004_compound_location.json             # Flatten(Location, ...)
  005_unknown_signals.json               # 5 signals NOT in HotSignalCatalog -> cold
  006_mixed_500_signals.json             # large batch
  007_partial_payload.json               # missing optional fields
```

Each file is a serialized `FleetTelemetryBatch` Go-decodable JSON (capture from staging or hand-craft).

### Integration test

```go
// internal/api/telemetry_handler_integration_test.go
//go:build integration

func TestTelemetryReplay(t *testing.T) {
    db := setupFreshDB(t)               // applies all migrations through 142
    h := buildHandler(t, db)            // wires real repos, mock MQTT/FSM if needed

    cases := []struct {
        name             string
        fixture          string
        wantPositionRows int
        wantClimateRows  int
        wantColdRows     int
        wantNewCatalog   int
        wantFSMState     string
    }{
        {"park-charge-complete", "001_park_charge_complete.json", 0, 1, 3, 8, "PARKED_CHARGING"},
        {"compound-doors",       "003_compound_doorstate_open.json", 0, 0, 0, 6, ""},
        // ...
    }

    for _, c := range cases {
        t.Run(c.name, func(t *testing.T) {
            batch := loadBatch(t, c.fixture)
            require.NoError(t, h.ProcessBatch(ctx, batch))

            // Counts
            require.Equal(t, c.wantPositionRows, dbCount(t, db, "positions"))
            require.Equal(t, c.wantClimateRows,  dbCount(t, db, "climate_snapshots"))
            require.Equal(t, c.wantColdRows,     dbCount(t, db, "signal_observations"))
            require.Equal(t, c.wantNewCatalog,   dbCount(t, db, "signal_catalog"))

            // Zero jsonb invariant (no row inserted via signals jsonb anywhere)
            require.Equal(t, 0, dbScalar(t, db,
                "SELECT count(*) FROM information_schema.columns WHERE column_name='signals' AND table_schema='public'"))
        })
    }
}
```

### Replay script (manual execution path)

```powershell
cd D:\repos\teslasync
go test -tags integration -race -count=1 ./internal/api/... -run TestTelemetryReplay -v
```

## Suggested Fix

1. Capture 5-7 representative Fleet Telemetry payloads from staging (via debug logging or `tcpdump` against the FT server)
2. Write the integration test
3. Run; expect failures the first time — fix forward (catalog gaps, transformer bugs, repo wiring)
4. Once green, commit fixtures + test
5. Add a CI lane that runs integration tests against an ephemeral PG (the existing CI already starts ts-ha; use that)

## Acceptance Criteria

- [ ] At least 5 fixture batches under `internal/api/testdata/telemetry_batches/`
- [ ] Each fixture has assertion expectations (row counts, catalog count, FSM state where applicable)
- [ ] `go test -tags integration` passes with race detector enabled
- [ ] Information_schema check confirms zero `signals` columns in any table
- [ ] Catalog grows by the expected new-name count per batch
- [ ] FSM transitions match expectations (regression-coverage for the e516fef bug)
- [ ] Test runs in CI (workflow updated if needed)
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go test -tags integration -race -count=1 ./internal/api/... -run TestTelemetryReplay -v 2>&1 |
  Tee-Object -FilePath ".github\prompts\db-refactor\logs\phase-6-replay-$(Get-Date -Format yyyyMMdd-HHmmss).log"
```

## Out of Scope

- Don't load-test here (Phase 10 staging soak does that with real volume)
- Don't fixture every Tesla model (Y/3/S/X) — pick a representative few
- Don't compare query plans against legacy (Phase 10)
- Don't add fixtures for the FSM unit tests directly — those use synthetic signals already

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/api/testdata/telemetry_batches/ internal/api/telemetry_handler_integration_test.go .github/workflows/
git add -f .github/prompts/db-refactor/logs/phase-6-replay-*.log
git commit -m "test(db-refactor): replay integration test for hot/cold telemetry path

5+ captured Fleet Telemetry batches replayed against fresh DB at
migration 142. Asserts zero signals-jsonb columns, expected hot row
counts per snapshot table, expected cold count in signal_observations,
catalog growth, and FSM state transitions. CI integration lane wired.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-002
- All Phase 6 prompts 01-03
- Plan checkpoint 004 (FSM nil-map regression)
