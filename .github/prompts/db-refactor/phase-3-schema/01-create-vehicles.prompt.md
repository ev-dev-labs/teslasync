---
description: "Phase 3 — Create vehicles table + shared set_updated_at() trigger function"
---

# 🔵 Schema 01 — `vehicles` (+ shared `set_updated_at()` trigger fn)

> **Severity:** Foundational (every snapshot, drive, automation FK references this; the trigger fn is reused by every later non-append-only table)
> **Priority:** Must run immediately after `00-extensions`
> **Category:** Phase 3 — Schema (root entity)
> **Prompt #:** 2 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/01-vehicles.sql` |
| Depends on | `00-extensions` (must run first — needs `timescaledb` to be installed for later joins) |
| Blocks | Every other Phase 3 prompt (every table FK-references vehicles) and every prompt that uses the `set_updated_at()` trigger |
| ADR refs | ADR-001 (typed by default), ADR-007 (engine choice) |
| Estimated effort | small (~30 min) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/01-vehicles.sql` containing the `vehicles` root table **and** the shared `set_updated_at()` trigger function reused by every subsequent non-append-only table.

## What's Being Established

`vehicles` is the root of every FK chain in the schema. It also hosts the one shared utility this phase needs: the `set_updated_at()` trigger function that maintains `updated_at` columns. Defining it once here avoids 20+ near-identical `CREATE FUNCTION` blocks scattered across later files.

## Recommendation

- `id` is `bigint GENERATED ALWAYS AS IDENTITY` per binding rule #4. No `serial`.
- `vin` is the natural key — `text NOT NULL UNIQUE` (17-char VIN, but stored as text to allow Tesla's evolving VIN formats).
- `tesla_id` is the Fleet API vehicle id — `bigint NOT NULL UNIQUE`.
- `model`, `display_name`, `option_codes` are all `text` — schema doesn't try to enumerate every Tesla model.
- `enrolled_at` is when we started tracking — `timestamptz NOT NULL DEFAULT now()`.
- `archived_at timestamptz` (nullable) for soft-delete; queries default to `WHERE archived_at IS NULL`.
- `set_updated_at()` is a `PLPGSQL` function returning `trigger`; the `BEFORE UPDATE` trigger calls it.

## Output (full file contents)

```sql
-- =========================================================================
-- 01 — vehicles + shared set_updated_at() trigger fn
-- ADR-001: typed-by-default. The set_updated_at fn is the ONE shared
-- pl/pgsql artifact this schema keeps; every other table installs a
-- BEFORE UPDATE trigger that calls it.
-- =========================================================================

-- Shared trigger fn — used by every non-append-only table
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION set_updated_at() IS
  'Shared BEFORE UPDATE trigger function. Maintains updated_at on every '
  'non-append-only table. Defined once in 01-vehicles.sql.';

-- Root entity
CREATE TABLE vehicles (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  tesla_id        bigint      NOT NULL UNIQUE,
  vin             text        NOT NULL UNIQUE,
  display_name    text        NOT NULL,
  model           text,
  option_codes    text,
  color           text,
  trim_level      text,
  enrolled_at     timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  vehicles                 IS 'Root entity. Every FK in the schema chains back here.';
COMMENT ON COLUMN vehicles.tesla_id        IS 'Tesla Fleet API vehicle id. Distinct from our surrogate id.';
COMMENT ON COLUMN vehicles.vin             IS 'Vehicle Identification Number — 17 chars, but stored as text to tolerate Tesla format changes.';
COMMENT ON COLUMN vehicles.option_codes    IS 'Comma-separated option codes from Fleet API; opaque, never parsed in queries.';
COMMENT ON COLUMN vehicles.archived_at     IS 'Soft-delete marker. Active queries should add WHERE archived_at IS NULL.';

CREATE TRIGGER vehicles_set_updated_at
  BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_vehicles_active ON vehicles (id) WHERE archived_at IS NULL;
```

## Suggested Fix (implementation steps)

1. Confirm `00-extensions.sql` was applied (extensions present in `ts-schema-validate`):
   ```powershell
   docker exec ts-schema-validate psql -U postgres -d v -c "SELECT extname FROM pg_extension WHERE extname='timescaledb';"
   ```
2. Write the file contents above to `schema/01-vehicles.sql`.
3. Apply via the throwaway container.
4. Run verification (below).
5. Commit (boilerplate at bottom).

## Acceptance Criteria

- [ ] File `schema/01-vehicles.sql` exists and matches the contents above exactly
- [ ] `psql -f` succeeds with zero errors and zero warnings
- [ ] Function `set_updated_at()` exists and returns `trigger`
- [ ] Table `vehicles` exists with **no** JSONB or JSON columns
- [ ] `id` column is `bigint` with `GENERATED ALWAYS AS IDENTITY` (NOT serial)
- [ ] `vin` and `tesla_id` are both `UNIQUE`
- [ ] Trigger `vehicles_set_updated_at` is registered as `BEFORE UPDATE`
- [ ] Partial index `idx_vehicles_active` exists with `WHERE archived_at IS NULL`
- [ ] All four `COMMENT ON COLUMN` statements applied
- [ ] File is committed with the boilerplate message below

## Verification

```powershell
# Apply
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\01-vehicles.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

# Trigger function exists
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT proname FROM pg_proc WHERE proname = 'set_updated_at';"
# Expected: 1 row

# id column is identity (NOT serial)
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT column_name, identity_generation FROM information_schema.columns WHERE table_name='vehicles' AND column_name='id';"
# Expected: id | ALWAYS

# Zero JSONB
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT column_name FROM information_schema.columns WHERE table_name='vehicles' AND data_type IN ('jsonb','json');"
# Expected: 0 rows

# Trigger present
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT tgname FROM pg_trigger WHERE tgrelid='vehicles'::regclass AND NOT tgisinternal;"
# Expected: vehicles_set_updated_at
```

## Out of Scope (reject if asked)

- Don't add `vehicle_units` or per-vehicle config — that's `23-create-system-tables`.
- Don't add `vehicle_live_state` columns here — that's `02-create-vehicle-live-state`.
- Don't define more trigger functions — `set_updated_at` is the only shared one this phase needs.
- Don't add a `users` table here — Phase 3 deliberately skips multi-user; revisited in Phase 7.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/01-vehicles.sql
git commit -m "schema(db-refactor): add vehicles table + shared set_updated_at trigger fn

Root entity for every FK chain. Defines the shared set_updated_at()
trigger function reused by all later non-append-only tables.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-001-jsonb-policy.md` — typed-by-default policy
- `.github/prompts/db-refactor/phase-3-schema/README.md` — phase index and binding rules
