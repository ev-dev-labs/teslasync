---
description: "Phase 3 — Create notification_channels + per-channel typed config tables (and close action_notify FK)"
---

# 🔵 Schema 19 — `notification_channels` (+ Per-Channel Config + Close `action_notify` FK)

> **Severity:** Architectural (closes a forward FK from prompt 17)
> **Priority:** Medium
> **Category:** Phase 3 — Schema (typed config, closes FK)
> **Prompt #:** 20 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/19-notification-channels.sql` |
| Depends on | `01-create-vehicles` (trigger fn), `17-create-automation-step-children` (closes FK to notify) |
| Blocks | `20-create-notifications` (notifications.channel_id FK) |
| ADR refs | ADR-001 (typed channel config — no jsonb config blob) |
| Estimated effort | small (~40 min — 7 tables in one file) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/19-notification-channels.sql` containing the parent `notification_channels` table, **one typed config child table per channel kind**, and the `ALTER TABLE … ADD FOREIGN KEY` that closes the deferred FK from `automation_step_action_notify.channel_id` to `notification_channels(id)`.

## What's Being Established

The codebase has 7 notification kinds (Discord, Slack, Telegram, Email, Webhook, ntfy, Pushover). Each has different required config (Slack needs webhook URL; Email needs SMTP host/port/user/pass/from). ADR-001 forbids a `config jsonb` blob — instead, each kind gets a typed child table.

## Recommendation

- Parent `notification_channels` holds shared fields (name, kind, enabled)
- One child per kind, PK = `channel_id` (1:1, CASCADE)
- Secrets are stored encrypted (the values are ciphertext text strings; encryption happens in `internal/crypto/`)

## Output (full file contents)

```sql
-- =========================================================================
-- 19 — notification_channels + per-kind typed config + close FK from 17
-- ADR-001: per-kind typed config tables, no jsonb config blob.
-- =========================================================================

CREATE TYPE notification_channel_kind AS ENUM (
  'discord','slack','telegram','email','webhook','ntfy','pushover'
);

CREATE TABLE notification_channels (
  id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name        text                       NOT NULL,
  kind        notification_channel_kind  NOT NULL,
  enabled     boolean                    NOT NULL DEFAULT true,
  created_at  timestamptz                NOT NULL DEFAULT now(),
  updated_at  timestamptz                NOT NULL DEFAULT now()
);

COMMENT ON TABLE notification_channels IS 'Parent table for typed notification channel config.';

CREATE TRIGGER notification_channels_set_updated_at
  BEFORE UPDATE ON notification_channels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_notif_channels_enabled ON notification_channels (enabled) WHERE enabled = true;

-- ============= Per-kind typed config children =============

CREATE TABLE notification_channel_discord (
  channel_id  bigint PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  webhook_url text NOT NULL,                -- encrypted at rest by internal/crypto
  username    text,
  avatar_url  text
);

CREATE TABLE notification_channel_slack (
  channel_id  bigint PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  webhook_url text NOT NULL,                -- encrypted at rest
  channel     text,
  username    text
);

CREATE TABLE notification_channel_telegram (
  channel_id bigint PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  bot_token  text NOT NULL,                 -- encrypted at rest
  chat_id    text NOT NULL
);

CREATE TABLE notification_channel_email (
  channel_id    bigint PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  smtp_host     text NOT NULL,
  smtp_port     integer NOT NULL CHECK (smtp_port BETWEEN 1 AND 65535),
  smtp_username text,
  smtp_password text,                       -- encrypted at rest
  from_address  text NOT NULL,
  to_addresses  text NOT NULL,              -- comma-separated; runtime parses
  use_tls       boolean NOT NULL DEFAULT true
);

CREATE TABLE notification_channel_webhook (
  channel_id   bigint PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  url          text NOT NULL,
  http_method  text NOT NULL DEFAULT 'POST' CHECK (http_method IN ('POST','PUT','PATCH')),
  bearer_token text                         -- encrypted at rest
);

CREATE TABLE notification_channel_ntfy (
  channel_id  bigint PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  server_url  text NOT NULL DEFAULT 'https://ntfy.sh',
  topic       text NOT NULL,
  auth_token  text                          -- encrypted at rest
);

CREATE TABLE notification_channel_pushover (
  channel_id bigint PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  user_key   text NOT NULL,                 -- encrypted at rest
  api_token  text NOT NULL                  -- encrypted at rest
);

-- ============= Close deferred FK from prompt 17 =============

ALTER TABLE automation_step_action_notify
  ADD CONSTRAINT action_notify_channel_fk
  FOREIGN KEY (channel_id) REFERENCES notification_channels(id) ON DELETE RESTRICT;
```

## Suggested Fix

1. Confirm `automation_step_action_notify` (prompt 17) and `set_updated_at()` exist.
2. Write file.
3. Apply.
4. Verify.
5. Commit.

## Acceptance Criteria

- [ ] File exists matching output
- [ ] `psql -f` succeeds
- [ ] ENUM `notification_channel_kind` has all 7 values
- [ ] Parent + 7 child tables (= 8 tables) created
- [ ] All child PKs = `channel_id` with FK CASCADE to parent
- [ ] FK `action_notify_channel_fk` exists with `ON DELETE RESTRICT` (deleting a channel referenced by an automation should fail)
- [ ] CHECK on `smtp_port BETWEEN 1 AND 65535` applied
- [ ] CHECK on `http_method IN ('POST','PUT','PATCH')` applied
- [ ] **Zero** JSONB across all 8 tables
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\19-notification-channels.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

# 7 enum values
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT count(*) FROM pg_enum WHERE enumtypid='notification_channel_kind'::regtype;"
# Expected: 7

# 8 tables (parent + 7 children)
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'notification_channel%';"
# Expected: 8

# Closed FK
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT confdeltype FROM pg_constraint WHERE conname='action_notify_channel_fk';"
# Expected: 'r' (RESTRICT)
```

## Out of Scope

- Don't add channel-specific rate limiting columns — defer to a future enhancement.
- Don't store secrets in plaintext — runtime `internal/crypto/` handles encryption; this schema accepts ciphertext text values.
- Don't add a `last_used_at` column — observability concern.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/19-notification-channels.sql
git commit -m "schema(db-refactor): add notification_channels + 7 typed configs + close FK

ADR-001: per-kind typed config tables (Discord/Slack/Telegram/Email/Webhook/
ntfy/Pushover). Closes deferred FK from automation_step_action_notify
to notification_channels (RESTRICT — protects in-use channels).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-001-jsonb-policy.md`
- `internal/notification/` (7-channel dispatch — schema mirrors implementation)
