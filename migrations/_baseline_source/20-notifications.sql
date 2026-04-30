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
