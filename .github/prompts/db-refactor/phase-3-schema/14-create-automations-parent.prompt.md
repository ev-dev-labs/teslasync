---
description: "Phase 3 — Create automations parent table + automation_steps + step kind enum"
---

# 🔵 Schema 14 — `automations` Parent + `automation_steps` + Kind Enum

> **Severity:** Architectural (root of the class-table-inheritance tree per ADR-004)
> **Priority:** High — every step child table FKs here
> **Category:** Phase 3 — Schema (CTI parent)
> **Prompt #:** 15 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/14-automations.sql` |
| Depends on | `01-create-vehicles` (trigger fn) |
| Blocks | `15-create-automation-conditions`, `16-create-automation-actions`, `17-create-automation-step-children` |
| ADR refs | ADR-004 (full DDL example) |
| Estimated effort | small (~30 min) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/14-automations.sql` containing the `automations` parent table, the `automation_step_kind` ENUM type, the `automation_steps` discriminator table, and the `automation_tags` normalized table.

## What's Being Established

ADR-004 chose class-table-inheritance over JSONB. This file establishes the parent + discriminator infrastructure. Per-kind child tables (trigger_signal, condition_signal, action_command, etc.) follow in prompts 15-17.

## Recommendation

- `automation_step_kind` is a `CREATE TYPE … AS ENUM` (not text+CHECK) because the value list is fixed and used for joins
- `automation_steps` has `UNIQUE (automation_id, step_order)` — no two steps at the same position
- `automation_tags` is normalized — no `tags text[]` shortcut

## Output (full file contents)

```sql
-- =========================================================================
-- 14 — automations parent + steps + kind enum + tags
-- ADR-004 class table inheritance. Per-kind child tables follow in 15-17.
-- =========================================================================

CREATE TYPE automation_step_kind AS ENUM (
  'trigger_signal', 'trigger_geofence', 'trigger_schedule', 'trigger_event',
  'condition_signal', 'condition_time_window', 'condition_geofence', 'condition_other_automation',
  'action_command', 'action_notify', 'action_set_setting', 'action_call_automation'
);

COMMENT ON TYPE automation_step_kind IS
  'Closed enum. Adding a new kind requires a coordinated migration: ALTER TYPE … ADD VALUE plus a new child table.';

CREATE TABLE automations (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name            text             NOT NULL,
  description     text,
  enabled         boolean          NOT NULL DEFAULT true,
  vehicle_id      bigint           REFERENCES vehicles(id) ON DELETE CASCADE,
  created_at      timestamptz      NOT NULL DEFAULT now(),
  updated_at      timestamptz      NOT NULL DEFAULT now()
);

COMMENT ON TABLE  automations IS 'Class-table-inheritance root per ADR-004. vehicle_id NULL = applies to all vehicles.';
COMMENT ON COLUMN automations.vehicle_id IS 'NULL means the rule applies to every vehicle owned by the user.';

CREATE TRIGGER automations_set_updated_at
  BEFORE UPDATE ON automations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_automations_enabled  ON automations (enabled) WHERE enabled = true;
CREATE INDEX idx_automations_vehicle  ON automations (vehicle_id) WHERE vehicle_id IS NOT NULL;

CREATE TABLE automation_steps (
  id            bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  automation_id bigint               NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  step_order    integer              NOT NULL,
  kind          automation_step_kind NOT NULL,
  UNIQUE (automation_id, step_order)
);

COMMENT ON TABLE  automation_steps IS 'Discriminator. Each step has exactly one matching child row in the kind-specific table.';
COMMENT ON COLUMN automation_steps.kind IS 'ENUM. Determines which child table holds the typed fields for this step.';

CREATE INDEX idx_automation_steps_kind ON automation_steps (kind);

CREATE TABLE automation_tags (
  automation_id bigint NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  tag           text   NOT NULL,
  PRIMARY KEY (automation_id, tag)
);

COMMENT ON TABLE automation_tags IS 'Normalized tag list. No text[] shortcut.';

CREATE INDEX idx_automation_tags_tag ON automation_tags (tag);
```

## Suggested Fix

1. Confirm `vehicles` and `set_updated_at()` exist.
2. Write file.
3. Apply.
4. Verify.
5. Commit.

## Acceptance Criteria

- [ ] File exists matching output
- [ ] `psql -f` succeeds
- [ ] ENUM type `automation_step_kind` exists with all 12 values
- [ ] `automations` table FK to vehicles is CASCADE; `vehicle_id` is nullable
- [ ] `automation_steps` has UNIQUE (automation_id, step_order)
- [ ] `automation_tags` PK is composite (automation_id, tag)
- [ ] All three tables created
- [ ] Two partial indexes on `automations` registered
- [ ] **Zero** JSONB
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\14-automations.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

# ENUM has 12 values
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT count(*) FROM pg_enum WHERE enumtypid = 'automation_step_kind'::regtype;"
# Expected: 12

# UNIQUE constraint
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT conname FROM pg_constraint WHERE conrelid='automation_steps'::regclass AND contype='u';"

# 3 tables exist
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT table_name FROM information_schema.tables WHERE table_name IN ('automations','automation_steps','automation_tags') ORDER BY table_name;"
```

## Out of Scope

- Don't create per-kind child tables — those are prompts 15, 16, 17.
- Don't add `automation_executions` audit table — that's deferred to a future prompt (could be added to 17 or split off).
- Don't seed sample automations — runtime concern.
- Don't add `tags text[]` — ADR-004 explicitly forbids.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/14-automations.sql
git commit -m "schema(db-refactor): add automations parent + steps + kind enum + tags

ADR-004 class-table-inheritance root. ENUM with 12 step kinds.
Tags normalized to a join table (no text[]).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-004-automation-schema.md`
