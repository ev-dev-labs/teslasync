---
description: "Phase 42a - safety writer (safety_snapshots)"
---

# Prompt 0016 — `router/writers/safety_writer.go`

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42a-0016-router-writers-safety.log` |
| Depends on | `phase-42a-0010-router-writers-snapshot-base.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/tesla/router/writers/safety_writer.go`, `internal/tesla/router/writers/safety_writer_test.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

`safety_snapshot` covers 1 route. Table (mig 000183):

```
safety_snapshots(vehicle_id, ts, service_mode BOOLEAN, service_mode_plus BOOLEAN,
  wiper_state TEXT, crash_state TEXT, ...)
```

Even with only 1 routed field today, the writer is authored to handle
the full column set so a future routing.yaml addition Just Works.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | File | `safety_writer.go`, `NewSafetyWriter(pool) router.Writer` |
| 2 | Composition | `snapshotWriter` with `table = "safety_snapshots"` |
| 3 | Map source | `routing.yaml` `dest: safety_snapshot` |
| 4 | Reflective coverage test | Walks routing.yaml |
| 5 | Tests | Coverage + the 1 routed field positive + unknown-field |

## Action Steps

Identical pattern to 0012. Commit: `feat(tesla/router): add safety writer (safety_snapshots)`.

## Escape hatch

If routed column missing from table: BLOCK.
