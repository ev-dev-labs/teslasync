---
description: "Phase 3 — Create tesla_tokens table (encrypted Fleet API OAuth tokens)"
---

# 🟢 Schema 21 — `tesla_tokens`

> **Severity:** Standard (single-row-ish security-sensitive)
> **Priority:** Medium
> **Category:** Phase 3 — Schema (auth/secret storage)
> **Prompt #:** 22 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/21-tesla-tokens.sql` |
| Depends on | `01-create-vehicles` (trigger fn) |
| Blocks | (none) |
| ADR refs | ADR-001, ADR-005 (no raw_json column) |
| Estimated effort | small (~20 min) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/21-tesla-tokens.sql` containing the Fleet API OAuth token store. One row per Tesla account; access/refresh tokens stored as encrypted ciphertext.

## What's Being Established

ADR-005 forbids `raw_json` columns from Tesla integration tables. This is the smallest such table — it stores the OAuth tokens that drive every Fleet API call. Encryption at rest is handled by `internal/crypto/`; this schema only stores the resulting ciphertext as `text`.

## Recommendation

- `id bigint GENERATED ALWAYS AS IDENTITY` (multi-account support is forward-safe even if currently single-account)
- `account_email` is the natural identifier (UNIQUE)
- `access_token`, `refresh_token` are `text NOT NULL` — encrypted ciphertext
- `expires_at` is the access-token expiry timestamp
- No `raw_json`, no `scope_blob jsonb`

## Output (full file contents)

```sql
-- =========================================================================
-- 21 — tesla_tokens
-- ADR-005: no raw_json column. Tokens stored as ciphertext text;
-- encryption performed by internal/crypto/ before write.
-- =========================================================================

CREATE TABLE tesla_tokens (
  id             bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  account_email  text        NOT NULL UNIQUE,
  access_token   text        NOT NULL,                  -- ciphertext
  refresh_token  text        NOT NULL,                  -- ciphertext
  token_type     text        NOT NULL DEFAULT 'Bearer',
  scopes         text,                                  -- comma-separated scope list
  expires_at     timestamptz NOT NULL,
  obtained_at    timestamptz NOT NULL DEFAULT now(),
  last_refreshed_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  tesla_tokens IS
  'Fleet API OAuth tokens. ADR-005: no raw_json. Tokens stored as ciphertext (encryption in internal/crypto/).';
COMMENT ON COLUMN tesla_tokens.access_token IS 'Encrypted at rest. Decrypt via internal/crypto/Decrypt before use.';
COMMENT ON COLUMN tesla_tokens.refresh_token IS 'Encrypted at rest. Decrypt via internal/crypto/Decrypt before use.';
COMMENT ON COLUMN tesla_tokens.scopes IS 'Comma-separated scope list. Runtime parses; never queried server-side.';

CREATE TRIGGER tesla_tokens_set_updated_at
  BEFORE UPDATE ON tesla_tokens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_tesla_tokens_expires ON tesla_tokens (expires_at);
```

## Suggested Fix

1. Confirm `set_updated_at()` exists.
2. Write file.
3. Apply.
4. Verify.
5. Commit.

## Acceptance Criteria

- [ ] File exists matching output
- [ ] `psql -f` succeeds
- [ ] `account_email` is UNIQUE
- [ ] **No** column named `raw_json` or with `jsonb` type
- [ ] Trigger registered
- [ ] Index on `expires_at` exists (for "expired tokens" sweep queries)
- [ ] **Zero** JSONB
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\21-tesla-tokens.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

# UNIQUE constraint on account_email
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT conname FROM pg_constraint WHERE conrelid='tesla_tokens'::regclass AND contype='u';"

# No raw_json
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT column_name FROM information_schema.columns WHERE table_name='tesla_tokens' AND column_name='raw_json';"
# Expected: 0 rows
```

## Out of Scope

- Don't add encryption-key reference columns — key management is in `internal/crypto/`.
- Don't add region/datacenter columns — that's `settings` (prompt 23).
- Don't store scopes as a typed array — comma-separated is sufficient for this use.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/21-tesla-tokens.sql
git commit -m "schema(db-refactor): add tesla_tokens table

ADR-005: no raw_json column. Tokens stored as ciphertext via internal/crypto.
UNIQUE on account_email; index on expires_at for sweep queries.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-005-tesla-rawjson-deletion.md`
- `internal/crypto/` (token encryption)
