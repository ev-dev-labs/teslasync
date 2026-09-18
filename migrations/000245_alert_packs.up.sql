CREATE TABLE IF NOT EXISTS alert_pack_installations (
    id BIGSERIAL PRIMARY KEY,
    pack_id TEXT NOT NULL,
    name TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    scope_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (pack_id, scope_key)
);

CREATE TABLE IF NOT EXISTS alert_pack_members (
    installation_id BIGINT NOT NULL REFERENCES alert_pack_installations(id) ON DELETE CASCADE,
    template_id TEXT NOT NULL,
    rule_id BIGINT REFERENCES alert_rules(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    owned BOOLEAN NOT NULL,
    PRIMARY KEY (installation_id, template_id)
);
CREATE INDEX IF NOT EXISTS idx_alert_pack_members_rule ON alert_pack_members(rule_id);
