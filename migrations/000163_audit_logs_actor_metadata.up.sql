-- Phase-40 / Prompt 49 — Recent Activity Discoverability
--
-- Adds optional per-event metadata columns so per-user activity feeds can
-- show "who, where from, with what client" while still allowing IP/UA
-- redaction after a separate retention window (audit_ip_retention_days).
--
-- The existing baseline columns (actor, action, entity_type, entity_id,
-- detail, ts) keep their semantics. The new ip/user_agent columns are
-- nullable so historical rows and writers that don't supply them are
-- unaffected. The (actor, ts DESC) index from baseline 000142 already
-- serves the per-actor "my recent activity" query — no new index needed.
ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS ip         TEXT,
    ADD COLUMN IF NOT EXISTS user_agent TEXT;

COMMENT ON COLUMN audit_logs.ip         IS 'Source IP recorded at write time. Redacted to NULL by maintenance worker after audit_ip_retention_days.';
COMMENT ON COLUMN audit_logs.user_agent IS 'Source User-Agent recorded at write time. Redacted alongside ip after audit_ip_retention_days.';
