---
description: "Phase 42a - location writer (location_snapshots, geocoded)"
---

# Prompt 0017 — `router/writers/location_writer.go`

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42a-0017-router-writers-location.log` |
| Depends on | `phase-42a-0010-router-writers-snapshot-base.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/tesla/router/writers/location_writer.go`, `internal/tesla/router/writers/location_writer_test.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

`location_snapshot` is sparse — geocoded reverse-lookup data attached to
positions. Table (mig 000183):

```
location_snapshots(vehicle_id, ts, place TEXT, country TEXT, region TEXT,
  geocoded_at TIMESTAMPTZ, ...)
```

Geocoding is async — most position rows have no location_snapshot.
This writer persists what it gets; the geocoding worker is separate.

## VIN RESOLUTION CONTRACT (inherited from 0010, commit a53135018)

`codec.Atomic.VehicleID` is the **Payload-level VIN string**, NOT the numeric `vehicles.id`. This writer composes `snapshotWriter` so it INHERITS the VIN-lookup INSERT pattern for free. No additional handling.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | File | `location_writer.go`, `NewLocationWriter(pool) router.Writer` |
| 2 | Composition | `snapshotWriter` with `table = "location_snapshots"` |
| 3 | Map source | `routing.yaml` `dest: location_snapshot`. May be empty if no location fields are routed today (geocoder writes via its own path); if so, the writer is authored anyway so the router constructor doesn't fail with "no writer for destination location_snapshot" if a future routing entry is added. |
| 4 | Reflective coverage test | Walks routing.yaml. If 0 routes, test asserts the empty case is acceptable and the writer constructor returns successfully. |
| 5 | Tests | Coverage + (if any routes) per-kind positive + unknown-field |

## Action Steps

Pattern from 0012, with awareness that this destination may have 0 routes today:

1. `git status` clean.
2. Predecessor 0010 DONE.
3. `=== AUDIT_EVIDENCE ===` dumps routes (may be 0) + table columns.
4. Implement; if 0 routes today, the columnFor map is empty `{}` — writer still satisfies `router.Writer` interface and returns an error for any field call.
5. Test empty + non-empty paths.
6. Gate (build/vet/test/git status).
7. Commit `feat(tesla/router): add location writer (location_snapshots)`.
8. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If `routing.yaml` references `dest: location_snapshot` for fields whose
columns do not exist in `location_snapshots`: BLOCK.
