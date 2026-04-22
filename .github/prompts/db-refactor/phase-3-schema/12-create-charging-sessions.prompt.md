---
description: "Phase 3 — Create charging_sessions table (+ adds FK from charging_telemetry.session_id)"
---

# 🟢 Schema 12 — `charging_sessions`

> **Severity:** Standard (charging-side parallel of `drives`)
> **Priority:** Medium-High
> **Category:** Phase 3 — Schema (mutable, non-hypertable; closes a forward FK)
> **Prompt #:** 13 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/12-charging-sessions.sql` |
| Depends on | `01-create-vehicles`, `04-create-charging-telemetry-hypertable` (this file adds the deferred FK) |
| Blocks | `25-create-caggs-charging-summary` (CAGG groups by session) |
| ADR refs | ADR-001 |
| Estimated effort | small (~30 min) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/12-charging-sessions.sql` containing one row per charging session **and** the deferred `ALTER TABLE charging_telemetry ADD FOREIGN KEY (session_id) REFERENCES charging_sessions(id)` that closes the forward dependency from prompt 04.

## What's Being Established

`charging_sessions` summarizes a session that `charging_telemetry` records sub-second. The FK from telemetry to session is deferred to this prompt to avoid a forward-reference loop in the schema apply order.

## Recommendation

- `id bigint GENERATED ALWAYS AS IDENTITY`
- FK to `vehicles(id) ON DELETE CASCADE`
- Currency in `numeric(10,4)` — fractional cents allowed, scale matches typical electricity rate precision
- Energy in **kWh**
- Distance gained in **miles** per repo memory
- `set_updated_at` trigger
- **Final statement:** `ALTER TABLE charging_telemetry ADD CONSTRAINT ... FOREIGN KEY (session_id) REFERENCES charging_sessions(id) ON DELETE SET NULL`

## Output (full file contents)

```sql
-- =========================================================================
-- 12 — charging_sessions (one row per charging session)
-- Also closes the forward FK from charging_telemetry.session_id (deferred
-- in prompt 04 to avoid forward dependency).
-- =========================================================================

CREATE TABLE charging_sessions (
  id                  bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  vehicle_id          bigint           NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  start_ts            timestamptz      NOT NULL,
  end_ts              timestamptz,
  duration_min        double precision,
  start_battery_pct   smallint,
  end_battery_pct     smallint,
  energy_added_kwh    double precision,
  miles_added         double precision,
  charger_type        text             CHECK (charger_type IN ('AC','DC','Supercharger','Wall_Connector','Mobile','Destination','Unknown')),
  charger_location    text,
  charger_power_kw_max double precision,
  charger_power_kw_avg double precision,
  cost                numeric(10, 4),
  cost_currency       text,
  ended_status        text             CHECK (ended_status IN ('completed','interrupted','user_stopped','full','unknown')),
  created_at          timestamptz      NOT NULL DEFAULT now(),
  updated_at          timestamptz      NOT NULL DEFAULT now(),
  CHECK (end_ts IS NULL OR end_ts >= start_ts)
);

COMMENT ON TABLE  charging_sessions IS 'One row per charging session. end_ts NULL while session in progress.';
COMMENT ON COLUMN charging_sessions.cost IS 'Computed cost in cost_currency. NULL when electricity_cost row lookup fails.';
COMMENT ON COLUMN charging_sessions.miles_added IS 'Range gained in miles per useSettings.convertDistance convention.';

CREATE TRIGGER charging_sessions_set_updated_at
  BEFORE UPDATE ON charging_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_chg_sessions_vehicle_start ON charging_sessions (vehicle_id, start_ts DESC);
CREATE INDEX idx_chg_sessions_open
  ON charging_sessions (vehicle_id) WHERE end_ts IS NULL;

-- Close the deferred FK from prompt 04 (charging_telemetry.session_id)
ALTER TABLE charging_telemetry
  ADD CONSTRAINT chg_telem_session_fk
  FOREIGN KEY (session_id) REFERENCES charging_sessions(id) ON DELETE SET NULL;
```

## Suggested Fix

1. Confirm `vehicles` and `charging_telemetry` exist.
2. Write file.
3. Apply.
4. Verify.
5. Commit.

## Acceptance Criteria

- [ ] File exists matching output
- [ ] `psql -f` succeeds
- [ ] Table `charging_sessions` exists
- [ ] CHECK on `charger_type` and `ended_status` applied
- [ ] CHECK on `end_ts IS NULL OR end_ts >= start_ts` applied
- [ ] Both indexes (general + partial open-session) present
- [ ] FK `chg_telem_session_fk` exists on `charging_telemetry` with `ON DELETE SET NULL`
- [ ] Trigger `charging_sessions_set_updated_at` registered
- [ ] **Zero** JSONB
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\12-charging-sessions.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

# Deferred FK now exists on charging_telemetry
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT conname, confdeltype FROM pg_constraint WHERE conrelid='charging_telemetry'::regclass AND contype='f' AND conname='chg_telem_session_fk';"
# Expected: 1 row, confdeltype='n' (SET NULL)

# Partial index for open sessions
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT indexdef FROM pg_indexes WHERE indexname='idx_chg_sessions_open';"
```

## Out of Scope

- Don't add per-supercharger pricing — that's `electricity_cost` in `23-create-system-tables`.
- Don't add `payment_method` — out of scope for Phase 3.
- Don't backfill cost from prior data — runtime concern.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/12-charging-sessions.sql
git commit -m "schema(db-refactor): add charging_sessions table + close telemetry FK

One row per charging session. Closes deferred charging_telemetry.session_id
FK from prompt 04 (ON DELETE SET NULL — telemetry survives session deletion).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-001-jsonb-policy.md`
- Repo memory: distance values stored in miles
