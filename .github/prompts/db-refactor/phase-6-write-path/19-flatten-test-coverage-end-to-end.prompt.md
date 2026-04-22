---
description: "Phase 6 — End-to-end Flatten test feeding a real Fleet Telemetry sample batch"
---

# 🔵 Write-Path 19 — End-to-End Flatten Coverage

> **Severity:** Quality gate | **Priority:** High | **Prompt #:** 19 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/flatten_e2e_test.go` (new) |
| Depends on | `18-flatten-test-fixtures-typelocation` |
| Blocks | `20-extract-normalize-step` |
| ADR refs | ADR-002 |

## Single Goal

Feed a captured (or hand-crafted) Fleet Telemetry batch payload into `Flatten` for every signal name, and assert: (a) every produced atomic name is in `HotCatalog` OR `KnownColdSignals`, (b) compound expansions match expected counts, (c) no panics on Tesla-shaped inputs.

## Recommendation

```go
package telemetry

import (
    "encoding/json"
    "os"
    "testing"
)

// TestFlattenAgainstSampleBatch loads testdata/sample_batch.json (a captured
// Fleet Telemetry payload) and verifies the full flatten -> route pipeline
// produces zero unrouteable atomics.
func TestFlattenAgainstSampleBatch(t *testing.T) {
    raw, err := os.ReadFile("testdata/sample_batch.json")
    if err != nil {
        t.Skipf("no sample batch fixture (capture one in testdata/sample_batch.json): %v", err)
        return
    }
    var batch struct {
        Signals []struct {
            Name  string `json:"name"`
            Value any    `json:"value"`
        } `json:"signals"`
    }
    if err := json.Unmarshal(raw, &batch); err != nil {
        t.Fatalf("decode: %v", err)
    }

    var orphans []string
    var compoundExpansions = map[string]int{}
    for _, s := range batch.Signals {
        atomics, err := Flatten(s.Name, s.Value)
        if err != nil {
            t.Errorf("flatten %s: %v", s.Name, err)
            continue
        }
        if len(atomics) > 1 || (len(atomics) == 1 && atomics[0].Name != s.Name) {
            compoundExpansions[s.Name] = len(atomics)
        }
        for _, a := range atomics {
            if _, hot := HotCatalog[a.Name]; hot {
                continue
            }
            if _, cold := KnownColdSignals[a.Name]; cold {
                continue
            }
            orphans = append(orphans, a.Name)
        }
    }
    if len(orphans) > 0 {
        t.Errorf("orphan atomics from real batch: %v", orphans)
    }
    t.Logf("compound expansions observed: %v", compoundExpansions)
}
```

### Capture instructions for `testdata/sample_batch.json`

Capture from staging Fleet Telemetry server, OR construct synthetically:

```json
{
  "vin": "5YJ3E1EA0PF000000",
  "ts": "2026-04-22T15:30:00Z",
  "signals": [
    {"name": "BatteryLevel",    "value": 73},
    {"name": "Location",        "value": {"Latitude": 37.7749, "Longitude": -122.4194}},
    {"name": "DoorState",       "value": {"DriverFront": "Closed", "PassengerFront": "Closed", "DriverRear": "Closed", "PassengerRear": "Closed", "FrontTrunk": "Closed", "RearTrunk": "Closed"}},
    {"name": "WindowState",     "value": {"DriverFront": "Closed", "PassengerFront": "Closed", "DriverRear": "Closed", "PassengerRear": "Closed"}},
    {"name": "ShiftState",      "value": "P"},
    {"name": "ScheduledChargingStartTime", "value": {"Hour": 22, "Minute": 30, "Second": 0}},
    {"name": "InsideTemp",      "value": 21.5},
    {"name": "ChargerVoltage",  "value": 240.0}
  ]
}
```

## Acceptance Criteria

- [ ] Fixture file `internal/telemetry/testdata/sample_batch.json` committed (synthetic OK)
- [ ] Test runs end-to-end with zero orphan atomics
- [ ] At least 4 compound expansions logged (DoorState, WindowState, Location, ScheduledChargingStartTime)
- [ ] `go test -count=1 ./internal/telemetry/... -run TestFlattenAgainstSampleBatch -v` passes
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go test -race -count=1 ./internal/telemetry/... -run TestFlattenAgainstSampleBatch -v
```

## Out of Scope

- Don't write to DB here (prompt 32 does that)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/flatten_e2e_test.go internal/telemetry/testdata/sample_batch.json
git commit -m "telemetry(db-refactor): e2e Flatten test against sample batch

Loads a real-shape Fleet Telemetry payload, flattens every signal,
asserts every produced atomic routes to either HotCatalog or
KnownColdSignals. Logs compound expansion counts.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 6 prompts 09–18
