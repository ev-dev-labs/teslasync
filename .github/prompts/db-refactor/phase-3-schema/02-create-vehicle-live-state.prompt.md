---
description: "Phase 3 — Create vehicle_live_state (single-source-of-truth for current state)"
---

# 🔵 Schema 02 — `vehicle_live_state` (Current-State SoT)

> **Severity:** Architecturally significant (single source of truth for "right now" state — replaces 7 snapshot-table reads)
> **Priority:** High — every dashboard reads this
> **Category:** Phase 3 — Schema (mutable, non-hypertable)
> **Prompt #:** 3 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/02-vehicle-live-state.sql` |
| Depends on | `01-create-vehicles` (FK + trigger fn) |
| Blocks | Phase 5e telemetry-write (every batch upserts here), Phase 5g UI hooks (`/vehicles/{id}/state` reads here) |
| ADR refs | ADR-002 (hot/cold split), ADR-003 (snapshot strategy) |
| Estimated effort | medium (~45 min — wide table, lots of `COMMENT ON COLUMN`) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/02-vehicle-live-state.sql` containing the **one row per vehicle** mutable table that holds the most recent value of every hot signal — the single source of truth for "current state."

## What's Being Established

Repo memory: "`vehicle_live_state` is the single source of truth for current vehicle state. It is write-through from the in-memory SignalStore." Every Phase 3 hot signal that goes into a hypertable also has a column here, kept current by upsert on every telemetry batch.

This means:
- Dashboards / `/vehicles/{id}/state` reads exactly **one row** for current state
- Hypertables (`positions`, `climate_snapshots`, …) are append-only history
- Snapshot tables are NEVER queried for "latest" — that's a code-review smell

## Recommendation

- PK = `vehicle_id` (1:1 with vehicles)
- One column per hot signal, all nullable (no signal is guaranteed)
- `last_updated_at timestamptz` per logical group (battery, climate, position) for staleness checks
- `BEFORE UPDATE` trigger maintains `updated_at`
- No history here — that's the hypertables' job

## Output (full file contents)

```sql
-- =========================================================================
-- 02 — vehicle_live_state
-- ADR-002 / ADR-003: single-row-per-vehicle current state. Write-through
-- from the in-memory SignalStore on every telemetry batch. Reads from this
-- table back the /vehicles/{id}/state endpoint and every Grafana 'now'
-- panel. Never query snapshot tables for current state.
-- =========================================================================

CREATE TABLE vehicle_live_state (
  vehicle_id              bigint PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Battery / charge
  battery_level           smallint,
  battery_range_mi        double precision,
  charging_state          text CHECK (charging_state IN ('Disconnected','Connected','Charging','Stopped','Complete','NoPower','Starting')),
  charge_limit_soc        smallint,
  charger_voltage         double precision,
  charger_actual_current  double precision,
  charger_power_kw        double precision,
  battery_last_updated_at timestamptz,

  -- Position
  latitude                double precision,
  longitude               double precision,
  heading                 smallint,
  speed_mph               double precision,
  elevation_m             double precision,
  gps_state               text,
  position_last_updated_at timestamptz,

  -- Climate
  inside_temp_c           double precision,
  outside_temp_c          double precision,
  hvac_state              text CHECK (hvac_state IN ('Off','On','Auto','Heating','Cooling','Defrost','Preconditioning')),
  is_climate_on           boolean,
  defrost_mode            text,
  climate_last_updated_at timestamptz,

  -- Drive / motor
  shift_state             text CHECK (shift_state IN ('P','R','N','D')),
  drive_state             text,
  power_kw                double precision,
  motor_rpm               integer,
  drive_last_updated_at   timestamptz,

  -- Security
  locked                  boolean,
  sentry_mode             boolean,
  user_present            boolean,
  doors_open              text,        -- normalized JSON-string from compound DoorState
  windows_open            text,        -- normalized JSON-string from compound WindowState
  security_last_updated_at timestamptz,

  -- Software / firmware
  software_version        text,

  -- Bookkeeping
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  vehicle_live_state IS
  'Single source of truth for current vehicle state. Write-through from in-memory SignalStore on every telemetry batch. NEVER query snapshot tables for current state — read here instead.';
COMMENT ON COLUMN vehicle_live_state.battery_last_updated_at IS 'Wall-clock when battery_* columns last advanced. Use for staleness checks.';
COMMENT ON COLUMN vehicle_live_state.doors_open IS 'Normalized JSON-string from compound DoorState signal (per repo memory: TypeDoors compound flattening).';
COMMENT ON COLUMN vehicle_live_state.windows_open IS 'Normalized JSON-string from compound WindowState signal (per repo memory: window state normalization migration 000132).';
COMMENT ON COLUMN vehicle_live_state.shift_state IS 'P/R/N/D from Tesla. NULL when vehicle asleep.';

CREATE TRIGGER vehicle_live_state_set_updated_at
  BEFORE UPDATE ON vehicle_live_state
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

## Suggested Fix (implementation steps)

1. Confirm `vehicles` and `set_updated_at()` exist:
   ```powershell
   docker exec ts-schema-validate psql -U postgres -d v -c "\dt vehicles" -c "\df set_updated_at"
   ```
2. Write the file contents above to `schema/02-vehicle-live-state.sql`.
3. Apply via the throwaway container.
4. Run verification.
5. Commit.

## Acceptance Criteria

- [ ] File exists matching the output above
- [ ] `psql -f` succeeds with zero errors
- [ ] Table `vehicle_live_state` exists with PK = `vehicle_id`
- [ ] FK to `vehicles(id)` is `ON DELETE CASCADE`
- [ ] **Zero** JSONB/JSON columns (`doors_open` is `text`, NOT jsonb — per repo memory normalization rule)
- [ ] All `CHECK` constraints applied: `charging_state`, `hvac_state`, `shift_state`
- [ ] All four `COMMENT ON COLUMN` statements applied
- [ ] Trigger `vehicle_live_state_set_updated_at` registered
- [ ] Committed with boilerplate

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\02-vehicle-live-state.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

# Zero JSONB
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT column_name FROM information_schema.columns WHERE table_name='vehicle_live_state' AND data_type IN ('jsonb','json');"
# Expected: 0 rows

# CHECK constraints applied
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT conname FROM pg_constraint WHERE conrelid='vehicle_live_state'::regclass AND contype='c' ORDER BY conname;"
# Expected: rows for charging_state, hvac_state, shift_state checks

# FK CASCADE
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT confdeltype FROM pg_constraint WHERE conrelid='vehicle_live_state'::regclass AND contype='f';"
# Expected: c
```

## Out of Scope (reject if asked)

- Don't add history — that's hypertables (positions, climate_snapshots, …).
- Don't promote cold signals here — they live in `signal_observations`.
- Don't add `tire_pressure_*` columns here — that's `vehicle_meta_snapshots` (event-driven, infrequent).
- Don't make this a hypertable — it's a 1-row-per-vehicle mutable lookup.
- Don't add a `last_seen_at` global staleness column — per-group `*_last_updated_at` is more useful.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/02-vehicle-live-state.sql
git commit -m "schema(db-refactor): add vehicle_live_state current-state SoT

Single row per vehicle. Write-through from SignalStore on every
telemetry batch. Read by /vehicles/{id}/state and every 'now' panel.
Replaces 7 snapshot-table 'latest' lookups (per ADR-003).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-002-signal-storage-model.md`
- `.github/prompts/db-refactor/adrs/ADR-003-snapshot-table-strategy.md`
- Repo memory: `vehicle_live_state` is the single source of truth (no snapshot reads for current state)
