---
description: "Phase 3 — Create api_call_logs hypertable (Fleet API observability log, append-only)"
---

# 🟢 Schema 22 — `api_call_logs` Hypertable (Append-Only Audit)

> **Severity:** Standard (observability)
> **Priority:** Low-Medium
> **Category:** Phase 3 — Schema (hypertable, append-only)
> **Prompt #:** 23 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/22-api-call-logs.sql` |
| Depends on | `00-extensions`, `01-create-vehicles` |
| Blocks | (none) |
| ADR refs | ADR-005 (no raw_json), ADR-003 (long retention for audit-grade hot table) |
| Estimated effort | small (~20 min) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/22-api-call-logs.sql` containing the Fleet API call log hypertable — one row per outbound Tesla API call, used for observability and rate-limit forensics.

## What's Being Established

`api_call_logs` is **append-only** (no `updated_at`, no row mutations). It's a hypertable for compression efficiency. Per ADR-005, no `request_body jsonb` or `response_body jsonb` — bodies are stored as text or omitted entirely (URL + status + duration is enough for forensic value 99% of the time).

## Recommendation

- PK = `(ts, id)` where `id bigint GENERATED ALWAYS AS IDENTITY` — so PK is unique even if 2 calls share `ts` to the microsecond
- 7-day chunks, compression after 30 days, 365-day retention
- `endpoint` is the URL path (no query string PII)
- `status_code` smallint, `duration_ms` integer
- No `body` columns by default — add `error_message text` for failures

## Output (full file contents)

```sql
-- =========================================================================
-- 22 — api_call_logs (append-only hypertable, audit/observability)
-- ADR-005: no raw_json. Bodies excluded by default; only URL/status/duration.
-- =========================================================================

CREATE TABLE api_call_logs (
  id              bigint           GENERATED ALWAYS AS IDENTITY,
  ts              timestamptz      NOT NULL DEFAULT now(),
  vehicle_id      bigint           REFERENCES vehicles(id) ON DELETE SET NULL,
  service         text             NOT NULL DEFAULT 'tesla-fleet'
                                   CHECK (service IN ('tesla-fleet','geocoding','eia','ntfy','webhook')),
  http_method     text             NOT NULL CHECK (http_method IN ('GET','POST','PUT','PATCH','DELETE')),
  endpoint        text             NOT NULL,
  status_code     smallint         NOT NULL,
  duration_ms     integer          NOT NULL CHECK (duration_ms >= 0),
  error_message   text,
  rate_limited    boolean          NOT NULL DEFAULT false,
  PRIMARY KEY (ts, id)
);

COMMENT ON TABLE  api_call_logs IS
  'Append-only outbound API call log. ADR-005: no raw_json bodies; URL+status+duration only.';
COMMENT ON COLUMN api_call_logs.endpoint IS
  'URL path only (no query string). Strip identifiers from path before insert if PII risk.';

SELECT create_hypertable('api_call_logs', 'ts', chunk_time_interval => interval '7 days');

ALTER TABLE api_call_logs SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'service',
  timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('api_call_logs', interval '30 days');
SELECT add_retention_policy ('api_call_logs', interval '365 days');

CREATE INDEX idx_api_logs_service_ts ON api_call_logs (service, ts DESC);
CREATE INDEX idx_api_logs_failures   ON api_call_logs (ts DESC) WHERE status_code >= 400;
CREATE INDEX idx_api_logs_rate_limited ON api_call_logs (ts DESC) WHERE rate_limited = true;
```

## Suggested Fix

1. Confirm `vehicles` exists.
2. Write file.
3. Apply.
4. Verify.
5. Commit.

## Acceptance Criteria

- [ ] File exists matching output
- [ ] `psql -f` succeeds
- [ ] Hypertable registered with 7-day chunks
- [ ] Compression segmentby = `service`
- [ ] Compression delay = 30d, retention = 365d
- [ ] **No** `updated_at` (append-only)
- [ ] **No** `request_body` or `response_body` columns
- [ ] All 3 indexes present (general, failures, rate-limited)
- [ ] CHECK on `service`, `http_method`, `duration_ms >= 0` applied
- [ ] **Zero** JSONB
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\22-api-call-logs.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_name='api_call_logs';"

# No body columns
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT column_name FROM information_schema.columns WHERE table_name='api_call_logs' AND column_name LIKE '%_body';"
# Expected: 0 rows

# 3 secondary indexes
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT indexname FROM pg_indexes WHERE tablename='api_call_logs' AND indexname LIKE 'idx_%' ORDER BY indexname;"
# Expected: 3 rows
```

## Out of Scope

- Don't add a `request_id` correlation column without a Phase 5 plan to populate it.
- Don't store request/response bodies — they're huge and PII-sensitive.
- Don't add `user_agent` — internal client only.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/22-api-call-logs.sql
git commit -m "schema(db-refactor): add api_call_logs hypertable

Append-only outbound API observability. ADR-005: no raw_json bodies.
7-day chunks, compression after 30d, 365d retention.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-005-tesla-rawjson-deletion.md`
- `internal/tesla/client.go` (caller)
