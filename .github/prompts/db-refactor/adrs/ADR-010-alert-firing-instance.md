# ADR-010 — Alert Firing-Instance Shape

**Status:** Proposed (self-approved by agent per Phase 5b prompt 00 delegation)
**Date:** 2026-04-23
**Phase:** 5b — Post-baseline consumer cleanup
**Related ADRs:** ADR-001 (typed-by-default), ADR-005 (no JSONB carve-outs)

## Context

During the squash to `000142_baseline_typed`, the `alerts` table was **not**
recreated. Migration 142 contains:

- `alert_rules` (line 1107) — the rule definitions, fully typed
  (`op`, `value_num/text/bool/min/max`, `severity`, `cooldown_min`).
- `notifications` (line 1234) — an append-only delivery log with columns
  `id, ts, vehicle_id, rule_id, channel_id, severity, title, body,
  delivery_status, delivered_at, error_message, attempts`.
- `notification_cooldowns` (line 1257) — per-rule fire dedupe.

There is **no `alerts` table** anywhere in the active migration set
(the legacy `000002_alerts_commands_energy.up.sql` lives only in
`migrations/archive/` and is not applied).

However, `internal/models/alert.go` defines only `AlertRule` (typed). The
type `models.Alert` does **not** exist. Four call sites still reference it,
and three sites still reference removed `AlertRule` fields
(`.Type`, `.Threshold`, `.Conditions`):

```
internal/database/alert_repo.go:21   func (r *AlertRepo) Create(ctx, *models.Alert)
internal/database/alert_repo.go:28   func (r *AlertRepo) GetAll(...) ([]*models.Alert, ...)
internal/database/alert_repo.go:37   var alerts []*models.Alert
internal/database/alert_repo.go:39   a := &models.Alert{}
internal/api/alert_handler.go:45     alerts = []*models.Alert{}
internal/api/alert_handler.go:267    alert := &models.Alert{...}
internal/api/telemetry_alerts.go:207 alert := &models.Alert{ Type: rule.Type, ... }
internal/api/telemetry_alerts.go:147 evaluateLegacy(rule *models.AlertRule, ...)  // uses rule.Type
internal/api/telemetry_alerts.go:184 fireAlert(...)                                // calls alertRepo.Create
```

The codebase is therefore in a state where:

1. The schema treats a "fired alert" as a row in `notifications`.
2. The Go code treats a "fired alert" as a separate `models.Alert` value
   that would be persisted to a non-existent `alerts` table.

This must be reconciled before the build can compile.

## Decision Options

### Option A — Recreate `models.Alert` and add an `alerts` table

Define a typed struct:

```go
type Alert struct {
    ID          int64
    AlertRuleID int64
    VehicleID   *int64
    FiredAt     time.Time
    Severity    string  // info | warn | critical
    Title       string
    Message     string
    ValueNum    *float64
    AckedAt     *time.Time
    AckedBy     *string
}
```

Backed by a new migration (Phase 3b follow-up):

```sql
CREATE TABLE alerts (
  id            bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  alert_rule_id bigint NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  vehicle_id    bigint REFERENCES vehicles(id) ON DELETE SET NULL,
  fired_at      timestamptz NOT NULL DEFAULT now(),
  severity      text NOT NULL CHECK (severity IN ('info','warn','critical')),
  title         text NOT NULL,
  message       text NOT NULL,
  value_num     double precision,
  acked_at      timestamptz,
  acked_by      text
);
```

**Pros:**
- Preserves the current Go code shape (`alertRepo.Create(alert)`) with
  minimal call-site churn.
- Keeps "fired alert" semantically distinct from "delivered notification"
  (e.g., an alert can fire even if all channels fail / are in quiet hours).
- Acknowledgement state (`acked_at`, `acked_by`) is naturally a property
  of the alert, not of any one notification delivery.

**Cons:**
- Duplicates almost every column of `notifications` (rule_id, vehicle_id,
  severity, title, body/message, ts/fired_at). Violates DRY at the schema
  layer.
- Requires a new migration (000158+) — extends the scope of Phase 5b into
  Phase 3b territory.
- The current code already calls `dispatchNotifications` immediately after
  `alertRepo.Create`; the two writes are always paired, suggesting they
  should be one row.
- Two separate cooldown mechanisms emerge: rule-level (`cooldown_min`,
  `notification_cooldowns`) vs. potential alert-level dedupe. Confusing.

### Option B — Drop `models.Alert`; alerts ARE rows in `notifications`

Remove the `models.Alert` type entirely. Rewrite `internal/database/alert_repo.go`
so the `AlertRepo` half (Create/GetAll for fired alerts) is replaced by
queries against `notifications`. The existing `Notification` model
(or a new `FiredAlert` view-model that wraps a notification row) covers
the read path.

