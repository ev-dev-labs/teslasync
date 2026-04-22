---
description: "Phase 6 — Table-driven test fixtures for flattenTime"
---

# 🔵 Write-Path 17 — Test `flattenTime`

> **Severity:** Quality gate | **Priority:** High | **Prompt #:** 17 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/flatten_time_test.go` (new) |
| Depends on | `16-flatten-test-fixtures-typedoors` |
| Blocks | `18-flatten-test-fixtures-typelocation` |
| ADR refs | ADR-002 |

## Single Goal

Cover `flattenTime` edge cases: midnight, noon, single-digit pad, JSON `float64` numbers (default decoder), out-of-range, missing field, wrong top-level type, both Scheduled* names.

## Recommendation

```go
package telemetry

import "testing"

func TestFlattenTime(t *testing.T) {
    cases := []struct {
        name    string
        in      any
        signal  string
        want    string
        wantErr bool
    }{
        {"midnight",   map[string]any{"Hour": 0.0,  "Minute": 0.0,  "Second": 0.0},  "ScheduledChargingStartTime", "00:00:00", false},
        {"noon",       map[string]any{"Hour": 12.0, "Minute": 0.0,  "Second": 0.0},  "ScheduledChargingStartTime", "12:00:00", false},
        {"pad single", map[string]any{"Hour": 7.0,  "Minute": 5.0,  "Second": 9.0},  "ScheduledChargingStartTime", "07:05:09", false},
        {"int types",  map[string]any{"Hour": 22,   "Minute": 30,   "Second": 0},    "ScheduledDepartureTime",     "22:30:00", false},
        {"string nums",map[string]any{"Hour": "5",  "Minute": "5",  "Second": "5"},  "ScheduledChargingStartTime", "05:05:05", false},
        {"hour OOB",   map[string]any{"Hour": 25.0, "Minute": 0.0,  "Second": 0.0},  "ScheduledChargingStartTime", "",         true},
        {"minute OOB", map[string]any{"Hour": 1.0,  "Minute": 60.0, "Second": 0.0},  "ScheduledChargingStartTime", "",         true},
        {"missing min",map[string]any{"Hour": 1.0,                   "Second": 0.0}, "ScheduledChargingStartTime", "",         true},
        {"wrong top",  "22:30:00",                                                   "ScheduledChargingStartTime", "",         true},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got, err := flattenTime(tc.signal, tc.in)
            if (err != nil) != tc.wantErr {
                t.Fatalf("err = %v, wantErr %v", err, tc.wantErr)
            }
            if tc.wantErr {
                return
            }
            if len(got) != 1 || got[0].Name != tc.signal || got[0].Value.(string) != tc.want {
                t.Errorf("got %v, want one atomic %s=%s", got, tc.signal, tc.want)
            }
        })
    }
}
```

## Acceptance Criteria

- [ ] At least 8 test cases incl. midnight, noon, padding, both signal names
- [ ] OOB (hour, minute, second) cases all error
- [ ] Numeric tolerance covered (float64, int, string)
- [ ] `go test -count=1 ./internal/telemetry/... -run TestFlattenTime` passes
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go test -race -count=1 ./internal/telemetry/... -run TestFlattenTime -v
```

## Out of Scope

- Don't test downstream column INSERT (integration-test territory, prompt 32)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/flatten_time_test.go
git commit -m "telemetry(db-refactor): table-driven tests for flattenTime

9 cases incl. midnight/noon/padding/OOB/missing-field/wrong-top-type.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 6 prompt 12
