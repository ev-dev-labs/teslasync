---
description: "Phase 3 — Create automation step condition child tables (CTI children for conditions)"
---

# 🟢 Schema 15 — `automation_step_condition_*` (CTI Condition Children)

> **Severity:** Standard (CTI children)
> **Priority:** Medium
> **Category:** Phase 3 — Schema (CTI children)
> **Prompt #:** 16 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/15-automation-conditions.sql` |
| Depends on | `14-create-automations-parent` (steps + enum), and one of the child tables references `places` from `23-create-system-tables` — see "Forward FK note" |
| Blocks | (none directly) |
| ADR refs | ADR-004 |
| Estimated effort | small (~30 min) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Forward FK Note

`automation_step_condition_geofence` references `places(id)`. `places` is created in prompt `23-create-system-tables.sql`. When applying schema files in numeric order, prompt 23 runs after this — so the `places` FK is **deferred** here and added in prompt 23 via `ALTER TABLE`. This file leaves the column without an FK constraint; prompt 23's "Suggested Fix" calls out the addition.

## Single Goal

Write `schema/15-automation-conditions.sql` containing the four condition CTI children: `signal`, `time_window`, `geofence`, `other_automation`.

## What's Being Established

Per ADR-004, every condition kind has its own child table. Each row PK = `step_id` (1:1 with `automation_steps`). Operator + value columns are typed (`value_text`/`value_num`/`value_bool` with `value_min`/`value_max` for `between` operator).

## Recommendation

- Each child table PK is `step_id` (1:1 with steps)
- FKs to `automation_steps(id) ON DELETE CASCADE` — deleting a step removes its detail
- `op` columns are `text` + CHECK (closed list)
- `days_of_week smallint[]` is acceptable per ADR-004 (typed array, not jsonb)

## Output (full file contents)

```sql
-- =========================================================================
-- 15 — automation step condition children (4 tables)
-- ADR-004 CTI children for the 'condition_*' step kinds.
-- =========================================================================

CREATE TABLE automation_step_condition_signal (
  step_id    bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  signal     text             NOT NULL,
  op         text             NOT NULL CHECK (op IN ('=','!=','<','<=','>','>=','between','in')),
  value_text text,
  value_num  double precision,
  value_bool boolean,
  value_min  double precision,
  value_max  double precision,
  CHECK (op <> 'between' OR (value_min IS NOT NULL AND value_max IS NOT NULL))
);
COMMENT ON TABLE automation_step_condition_signal IS
  'CTI child for condition_signal kind. value_min/value_max only used when op = between.';

CREATE TABLE automation_step_condition_time_window (
  step_id      bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  start_time   time NOT NULL,
  end_time     time NOT NULL,
  timezone     text NOT NULL DEFAULT 'UTC',
  days_of_week smallint[] NOT NULL
                CHECK (days_of_week <@ ARRAY[0,1,2,3,4,5,6]::smallint[])
);
COMMENT ON TABLE  automation_step_condition_time_window IS
  'CTI child for condition_time_window. days_of_week: 0=Sun..6=Sat. Typed array, NOT jsonb.';
COMMENT ON COLUMN automation_step_condition_time_window.days_of_week IS
  'Subset of {0..6}. Empty array = always (no day filter).';

CREATE TABLE automation_step_condition_geofence (
  step_id  bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  -- FK to places(id) added in prompt 23 (forward dependency)
  place_id bigint NOT NULL,
  state    text   NOT NULL CHECK (state IN ('inside','outside','dwell'))
);
COMMENT ON TABLE  automation_step_condition_geofence IS
  'CTI child for condition_geofence. FK to places(id) deferred to prompt 23.';

CREATE TABLE automation_step_condition_other_automation (
  step_id          bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  other_automation_id bigint NOT NULL REFERENCES automations(id) ON DELETE RESTRICT,
  state            text NOT NULL CHECK (state IN ('enabled','disabled','recently_triggered'))
);
COMMENT ON TABLE automation_step_condition_other_automation IS
  'CTI child for condition_other_automation. RESTRICT delete: cannot delete an automation referenced by another.';

CREATE INDEX idx_cond_signal_signal ON automation_step_condition_signal (signal);
CREATE INDEX idx_cond_geofence_place ON automation_step_condition_geofence (place_id);
```

## Suggested Fix

1. Confirm `automations` and `automation_steps` exist.
2. Write file.
3. Apply.
4. Verify.
5. Commit.

## Acceptance Criteria

- [ ] File exists matching output
- [ ] `psql -f` succeeds
- [ ] All 4 child tables created
- [ ] Each PK is `step_id` (1:1)
- [ ] All FKs to `automation_steps` are CASCADE
- [ ] FK from `condition_other_automation.other_automation_id` is RESTRICT
- [ ] CHECK on `op` (8 operators) applied
- [ ] CHECK on `days_of_week <@ ARRAY[0..6]` applied
- [ ] CHECK on `between` op requiring `value_min/value_max` applied
- [ ] **Zero** JSONB
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\15-automation-conditions.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

# 4 child tables
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'automation_step_condition_%' ORDER BY table_name;"
# Expected: 4 rows

# RESTRICT FK on other_automation
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT confdeltype FROM pg_constraint WHERE conrelid='automation_step_condition_other_automation'::regclass AND contype='f' AND conname LIKE '%other_automation%';"
# Expected: 'r'
```

## Out of Scope

- Don't create trigger/action child tables — those are prompts 16 and 17.
- Don't add a `placeholder` column — keep tables narrow per kind.
- Don't add the `places` FK now — added by ALTER in prompt 23.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/15-automation-conditions.sql
git commit -m "schema(db-refactor): add automation condition CTI children

ADR-004: 4 child tables for condition_signal, condition_time_window,
condition_geofence, condition_other_automation. Geofence FK to places
deferred to prompt 23 (forward dep).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-004-automation-schema.md`
- `.github/prompts/db-refactor/phase-3-schema/23-create-system-tables.prompt.md` (places FK closure)
