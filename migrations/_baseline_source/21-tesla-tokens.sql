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
