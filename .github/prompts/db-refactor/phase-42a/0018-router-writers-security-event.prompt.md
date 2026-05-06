---
description: "Phase 42a - security event writer (security_events)"
---

# Prompt 0018 — `router/writers/security_event_writer.go`

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42a-0018-router-writers-security-event.log` |
| Depends on | `phase-42a-0010-router-writers-snapshot-base.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/tesla/router/writers/security_event_writer.go`, `internal/tesla/router/writers/security_event_writer_test.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

`security_event` is an EVENT table, not a snapshot — each row is a state
transition (e.g., `Disarmed → Armed`). Table (mig 000183):

```
security_events(vehicle_id BIGINT, ts TIMESTAMPTZ, event_type TEXT,
  from_state TEXT, to_state TEXT, details JSONB, ...)
```

Routing.yaml has 3 routes (sentry mode + alarm-related fields). Unlike
the upsert-on-(vehicle_id, ts) pattern, security_events INSERTs one new
row per event — there is no logical "same event at same ts" to upsert
against. The writer cannot use `snapshotWriter` directly.

## VIN RESOLUTION CONTRACT (inherited from 0010, commit a53135018)

`codec.Atomic.VehicleID` is the **Payload-level VIN string**, NOT the
numeric `vehicles.id`. `security_events` (mig 000183) uses
`vehicle_id BIGINT NOT NULL`. The bespoke INSERT in this prompt MUST
resolve VIN→numeric id INSIDE the INSERT via `vehicles.vin` (UNIQUE):

```sql
INSERT INTO security_events (vehicle_id, ts, event_type, to_state, details)
SELECT v.id, $2, $3, $4, $5 FROM vehicles v WHERE v.vin = $1
WHERE NOT EXISTS (
  SELECT 1 FROM security_events
  WHERE vehicle_id = (SELECT id FROM vehicles WHERE vin = $1)
    AND ts = $2 AND event_type = $3
)
```

Or, simpler, use a CTE: `WITH v AS (SELECT id FROM vehicles WHERE vin=$1)`
then INSERT ... SELECT from v + NOT EXISTS check. `tag.RowsAffected()==0`
covers BOTH unknown VIN AND duplicate event — the writer log message
should distinguish them via a follow-up SELECT only on the slow-path,
not per-write.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | File | `security_event_writer.go`, `NewSecurityEventWriter(pool) router.Writer` |
| 2 | Bespoke implementation | NOT composing `snapshotWriter`. Direct VIN-resolving INSERT per VIN RESOLUTION CONTRACT above. No `ON CONFLICT` clause. |
| 3 | Idempotency strategy | Per ADR-004 #8 the writer must be idempotent on (vehicle_id, ts, field). For event tables this means: the writer queries `EXISTS (SELECT 1 FROM security_events WHERE vehicle_id=$1 AND ts=$2 AND event_type=$3)` BEFORE the insert, and skips if present. Two-statement transaction. Alternative considered + rejected: a `UNIQUE(vehicle_id, ts, event_type)` index would be cleaner but requires a migration; defer that to a follow-up if double-writes are observed in production. |
| 4 | Field→event_type mapping | `routing.yaml` declares `column: event_type` for these routes; the atomic's `Field` becomes `event_type`. The atomic's `SIValue` (likely an enum string like "Armed", "Disarmed") becomes `to_state`. `from_state` is NOT computable from a single atomic — leave NULL; downstream consumers reconstruct transitions from the ordered series. |
| 5 | Tests | Per-route insert + idempotency (re-insert same row → no duplicate) + unknown-field error |

## Action Steps

1. `git status` clean.
2. Predecessor 0010 DONE.
3. `=== AUDIT_EVIDENCE ===` dump 3 routes + full security_events column list.
4. Implement per Decisions #1-#4.
5. Tests per Decision #5.
6. Gate (build/vet/test/git status).
7. Commit `feat(tesla/router): add security event writer (security_events)`.
8. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If a routed `column:` is not `event_type` (i.e., the routing entry
expects a different shape), BLOCK and surface — the writer's design
assumes event_type as the routing target.
