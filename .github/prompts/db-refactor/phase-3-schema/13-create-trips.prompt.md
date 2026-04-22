---
description: "Phase 3 — Create trips table (multi-drive trip aggregation)"
---

# 🟢 Schema 13 — `trips`

> **Severity:** Standard (analytics roll-up)
> **Priority:** Medium
> **Category:** Phase 3 — Schema (mutable, non-hypertable)
> **Prompt #:** 14 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/13-trips.sql` |
| Depends on | `01-create-vehicles`, `11-create-drives` |
| Blocks | (none — leaf) |
| ADR refs | ADR-001 |
| Estimated effort | small (~25 min) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/13-trips.sql`: a parent table for multi-drive "trips" (e.g., a vacation = multiple drives) plus the join table linking drives to trips.

## What's Being Established

A trip is a user-defined grouping of one or more drives. Many vehicles never use trips; the join is many-to-many through `trip_drives`. Trip-level totals are denormalized for fast lookup; drives can be re-summed if denormalization drifts.

## Recommendation

- `trips`: `id`, `vehicle_id` FK, `name`, `start_ts`, `end_ts`, totals
- `trip_drives`: composite PK `(trip_id, drive_id)`, FK CASCADE both ways
- Triggers maintain `updated_at` on `trips` only (`trip_drives` is append/delete-only with no audit cols)

## Output (full file contents)

```sql
-- =========================================================================
-- 13 — trips + trip_drives join
-- Multi-drive aggregation. Trips are user-defined, optional groupings.
-- =========================================================================

CREATE TABLE trips (
  id                bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  vehicle_id        bigint           NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  name              text             NOT NULL,
  description       text,
  start_ts          timestamptz      NOT NULL,
  end_ts            timestamptz,
  total_distance_mi double precision,
  total_energy_kwh  double precision,
  total_duration_min double precision,
  created_at        timestamptz      NOT NULL DEFAULT now(),
  updated_at        timestamptz      NOT NULL DEFAULT now(),
  CHECK (end_ts IS NULL OR end_ts >= start_ts)
);

COMMENT ON TABLE  trips IS 'User-defined multi-drive grouping (e.g., a vacation). Totals are denormalized; can be recomputed from drives.';
COMMENT ON COLUMN trips.total_distance_mi IS 'Sum of constituent drives.distance_mi. Recompute via aggregate query if denormalization drifts.';

CREATE TRIGGER trips_set_updated_at
  BEFORE UPDATE ON trips
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_trips_vehicle_start ON trips (vehicle_id, start_ts DESC);

-- Many-to-many join: a drive can theoretically belong to multiple trips
CREATE TABLE trip_drives (
  trip_id   bigint NOT NULL REFERENCES trips(id)  ON DELETE CASCADE,
  drive_id  bigint NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, drive_id)
);

COMMENT ON TABLE trip_drives IS 'Many-to-many join. Append/delete-only; no audit columns.';

CREATE INDEX idx_trip_drives_drive ON trip_drives (drive_id);
```

## Suggested Fix

1. Confirm `vehicles`, `drives`, `set_updated_at()` exist.
2. Write file.
3. Apply.
4. Verify.
5. Commit.

## Acceptance Criteria

- [ ] File exists matching output
- [ ] `psql -f` succeeds
- [ ] `trips` table with FK to vehicles CASCADE
- [ ] `trip_drives` join with composite PK (trip_id, drive_id) and both FKs CASCADE
- [ ] CHECK on `end_ts IS NULL OR end_ts >= start_ts`
- [ ] Trigger `trips_set_updated_at` registered (NOT on `trip_drives`)
- [ ] Index `idx_trip_drives_drive` exists for reverse-lookup
- [ ] **Zero** JSONB
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\13-trips.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

# Both FKs CASCADE on trip_drives
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT conname, confdeltype FROM pg_constraint WHERE conrelid='trip_drives'::regclass AND contype='f';"
# Expected: 2 rows, both confdeltype='c'

# trip_drives has no updated_at
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT column_name FROM information_schema.columns WHERE table_name='trip_drives' AND column_name='updated_at';"
# Expected: 0 rows
```

## Out of Scope

- Don't add `trip_tags` — tag normalization is shared infra; defer to a future prompt if needed.
- Don't auto-recompute totals via trigger — explicit recompute via Go is preferred (ADR-006).
- Don't add `is_archived` — soft-delete is `vehicles.archived_at` only.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/13-trips.sql
git commit -m "schema(db-refactor): add trips table + trip_drives join

User-defined multi-drive grouping. Totals denormalized for fast lookup;
recomputable from drives if drift detected. Many-to-many join is
append/delete-only (no audit columns).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-001-jsonb-policy.md`
