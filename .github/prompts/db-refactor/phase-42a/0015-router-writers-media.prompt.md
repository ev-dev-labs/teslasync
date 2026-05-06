---
description: "Phase 42a - media writer (media_snapshots)"
---

# Prompt 0015 — `router/writers/media_writer.go`

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42a-0015-router-writers-media.log` |
| Depends on | `phase-42a-0010-router-writers-snapshot-base.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/tesla/router/writers/media_writer.go`, `internal/tesla/router/writers/media_writer_test.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

`media_snapshot` covers 11 routes for currently-playing audio: track,
artist, album, station, source, play_status, volume, etc. Table (mig 000183):

```
media_snapshots(vehicle_id, ts, track_name TEXT, artist TEXT, album TEXT,
  station TEXT, source TEXT, play_status TEXT, ...)
```

Mostly TEXT columns. No SI conversion (unit_history irrelevant).

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | File | `media_writer.go`, `NewMediaWriter(pool) router.Writer` |
| 2 | Composition | `snapshotWriter` with `table = "media_snapshots"` |
| 3 | Map source | `routing.yaml` `dest: media_snapshot` |
| 4 | Reflective coverage test | Walks routing.yaml |
| 5 | Tests | Coverage + 2 positive text + unknown-field |

## Action Steps

Identical to 0012, swapping in `media_snapshot`/`media_snapshots`.

Commit: `feat(tesla/router): add media writer (media_snapshots, 11 fields)`.

## Escape hatch

If routed column missing from table: BLOCK.
