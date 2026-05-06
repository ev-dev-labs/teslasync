---
description: "Phase 42a - signal_log writer (durable history hypertable + also_signal_log dual-write)"
---

# Prompt 0021 — `router/writers/signal_log_writer.go`

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42a-0021-router-writers-signal-log.log` |
| Depends on | `phase-42a-0010-router-writers-snapshot-base.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/tesla/router/writers/signal_log_writer.go`, `internal/tesla/router/writers/signal_log_writer_test.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

`signal_log` is THE durable per-atomic history (TimescaleDB hypertable,
mig 000186). 144 routes (~50% of all routes) target it directly, plus
EVERY routed atomic with `also_signal_log: true` in routing.yaml is
ADDITIONALLY written here regardless of its primary destination. This
writer is the highest-throughput writer in the system.

Table schema:
```
signal_log(vehicle_id BIGINT, ts TIMESTAMPTZ, field TEXT,
  value_kind SMALLINT, str_value TEXT, bool_value BOOLEAN,
  int_value BIGINT, float_value DOUBLE PRECISION, ...)
```

`value_kind` is a discriminator: 1=string, 2=bool, 3=int, 4=float
(verify exact values in mig 000186). The writer switches on the typed
SIValue and binds the matching column.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | File | `signal_log_writer.go`, `NewSignalLogWriter(pool) router.Writer` |
| 2 | NOT composing snapshotWriter | The polymorphic value column (str/bool/int/float) doesn't fit the snapshot helper's single-column-per-write model. Bespoke INSERT. |
| 3 | INSERT shape | `INSERT INTO signal_log (vehicle_id, ts, field, value_kind, <typed_col>) VALUES ($1, $2, $3, $4, $5)`. value_kind set per type via constants from mig 000186. ON CONFLICT clause: per the migration's actual PK/UQ constraint — verify in AUDIT_EVIDENCE. If hypertable + composite PK on (vehicle_id, ts, field), use ON CONFLICT DO UPDATE; if no UQ, use INSERT (idempotency relies on the producer's deduplication). |
| 4 | also_signal_log dual-write | This writer handles BOTH `dest: signal_log` (primary) AND `also_signal_log: true` (dual-write from another dest). The router itself orchestrates the dual-write — see prompt 0050 cutover for how router.Route is augmented to invoke this writer in addition to the primary writer when `also_signal_log: true`. |
| 5 | Type discrimination | Switch on `atomic.SIValue.(type)` for float64, int64, bool, string. Compound types (Location, DoorState, etc.) are NOT routed to signal_log directly — flattened atomics are. If an unexpected compound arrives, return error (defence in depth). |
| 6 | Tests | Per-kind positives (4) + unknown-type error + correct value_kind discriminator per kind |

## Action Steps

1. `git status` clean.
2. Predecessor 0010 DONE.
3. `=== AUDIT_EVIDENCE ===` dump:
   - 144 `dest: signal_log` routes count + sample (first 10).
   - All `also_signal_log: true` routes.
   - Full mig 000186 schema including value_kind constants and any UQ/PK constraint.
4. Implement per Decisions.
5. Tests.
6. Gate.
7. Commit `feat(tesla/router): add signal_log writer (signal_log + dual-write)`.
8. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If mig 000186's value_kind discriminator does NOT use the {1,2,3,4}
mapping assumed here, use whatever the migration declares verbatim. Do
NOT add a new value_kind. If the discriminator is missing entirely (e.g.
separate per-type tables), BLOCK and surface — that's a different writer
shape.
