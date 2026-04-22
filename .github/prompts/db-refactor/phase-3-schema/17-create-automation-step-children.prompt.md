---
description: "Phase 3 — Create remaining automation step children (triggers + non-action remaining actions)"
---

# 🟢 Schema 17 — Remaining Automation Step Children (Triggers + Other Actions)

> **Severity:** Standard (CTI children)
> **Priority:** Medium
> **Category:** Phase 3 — Schema (CTI children)
> **Prompt #:** 18 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/17-automation-step-children.sql` |
| Depends on | `14-create-automations-parent` |
| Blocks | (none directly) |
| ADR refs | ADR-004 |
| Estimated effort | small (~40 min — multiple tables) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Forward FK Note

`automation_step_trigger_geofence` references `places(id)` (deferred to prompt 23). `automation_step_action_notify` references `notification_channels(id)` (closed in prompt 19 — runs after this; deferred via ALTER in prompt 19).

## Single Goal

Write `schema/17-automation-step-children.sql` containing all remaining CTI children: 4 trigger child tables + 2 non-`command` action child tables (`notify`, `set_setting`, `call_automation`). The `command` action lives in prompt 16 (the JSONB carve-out) which has already been written.

## What's Being Established

Completes the CTI tree from ADR-004. After this prompt, every value of `automation_step_kind` enum has exactly one corresponding child table.

## Recommendation

- One table per remaining kind: `trigger_signal`, `trigger_geofence`, `trigger_schedule`, `trigger_event`, `action_notify`, `action_set_setting`, `action_call_automation`
- All PKs = `step_id` (1:1)
- All FKs to `automation_steps` are CASCADE
- Defer `notification_channels` and `places` FKs (added in prompts 19 and 23)

## Output (full file contents)

```sql
-- =========================================================================
-- 17 — remaining automation step CTI children
-- ADR-004 — completes the CTI tree for all step kinds except action_command
-- (action_command is prompt 16, the sole JSONB carve-out).
-- =========================================================================

-- ============= TRIGGER children =============

CREATE TABLE automation_step_trigger_signal (
  step_id    bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  signal     text NOT NULL,
  op         text NOT NULL CHECK (op IN ('=','!=','<','<=','>','>=','changed','crossed_above','crossed_below')),
  value_text text,
  value_num  double precision,
  value_bool boolean
);
COMMENT ON TABLE automation_step_trigger_signal IS 'CTI child for trigger_signal kind.';
CREATE INDEX idx_trig_signal_signal ON automation_step_trigger_signal (signal);

CREATE TABLE automation_step_trigger_geofence (
  step_id  bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  place_id bigint NOT NULL,                   -- FK added in prompt 23 (forward dep)
  event    text NOT NULL CHECK (event IN ('enter','exit','dwell'))
);
COMMENT ON TABLE automation_step_trigger_geofence IS 'CTI child for trigger_geofence. FK to places(id) deferred to prompt 23.';
CREATE INDEX idx_trig_geofence_place ON automation_step_trigger_geofence (place_id);

CREATE TABLE automation_step_trigger_schedule (
  step_id   bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  cron_expr text NOT NULL,
  timezone  text NOT NULL DEFAULT 'UTC'
);
COMMENT ON TABLE automation_step_trigger_schedule IS 'CTI child for trigger_schedule kind. cron_expr validated by Go cron parser at write time.';

CREATE TABLE automation_step_trigger_event (
  step_id    bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  event_type text NOT NULL
              CHECK (event_type IN ('drive_start','drive_end','charge_start','charge_end','sleep_start','sleep_end','online','offline','sentry_alert'))
);
COMMENT ON TABLE automation_step_trigger_event IS 'CTI child for trigger_event kind. Closed event vocabulary.';

-- ============= ACTION children (excluding action_command which is prompt 16) =============

CREATE TABLE automation_step_action_notify (
  step_id    bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  channel_id bigint NOT NULL,                 -- FK to notification_channels(id) deferred to prompt 19
  template   text NOT NULL
);
COMMENT ON TABLE automation_step_action_notify IS
  'CTI child for action_notify. template = mustache-style string, NOT json. FK to notification_channels deferred to prompt 19.';

CREATE TABLE automation_step_action_set_setting (
  step_id     bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  setting_key text NOT NULL,
  value_text  text,
  value_num   double precision,
  value_bool  boolean
);
COMMENT ON TABLE automation_step_action_set_setting IS
  'CTI child for action_set_setting. setting_key matches a row in settings table; runtime validates type matches value_*.';

CREATE TABLE automation_step_action_call_automation (
  step_id            bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  target_automation_id bigint NOT NULL REFERENCES automations(id) ON DELETE RESTRICT
);
COMMENT ON TABLE automation_step_action_call_automation IS
  'CTI child for action_call_automation. RESTRICT — cannot delete an automation called by another.';
```

## Suggested Fix

1. Confirm prompt 14 was applied (`automations`, `automation_steps`, enum exist).
2. Write file.
3. Apply.
4. Verify.
5. Commit.

## Acceptance Criteria

- [ ] File exists matching output
- [ ] `psql -f` succeeds
- [ ] 7 child tables created (4 triggers + 3 actions)
- [ ] Together with prompt 15 (4 conditions) + prompt 16 (1 action_command) = **12 child tables total** — one per `automation_step_kind` value
- [ ] All FKs to `automation_steps` are CASCADE
- [ ] `target_automation_id` FK is RESTRICT
- [ ] All `op`/`event`/`event_type` CHECK constraints applied
- [ ] **Zero** JSONB
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\17-automation-step-children.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

# Total step child tables = 12 (matches enum cardinality)
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'automation_step_%' AND table_name NOT IN ('automation_steps');"
# Expected: 12

# RESTRICT on call_automation
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT confdeltype FROM pg_constraint WHERE conrelid='automation_step_action_call_automation'::regclass AND contype='f' AND conname LIKE '%target%';"
# Expected: 'r'
```

## Out of Scope

- Don't add `automation_executions` audit history — defer to a future prompt.
- Don't add cron expression validation as a CHECK — Go cron parser handles this.
- Don't add the `notification_channels` and `places` FKs now — added by ALTER in prompts 19 and 23.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/17-automation-step-children.sql
git commit -m "schema(db-refactor): add remaining automation step CTI children

7 tables: trigger_signal, trigger_geofence, trigger_schedule, trigger_event,
action_notify, action_set_setting, action_call_automation. Together with
prompts 15 and 16, all 12 step kinds have a child table. Forward FKs to
notification_channels (prompt 19) and places (prompt 23) deferred via ALTER.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-004-automation-schema.md`
- `.github/prompts/db-refactor/phase-3-schema/16-create-automation-actions.prompt.md` (action_command — JSONB carve-out)
