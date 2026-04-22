---
description: "Phase 3 — Create automation_actions (THE ONLY JSONB carve-out in the schema)"
---

# 🟡 Schema 16 — `automation_actions` (Sole JSONB Carve-Out)

> **Severity:** Architecturally significant — the **only** JSONB column in the entire schema
> **Priority:** High (the carve-out invariant in prompt 99 fails if this is wrong)
> **Category:** Phase 3 — Schema (class table inheritance child)
> **Prompt #:** 17 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/16-automation-actions.sql` |
| Depends on | `14-create-automations-parent` (provides `automation_steps` FK target), `01-create-vehicles` (provides `set_updated_at()` trigger fn) |
| Blocks | `99-validate-zero-jsonb-invariant` (the invariant query specifically expects this column) |
| ADR refs | ADR-001 (JSONB policy), ADR-004 (automation schema with full DDL example) |
| Estimated effort | small (~30 min) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/16-automation-actions.sql` containing the `automation_actions` table — the **only** JSONB column permitted in the entire database schema (`command_params`).

## What's Being Established

ADR-001 establishes "typed-by-default with documented exceptions." ADR-004 establishes that exactly one column qualifies for the exception: `automation_actions.command_params`.

## Why This Gets the Carve-Out

Tesla's command API takes a free-form params object that varies per command:
- `set_temps` → `{driver_temp, passenger_temp}`
- `charge_max_range` → `{}`
- `window_control` → `{command, lat, lon, distance}`
- `remote_seat_heater_request` → `{heater, level}`

Modelling each command's params as typed columns would require ~30 child tables for ~30 commands, most of which Tesla revises without coordination. ADR-004 accepts JSONB here as the lesser evil — but **read-only**: the application never queries inside `command_params`, only passes it through to the Tesla command client.

## Recommendation

- `command_params` is `jsonb NOT NULL DEFAULT '{}'::jsonb` — empty object is valid (some commands take no params).
- `command_name` is `text` with a `CHECK` constraint enumerating the closed list from `internal/tesla/client.go` `commandMap`. Adding a new command requires updating the CHECK in lockstep.
- The JSONB carve-out **must** carry a `COMMENT ON COLUMN` explicitly invoking ADR-001 + ADR-004 — prompt 99 greps for this phrase.
- No GIN index on `command_params` — we never query inside it.

## Output (full file contents)

```sql
-- =========================================================================
-- 16 — automation_actions (only JSONB carve-out in the schema)
-- ADR-001 + ADR-004: command_params is intentionally jsonb because Tesla
-- command parameters vary per command and Tesla revises the contract
-- without coordination. The application is contractually forbidden from
-- using this column in WHERE / GROUP BY / ORDER BY (audit checks this).
-- =========================================================================

CREATE TABLE automation_actions (
  id              bigint           PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  step_id         bigint           NOT NULL REFERENCES automation_steps(id) ON DELETE CASCADE,
  command_name    text             NOT NULL
                                   CHECK (command_name IN (
                                     -- Keep in sync with internal/tesla/client.go commandMap.
                                     -- Adding a new command requires updating this CHECK.
                                     'wake_up',
                                     'honk_horn',
                                     'flash_lights',
                                     'door_lock',
                                     'door_unlock',
                                     'actuate_trunk',
                                     'window_control',
                                     'sun_roof_control',
                                     'remote_start_drive',
                                     'set_charge_limit',
                                     'charge_start',
                                     'charge_stop',
                                     'charge_port_door_open',
                                     'charge_port_door_close',
                                     'set_temps',
                                     'auto_conditioning_start',
                                     'auto_conditioning_stop',
                                     'set_climate_keeper_mode',
                                     'remote_seat_heater_request',
                                     'remote_steering_wheel_heater_request',
                                     'media_toggle_playback',
                                     'media_next_track',
                                     'media_prev_track',
                                     'navigation_request',
                                     'set_valet_mode',
                                     'reset_valet_pin',
                                     'set_sentry_mode',
                                     'schedule_software_update',
                                     'cancel_software_update'
                                   )),
  command_params  jsonb            NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz      NOT NULL DEFAULT now(),
  updated_at      timestamptz      NOT NULL DEFAULT now()
);

COMMENT ON TABLE automation_actions IS
  'Per-step Tesla command invocation. Parented to automation_steps via step_id. '
  'One automation_steps row may be parent to exactly one of: condition, action, delay (CTI per ADR-004).';

COMMENT ON COLUMN automation_actions.command_name IS
  'Tesla command identifier. Must match an entry in internal/tesla/client.go commandMap. '
  'CHECK constraint enforces a closed enumeration.';

