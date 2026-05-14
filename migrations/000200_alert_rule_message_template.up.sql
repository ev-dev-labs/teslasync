-- Phase-50 — Restore per-rule alert message templates + add include_title toggle.
--
-- Context: Phase-3 / ADR-001 removed `msg_template` in favour of typed alert
-- rule storage. In practice this left every alert with a redundant 2-line
-- payload (title and body restating the rule name and the raw signal value),
-- which is unreadable on Discord/Slack/push channels. Phase-50 reintroduces a
-- per-rule customizable message template as a TYPED TEXT column (NOT JSONB —
-- ADR-001's anti-JSONB stance is preserved). See ADR-005 for the rationale.
--
-- The companion `include_title` flag lets users suppress the bold header line
-- on transports that render title + body separately (Discord/Slack/Telegram/
-- ntfy). The canonical title is still persisted in `notification_logs` and
-- broadcast over SSE so the in-app UI keeps its row header.

ALTER TABLE alert_rules
    ADD COLUMN msg_template TEXT NULL,
    ADD COLUMN include_title BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN alert_rules.msg_template IS
    'Optional per-rule notification body template. NULL means use the op-aware default rendered by internal/alertmsg. Supports {{key}} substitution against signal values plus built-in placeholders (VehicleName, RuleName, Severity, Threshold, Value, PrevValue, Now, MetricValue, MetricPrevValue, MetricChangePct). Max 1024 chars enforced at the API boundary. Phase-50 / ADR-005.';

COMMENT ON COLUMN alert_rules.include_title IS
    'When TRUE (default), notification transports that render a separate title field include it. When FALSE, supported transports (Discord/Slack/Telegram/ntfy/webhook) deliver body-only output. The canonical title is still persisted in notification_logs and broadcast over SSE so the in-app UI is unaffected. Phase-50 / ADR-005.';
