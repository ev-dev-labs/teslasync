---
description: "Phase 6 — Table-driven test fixtures for flattenDoors"
---

# 🔵 Write-Path 16 — Test `flattenDoors`

> **Severity:** Quality gate | **Priority:** High | **Prompt #:** 16 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/flatten_doors_test.go` (new) |
| Depends on | `15-flatten-implement-passthrough` |
| Blocks | `17-flatten-test-fixtures-typetime` |
| ADR refs | ADR-002 |

## Single Goal

Add table-driven tests for `flattenDoors` covering: all closed, single door open, all open, partial payload (missing parts), wrong top-level type, wrong per-part type, empty map.

## Recommendation

```go
package telemetry

import (
    "testing"
)

func TestFlattenDoors(t *testing.T) {
    cases := []struct {
        name     string
        in       any
        wantLen  int
        wantOpen map[string]bool // expected name -> value
        wantErr  bool
    }{
        {
            name:    "all closed",
            in:      map[string]any{"DriverFront": "Closed", "PassengerFront": "Closed", "DriverRear": "Closed", "PassengerRear": "Closed", "FrontTrunk": "Closed", "RearTrunk": "Closed"},
            wantLen: 6,
            wantOpen: map[string]bool{
                "DoorState_DriverFront": false, "DoorState_PassengerFront": false,
                "DoorState_DriverRear": false, "DoorState_PassengerRear": false,
                "DoorState_FrontTrunk": false, "DoorState_RearTrunk": false,
            },
        },
        {
            name:     "driver open only",
            in:       map[string]any{"DriverFront": "Open", "PassengerFront": "Closed", "DriverRear": "Closed", "PassengerRear": "Closed", "FrontTrunk": "Closed", "RearTrunk": "Closed"},
            wantLen:  6,
            wantOpen: map[string]bool{"DoorState_DriverFront": true, "DoorState_PassengerFront": false, "DoorState_DriverRear": false, "DoorState_PassengerRear": false, "DoorState_FrontTrunk": false, "DoorState_RearTrunk": false},
        },
        {
            name:     "all open",
            in:       map[string]any{"DriverFront": "Open", "PassengerFront": "Open", "DriverRear": "Open", "PassengerRear": "Open", "FrontTrunk": "Open", "RearTrunk": "Open"},
            wantLen:  6,
            wantOpen: map[string]bool{"DoorState_DriverFront": true, "DoorState_PassengerFront": true, "DoorState_DriverRear": true, "DoorState_PassengerRear": true, "DoorState_FrontTrunk": true, "DoorState_RearTrunk": true},
        },
        {
            name:    "partial payload (skips absent parts)",
            in:      map[string]any{"DriverFront": "Open"},
            wantLen: 1,
            wantOpen: map[string]bool{"DoorState_DriverFront": true},
        },
        {
            name:    "empty map",
            in:      map[string]any{},
            wantLen: 0,
        },
        {
            name:    "wrong top-level type",
            in:      "Open",
            wantErr: true,
        },
        {
            name:    "wrong per-part type",
            in:      map[string]any{"DriverFront": 123},
            wantErr: true,
        },
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got, err := flattenDoors(tc.in)
            if (err != nil) != tc.wantErr {
                t.Fatalf("err = %v, wantErr %v", err, tc.wantErr)
            }
            if tc.wantErr {
                return
            }
            if len(got) != tc.wantLen {
                t.Fatalf("len = %d, want %d (%v)", len(got), tc.wantLen, got)
            }
            for _, a := range got {
                want, ok := tc.wantOpen[a.Name]
                if !ok {
                    t.Errorf("unexpected atomic %s", a.Name)
                    continue
                }
                if a.Value.(bool) != want {
                    t.Errorf("%s = %v, want %v", a.Name, a.Value, want)
                }
            }
        })
    }
}
```

## Acceptance Criteria

- [ ] At least 6 test cases (closed/single/all/partial/wrong-top/wrong-part)
- [ ] `go test -count=1 ./internal/telemetry/... -run TestFlattenDoors` passes
- [ ] Race detector clean
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go test -race -count=1 ./internal/telemetry/... -run TestFlattenDoors -v
```

## Out of Scope

- Don't add catalog cross-reference here (that's prompt 19's coverage test)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/flatten_doors_test.go
git commit -m "telemetry(db-refactor): table-driven tests for flattenDoors

7 cases covering happy paths, partial payloads, and error paths.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 6 prompt 11
