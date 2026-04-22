---
description: "Phase 6 — Table-driven test fixtures for flattenLocation (incl. null island, polar, malformed)"
---

# 🔵 Write-Path 18 — Test `flattenLocation`

> **Severity:** Quality gate | **Priority:** High | **Prompt #:** 18 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/flatten_location_test.go` (new) |
| Depends on | `17-flatten-test-fixtures-typetime` |
| Blocks | `19-flatten-test-coverage-end-to-end` |
| ADR refs | ADR-002 |

## Single Goal

Cover `flattenLocation` edge cases: null island (0,0), polar (lat=±90), antimeridian (lng=±180), out-of-range, missing field, wrong types, JSON-decoded numeric strings.

## Recommendation

```go
package telemetry

import "testing"

func TestFlattenLocation(t *testing.T) {
    cases := []struct {
        name      string
        in        any
        wantLat   float64
        wantLng   float64
        wantErr   bool
    }{
        {"typical SF", map[string]any{"Latitude": 37.7749, "Longitude": -122.4194}, 37.7749, -122.4194, false},
        {"null island",  map[string]any{"Latitude": 0.0,    "Longitude": 0.0},      0.0,     0.0,        false},
        {"north pole",   map[string]any{"Latitude": 90.0,   "Longitude": 0.0},      90.0,    0.0,        false},
        {"south pole",   map[string]any{"Latitude": -90.0,  "Longitude": 0.0},     -90.0,    0.0,        false},
        {"antimeridian E", map[string]any{"Latitude": 0.0,  "Longitude": 180.0},    0.0,     180.0,      false},
        {"antimeridian W", map[string]any{"Latitude": 0.0,  "Longitude": -180.0},   0.0,    -180.0,      false},
        {"strings",      map[string]any{"Latitude": "1.5",  "Longitude": "2.5"},    1.5,     2.5,        false},
        {"lat OOB hi",   map[string]any{"Latitude": 91.0,   "Longitude": 0.0},      0,       0,          true},
        {"lat OOB lo",   map[string]any{"Latitude": -91.0,  "Longitude": 0.0},      0,       0,          true},
        {"lng OOB hi",   map[string]any{"Latitude": 0.0,    "Longitude": 181.0},    0,       0,          true},
        {"missing lng",  map[string]any{"Latitude": 0.0},                            0,       0,          true},
        {"wrong top",    "37.7749,-122.4194",                                       0,       0,          true},
        {"wrong lat",    map[string]any{"Latitude": map[string]any{}, "Longitude": 0.0}, 0, 0, true},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got, err := flattenLocation(tc.in)
            if (err != nil) != tc.wantErr {
                t.Fatalf("err = %v, wantErr %v", err, tc.wantErr)
            }
            if tc.wantErr {
                return
            }
            if len(got) != 2 {
                t.Fatalf("got %d atomics, want 2", len(got))
            }
            if got[0].Name != "Latitude" || got[1].Name != "Longitude" {
                t.Fatalf("names = [%s,%s], want [Latitude,Longitude]", got[0].Name, got[1].Name)
            }
            if got[0].Value.(float64) != tc.wantLat || got[1].Value.(float64) != tc.wantLng {
                t.Errorf("got (%v,%v), want (%v,%v)", got[0].Value, got[1].Value, tc.wantLat, tc.wantLng)
            }
        })
    }
}
```

## Acceptance Criteria

- [ ] At least 12 cases (incl. null island, both poles, antimeridian, OOB ×3, missing field, wrong types ×2)
- [ ] Output order is always Latitude then Longitude
- [ ] `go test -count=1 ./internal/telemetry/... -run TestFlattenLocation` passes
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go test -race -count=1 ./internal/telemetry/... -run TestFlattenLocation -v
```

## Out of Scope

- Don't test geofence triggers (separate concern)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/flatten_location_test.go
git commit -m "telemetry(db-refactor): table-driven tests for flattenLocation

13 cases incl. null island, both poles, both antimeridians, OOB,
malformed.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 6 prompt 13
