---
description: "Phase 3 — Create notifications table (delivery log + cooldowns + quiet hours + digests)"
---

# 🟢 Schema 20 — `notifications` (Delivery Log + Cooldowns + Quiet Hours + Digests)

> **Severity:** Standard
> **Priority:** Medium
> **Category:** Phase 3 — Schema (4 related tables in one file — all about notification delivery)
> **Prompt #:** 21 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/20-notifications.sql` |
| Depends on | `01-create-vehicles`, `18-create-alert-rules`, `19-create-notification-channels` |
| Blocks | (none — leaf) |
| ADR refs | ADR-001 |
| Estimated effort | small (~30 min) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/20-notifications.sql` containing four related tables: `notifications` (delivery log), `notification_cooldowns` (per-rule cooldown state), `notification_quiet_hours` (per-channel scheduled mute), and `notification_digests` (digest scheduling).

## What's Being Established

These four tables are all about **delivery control** for notifications. They share dependencies (rules + channels) and lifecycles (configured by user, populated by runtime). Keeping them in one file matches operational reasoning and avoids 4 small files.

## Recommendation

- `notifications` is **append-only** (delivery log) — no `updated_at`
- The other 3 are mutable — have `updated_at` + trigger
- `notifications` carries an FK to alert_rules (NULL for non-rule notifications like manual messages)
- All FKs to channels are `RESTRICT` — deleting an in-use channel is blocked

## Output (full file contents)

```sql
-- =========================================================================
-- 20 — notifications + cooldowns + quiet hours + digests
-- All four are about notification delivery control. Grouped in one file.
-- =========================================================================

-- ============= Delivery log (append-only) =============

CREATE TABLE notifications (
  id           bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  ts           timestamptz NOT NULL DEFAULT now(),
  vehicle_id   bigint           REFERENCES vehicles(id)              ON DELETE SET NULL,
  rule_id      bigint           REFERENCES alert_rules(id)           ON DELETE SET NULL,
  channel_id   bigint  NOT NULL REFERENCES notification_channels(id) ON DELETE RESTRICT,
  severity     text    NOT NULL CHECK (severity IN ('info','warn','critical')),
  title        text    NOT NULL,
  body         text    NOT NULL,
  delivery_status text NOT NULL DEFAULT 'pending'
                       CHECK (delivery_status IN ('pending','delivered','failed','suppressed')),
  delivered_at timestamptz,
  error_message text,
  attempts     smallint NOT NULL DEFAULT 0
);
COMMENT ON TABLE notifications IS 'Append-only delivery log. No updated_at — status changes are tracked via attempts/delivery_status.';

CREATE INDEX idx_notif_ts          ON notifications (ts DESC);
CREATE INDEX idx_notif_pending     ON notifications (delivery_status, ts) WHERE delivery_status = 'pending';
CREATE INDEX idx_notif_rule_ts     ON notifications (rule_id, ts DESC) WHERE rule_id IS NOT NULL;

-- ============= Cooldowns (mutable) =============

CREATE TABLE notification_cooldowns (
  rule_id        bigint NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  vehicle_id     bigint REFERENCES vehicles(id) ON DELETE CASCADE,
  last_fired_at  timestamptz NOT NULL,
  cooldown_until timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, vehicle_id)
);
COMMENT ON TABLE notification_cooldowns IS 'Per-(rule, vehicle) cooldown state. PK includes nullable vehicle_id — TimescaleDB requires NOT NULL in PK; if vehicle_id is NULL we use an alternate sentinel handling at the app layer.';

CREATE TRIGGER notif_cooldowns_set_updated_at
  BEFORE UPDATE ON notification_cooldowns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============= Quiet hours (mutable) =============

CREATE TABLE notification_quiet_hours (
  id            bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  channel_id    bigint NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  start_time    time NOT NULL,
  end_time      time NOT NULL,
  timezone      text NOT NULL DEFAULT 'UTC',
  days_of_week  smallint[] NOT NULL CHECK (days_of_week <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE notification_quiet_hours IS 'Per-channel scheduled mute windows. days_of_week 0=Sun..6=Sat, typed array (ADR-004 pattern).';

CREATE TRIGGER notif_quiet_hours_set_updated_at
  BEFORE UPDATE ON notification_quiet_hours
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_notif_quiet_channel ON notification_quiet_hours (channel_id);

-- ============= Digests (mutable) =============

CREATE TABLE notification_digests (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  channel_id      bigint NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  cadence         text   NOT NULL CHECK (cadence IN ('hourly','daily','weekly')),
  delivery_time   time,
  delivery_dow    smallint CHECK (delivery_dow BETWEEN 0 AND 6),
  enabled         boolean NOT NULL DEFAULT true,
  last_sent_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE notification_digests IS 'Periodic batched-summary delivery config. delivery_time relevant for daily/weekly; delivery_dow for weekly only.';

CREATE TRIGGER notif_digests_set_updated_at
  BEFORE UPDATE ON notification_digests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_notif_digests_enabled ON notification_digests (enabled) WHERE enabled = true;
```

## Suggested Fix

1. Confirm `vehicles`, `alert_rules`, `notification_channels` exist.
2. Write file.
3. Apply.
4. Verify.
5. Commit.

## Acceptance Criteria

- [ ] File exists matching output
- [ ] `psql -f` succeeds
- [ ] All 4 tables created
- [ ] `notifications` has **NO** `updated_at` column (append-only)
- [ ] All other 3 have `updated_at` + trigger
- [ ] `notifications.channel_id` FK is RESTRICT; other FKs SET NULL or CASCADE per intent
- [ ] CHECKs on severity, delivery_status, cadence, delivery_dow applied
- [ ] Partial indexes on pending/enabled present
- [ ] **Zero** JSONB
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\20-notifications.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

# notifications has NO updated_at
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT count(*) FROM information_schema.columns WHERE table_name='notifications' AND column_name='updated_at';"
# Expected: 0

# Other 3 have updated_at
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT table_name FROM information_schema.columns WHERE column_name='updated_at' AND table_name LIKE 'notification%' ORDER BY table_name;"
# Expected: cooldowns, digests, quiet_hours
```

## Out of Scope

- Don't add `notification_templates` table — templates are stored on the per-channel config or per-rule (already supported via `automation_step_action_notify.template`).
- Don't add multi-recipient routing — channel = single destination.
- Don't add `read_at` user-side acknowledgment — out of Phase 3 scope.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/20-notifications.sql
git commit -m "schema(db-refactor): add notifications + cooldowns + quiet hours + digests

Append-only delivery log + 3 mutable delivery-control tables.
Channel FK is RESTRICT throughout to protect in-use channels.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-001-jsonb-policy.md`
- `internal/notification/` (delivery dispatcher)
