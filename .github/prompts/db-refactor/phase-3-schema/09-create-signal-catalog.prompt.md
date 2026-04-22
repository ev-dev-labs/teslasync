---
description: "Phase 3 — Create signal_catalog (operational truth for every signal name ever seen)"
---

# 🔵 Schema 09 — `signal_catalog`

> **Severity:** Operational anchor (the table that makes ADR-009 onboarding work)
> **Priority:** High — `signal_observations` (prompt 08) FK-references this
> **Category:** Phase 3 — Schema (lookup/registry)
> **Prompt #:** 10 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/09-signal-catalog.sql` |
| Depends on | `01-create-vehicles` (uses `set_updated_at()` trigger fn) |
| Blocks | `08-create-signal-observations-hypertable` (its FK targets this) — see "Apply order" |
| ADR refs | ADR-009 (signal onboarding runbook), ADR-002 (cold path uses this as truth) |
| Estimated effort | small (~20 min) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Apply Order Note

`signal_observations` (prompt 08, file `08-signal-observations.sql`) has `FK(signal_name) REFERENCES signal_catalog(name)`. When applying schema files in numeric order, file 08 runs before file 09 — which would fail.

**Resolution:** at apply time, the runner must call this file (`09-signal-catalog.sql`) **before** file `08-signal-observations.sql`. The cumulative throwaway-DB pattern in this phase requires the runner to either (a) reorder these two prompts, or (b) split this prompt's CREATE TABLE out from the FK addition. Chosen here: keep numeric order in prompt naming for human readability, but the apply step in this prompt's "Suggested Fix" runs **before** prompt 08's apply step. Prompt 08's verification confirms the FK is present.

## Single Goal

Write `schema/09-signal-catalog.sql` containing the registry table that tracks every signal name ever seen, its tier (`hot`/`cold`/`dropped`), and its promoted location.

## What's Being Established

ADR-009 makes signal onboarding a checklist instead of an outage. This table backs it: nightly job updates `last_seen_at` and `observation_count`, weekly discovery query selects rows where `storage_tier='cold' AND observation_count > 10000` for triage.

## Recommendation

- PK = `name` (text, natural key — matches Tesla Fleet Telemetry signal names verbatim)
- `storage_tier` text + CHECK (`hot`/`cold`/`dropped`)
- `typed_table`/`typed_column` populated only when promoted to hot
- Include `created_at`/`updated_at` because rows mutate (counts, tier promotions)

## Output (full file contents)

```sql
-- =========================================================================
-- 09 — signal_catalog (registry of every signal name ever seen)
-- ADR-009: backs the onboarding runbook. signal_observations FKs here.
-- =========================================================================

CREATE TABLE signal_catalog (
  name              text PRIMARY KEY,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  observation_count bigint      NOT NULL DEFAULT 0,
  storage_tier      text        NOT NULL DEFAULT 'cold'
                                CHECK (storage_tier IN ('hot','cold','dropped')),
  typed_table       text,
  typed_column      text,
  data_kind         text        CHECK (data_kind IN ('numeric','text','boolean','compound')),
  unit              text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  signal_catalog IS
  'Registry of every signal name ever seen. ADR-009 onboarding source of truth.';
COMMENT ON COLUMN signal_catalog.storage_tier IS
  'hot = promoted to a typed column; cold = stored in signal_observations; dropped = silently skipped at ingest.';
COMMENT ON COLUMN signal_catalog.typed_table IS
  'Populated when storage_tier=hot. NULL otherwise.';
COMMENT ON COLUMN signal_catalog.typed_column IS
  'Populated when storage_tier=hot. NULL otherwise.';
COMMENT ON COLUMN signal_catalog.data_kind IS
  'Hint for which value_* column in signal_observations is populated.';

CREATE TRIGGER signal_catalog_set_updated_at
  BEFORE UPDATE ON signal_catalog
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_signal_catalog_tier_count
  ON signal_catalog (storage_tier, observation_count DESC);
```

## Suggested Fix

1. Confirm `vehicles` and `set_updated_at()` exist:
   ```powershell
   docker exec ts-schema-validate psql -U postgres -d v -c "\df set_updated_at"
   ```
2. Write the file contents above to `schema/09-signal-catalog.sql`.
3. **Apply this file BEFORE prompt 08's file** to satisfy the FK.
4. Run verification.
5. Commit.

## Acceptance Criteria

- [ ] File exists matching output
- [ ] `psql -f` succeeds
- [ ] Table `signal_catalog` exists with PK `name`
- [ ] CHECK on `storage_tier` enforces 3-value set
- [ ] CHECK on `data_kind` enforces 4-value set
- [ ] Trigger `signal_catalog_set_updated_at` registered
- [ ] Index `idx_signal_catalog_tier_count` exists with correct `(storage_tier, observation_count DESC)` order
- [ ] **Zero** JSONB
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\09-signal-catalog.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='signal_catalog'::regclass AND contype='c';"
# Expected: rows for storage_tier_check, data_kind_check

docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT indexdef FROM pg_indexes WHERE indexname='idx_signal_catalog_tier_count';"
```

## Out of Scope

- Don't seed initial rows — that's runtime startup logic in Phase 5e.
- Don't add a `last_promoted_at` audit column — promotion history can live in `audit_logs`.
- Don't denormalize signal definitions from `internal/enums/signal_types.go` — that file remains the build-time source.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/09-signal-catalog.sql
git commit -m "schema(db-refactor): add signal_catalog registry

ADR-009 onboarding source of truth. signal_observations FKs here
(RESTRICT) so unknown signals block ingest until catalog is updated.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-009-future-signal-onboarding.md`
- `.github/prompts/db-refactor/phase-3-schema/08-create-signal-observations-hypertable.prompt.md` (FK target)