For the write path: `telemetry_alerts.fireAlert` already calls
`dispatchNotifications` immediately after creating the `Alert`. Collapse the
two: rule evaluation directly enqueues one `notifications` row per channel
(or one row per rule with `channel_id` set to a synthetic "in-app" channel
if no external channel is configured).

**Pros:**
- Aligns with the schema as it already exists in 142 — **no new migration
  needed**.
- One source of truth for alert-firing history (`notifications` + filter
  `WHERE rule_id IS NOT NULL`).
- Honors **ADR-001 (typed-by-default)** and **ADR-005 (no JSONB carve-outs)**:
  the typed schema is `notifications`, period — adding a parallel `alerts`
  table with overlapping columns would be the schema-level equivalent of a
  JSONB carve-out (a second untyped sink for the same data).
- Acknowledgement can be modelled as `delivery_status='acknowledged'` or
  by adding `acked_at/acked_by` to `notifications` in a small follow-up
  (still cheaper than a whole second table).
- Eliminates a dead Go type (`models.Alert` is referenced but undefined —
  the cheapest path to compilation is to delete the references).

**Cons:**
- Larger consumer-side refactor: `alert_handler.go` GET endpoints must be
  rewired to query `notifications` (with a `WHERE rule_id IS NOT NULL`
  filter). Frontend may need to adjust if it consumed a distinct `/alerts`
  shape — but the response shape can be kept compatible by mapping a
  `notification` row to the legacy alert JSON shape in the handler.
- "An alert fired but no channel was configured" requires a sentinel
  channel (e.g., `system_inbox`) or a nullable `channel_id`. The current
  schema has `channel_id NOT NULL`; would need to relax that OR insert
  to a system inbox channel seeded at install time. **Recommended:** seed
  a `system_inbox` channel of kind `webhook` (URL=null, disabled) in the
  same prompt that does the rewire, OR alter `notifications.channel_id`
  to nullable in a tiny follow-up migration.

## Recommendation

**Option B — Drop `models.Alert`; treat alerts as `notifications` rows.**

Rationale:

1. **ADR-005 (no JSONB carve-outs) reasoning applies here.** That ADR
   forbids parallel untyped sinks for the same conceptual data. Option A
   creates a parallel **typed** sink for the same conceptual data
   (rule_id + vehicle_id + severity + title + body + ts). The spirit of
   ADR-005 — one canonical typed home per concept — argues against it.
2. **ADR-001 (typed-by-default)** is satisfied by `notifications`; it is
   already typed end-to-end. We do not need a second typed table to
   honor ADR-001.
3. The schema has already chosen Option B by *omission* — `alerts` was
   intentionally not carried forward into `000142_baseline_typed`. The
   minimum-surprise move is to align Go with the schema, not to drag a
   new table back into the schema to match dead Go code.
4. Phase 5b is explicitly about cleaning up consumers of removed model
   surface area. Recreating the surface area would be a regression of
   the squash's intent.
5. Write-path collapse: `fireAlert` already calls `dispatchNotifications`
   immediately after `alertRepo.Create`. The two operations are never
   independent today, so collapsing them into a single insert per channel
   is a pure simplification.

Implementation lands in **Prompt 08 — Rewire `alert_repo` and call sites**.
That prompt will:
- Delete `AlertRepo.Create / GetAll` and the `models.Alert` references.
- Add `NotificationRepo.ListFiredAlerts(...)` returning notifications
  with `rule_id IS NOT NULL` mapped to the existing JSON response shape.
- Rewrite `fireAlert` to insert into `notifications` directly (one row per
  configured channel, plus a sentinel `system_inbox` row if zero channels).
- Replace `rule.Type` references with `rule.SignalName + rule.Op` (the
  typed equivalent — see Prompt 05/07 for the rule-evaluation rewrite).

If a follow-up need emerges for per-alert acknowledgement state, add
`acked_at timestamptz, acked_by text` columns to `notifications` in a small
migration (000158+) — still strictly less surface area than a whole
`alerts` table.

## Consequences

- No new migration needed for this ADR. (A future micro-migration may add
  `acked_at/acked_by` to `notifications` if/when ack UX lands.)
- `models.Alert` ceases to exist. Anyone grepping for it gets zero hits.
- API response shape for `/alerts` endpoints is preserved by mapping at
  the handler layer; frontend is unaffected.
- `notification_cooldowns` becomes the single dedupe mechanism — no
  parallel alert-level cooldown to reconcile.

<!-- OWNER APPROVAL: APPROVED-B -->