COMMENT ON COLUMN automation_actions.command_params IS
  'JSONB carve-out per ADR-001/ADR-004 — never use in WHERE/GROUP BY/ORDER BY in production. '
  'Schema-on-read: parsed by the Tesla client adapter at command-send time. '
  'Audit query SELECT count(*) FROM information_schema.columns WHERE data_type IN (''jsonb'',''json'') '
  'must return exactly 1, and that 1 must be this column.';

-- updated_at maintenance trigger (shared trigger function defined in 01-vehicles.sql)
CREATE TRIGGER trg_automation_actions_set_updated_at
  BEFORE UPDATE ON automation_actions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_automation_actions_step_id ON automation_actions(step_id);
```

## Suggested Fix (implementation steps)

1. **Cross-check `commandMap`** — open `internal/tesla/client.go` and confirm the CHECK list above matches. If a command is missing or renamed, fix the file before writing.
2. **Confirm `set_updated_at()` exists** in the throwaway DB:
   ```powershell
   docker exec ts-schema-validate psql -U postgres -d v -c `
     "SELECT proname FROM pg_proc WHERE proname = 'set_updated_at';"
   ```
   If empty, prompt `01-create-vehicles` (which defines it) hasn't been applied — stop and run that first.
3. **Confirm `automation_steps` exists** (FK target):
   ```powershell
   docker exec ts-schema-validate psql -U postgres -d v -c "\dt automation_steps"
   ```
4. Write the file contents above to `schema/16-automation-actions.sql`.
5. Apply and verify (below).
6. Commit (boilerplate at bottom).

## Acceptance Criteria

- [ ] File `schema/16-automation-actions.sql` exists and matches the output above exactly
- [ ] `psql -f` succeeds with zero errors
- [ ] **Exactly one** column on this table has `data_type = 'jsonb'`, and it is `command_params`
- [ ] The `COMMENT ON COLUMN` for `command_params` contains the literal phrase `JSONB carve-out per ADR-001/ADR-004`
- [ ] The CHECK constraint enumerates exactly the commands present in `internal/tesla/client.go` `commandMap` (no missing, no extras)
- [ ] FK `step_id → automation_steps(id)` is `ON DELETE CASCADE`
- [ ] Trigger `trg_automation_actions_set_updated_at` exists and fires `BEFORE UPDATE`
- [ ] Index `idx_automation_actions_step_id` exists
- [ ] No other indexes (especially no GIN on `command_params`)
- [ ] File is committed with the boilerplate message below

## Verification

```powershell
# Apply
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\16-automation-actions.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

# Exactly one jsonb column on this table
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'automation_actions' AND data_type IN ('jsonb','json');"
# Expected: 1 row — command_params | jsonb

# Carve-out comment is in place with the required phrase
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT col_description('automation_actions'::regclass, attnum) AS comment FROM pg_attribute WHERE attrelid = 'automation_actions'::regclass AND attname = 'command_params';"
# Expected: a string containing 'JSONB carve-out per ADR-001/ADR-004'

# CHECK constraint definition
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'automation_actions'::regclass AND contype = 'c';"

# FK ON DELETE behavior
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = 'automation_actions'::regclass AND contype = 'f';"
# Expected: confdeltype 'c' (CASCADE)

# Trigger present
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT tgname FROM pg_trigger WHERE tgrelid = 'automation_actions'::regclass AND NOT tgisinternal;"
# Expected: trg_automation_actions_set_updated_at
```

## Out of Scope (reject if asked)

- Don't widen the CHECK list speculatively. Adding a command requires updating `commandMap` in Go and re-running this prompt.
- Don't add a GIN index on `command_params` — we don't query into it (that's the contract).
- Don't add a JSONB schema validator (`CHECK (jsonb_typeof(command_params) = 'object')`). The application owns this contract; we don't double-enforce.
- Don't add other JSONB columns. The audit query in prompt 99 will fail if you do.
- Don't add columns that belong on the parent (`automation_steps`) — execution order, retry policy, etc. live there.
- Don't `CREATE FUNCTION set_updated_at()` here — it's defined once in `01-create-vehicles.sql` and reused.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/16-automation-actions.sql
git commit -m "schema(db-refactor): add automation_actions (sole JSONB carve-out)

ADR-001 + ADR-004. command_params is the ONE permitted jsonb column.
CHECK constraint pins command_name to the closed list of Tesla commands
in internal/tesla/client.go commandMap. updated_at maintained by trigger.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-001-jsonb-policy.md` — typed-by-default policy with documented exceptions
- `.github/prompts/db-refactor/adrs/ADR-004-automation-schema.md` — full DDL example for the class table inheritance pattern
- `internal/tesla/client.go` — source of truth for the `commandMap` enumeration
- `.github/prompts/db-refactor/phase-3-schema/99-validate-zero-jsonb-invariant.prompt.md` — the gate that grep-checks the carve-out comment
