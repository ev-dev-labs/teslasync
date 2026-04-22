# ADR-004: Automation Schema — Class Table Inheritance

**Status:** Accepted (2026-04-22)
**Date:** 2026-04-22
**Owner:** Backend
**Depends on:** ADR-001

---

## Context

Current schema (migration `000109_add_automations.up.sql`) models automations with three JSONB columns:

```sql
CREATE TABLE automations (
  id           bigint PRIMARY KEY,
  name         text NOT NULL,
  enabled      boolean NOT NULL DEFAULT true,
  trigger_config  jsonb NOT NULL,    -- variable shape per trigger kind
  conditions      jsonb NOT NULL,    -- array of conditions
  actions         jsonb NOT NULL,    -- ordered array of actions
  ...
);
```

Problems:
- Validation is in Go (no DB-level integrity)
- Cannot index on trigger type, condition signal, or action command
- Editing in the UI requires a custom JSON editor — error-prone
- Composing rule-builder UIs against jsonb is fragile
- Versioning a rule (audit trail) means snapshotting the entire JSON — expensive

The structure of automations is **not actually variable** — it's polymorphic across a known, finite set of trigger/condition/action kinds. That's a textbook case for **class table inheritance** (CTI):

- A parent `automations` table holds shared fields (name, enabled, owner)
- An `automation_steps` table normalizes the linear sequence (step_order, kind discriminator)
- Per-kind child tables hold the typed fields specific to each kind (trigger_signal, condition_time_window, action_command, etc.)

The single legitimate exception is **Tesla command parameters**. Tesla's Fleet command API accepts per-command parameter shapes defined externally (e.g., `set_temps {driver_temp, passenger_temp}` vs `door_unlock {}` vs `window_control {command, lat, lon}`). Modeling each Tesla command as a separate child table means every new Tesla command requires a schema migration. That trades operational rigidity for type safety in a part of the system where Tesla, not us, controls the contract.

## Decision

**Use class table inheritance for triggers, conditions, and actions. Grant ONE JSONB carve-out: `automation_actions.command_params jsonb` for Tesla command parameters.**

### Schema (logical — exact DDL in Phase 3)

```sql
-- Parent
CREATE TABLE automations (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name            text NOT NULL,
  description     text,
  enabled         boolean NOT NULL DEFAULT true,
  owner_user_id   bigint REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Linear sequence: trigger(s) → condition(s) → action(s)
-- Each step belongs to exactly one kind via discriminator
CREATE TYPE automation_step_kind AS ENUM (
  'trigger_signal', 'trigger_geofence', 'trigger_schedule', 'trigger_event',
  'condition_signal', 'condition_time_window', 'condition_geofence', 'condition_other_automation',
  'action_command', 'action_notify', 'action_set_setting', 'action_call_automation'
);

CREATE TABLE automation_steps (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  automation_id   bigint NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  step_order      integer NOT NULL,
  kind            automation_step_kind NOT NULL,
  UNIQUE (automation_id, step_order)
);

-- Per-kind child tables (one row per step of that kind)
CREATE TABLE automation_step_trigger_signal (
  step_id    bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  signal     text NOT NULL,
  op         text NOT NULL CHECK (op IN ('=', '!=', '<', '<=', '>', '>=', 'changed', 'crossed_above', 'crossed_below')),
  value_text text,
  value_num  double precision,
  value_bool boolean
  -- exactly one of value_* should be set for ops that need a value
);

CREATE TABLE automation_step_trigger_geofence (
  step_id   bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  place_id  bigint NOT NULL REFERENCES places(id),
  event     text NOT NULL CHECK (event IN ('enter', 'exit', 'dwell'))
);

CREATE TABLE automation_step_trigger_schedule (
  step_id  bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  cron_expr text NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC'
);

CREATE TABLE automation_step_condition_signal (
  step_id   bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  signal    text NOT NULL,
  op        text NOT NULL CHECK (op IN ('=', '!=', '<', '<=', '>', '>=', 'between', 'in')),
  value_text text,
  value_num  double precision,
  value_bool boolean,
  value_min  double precision,    -- for 'between'
  value_max  double precision     -- for 'between'
);

CREATE TABLE automation_step_condition_time_window (
  step_id    bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  start_time time NOT NULL,
  end_time   time NOT NULL,
  days_of_week smallint[] NOT NULL  -- 0=Sun..6=Sat, typed array of small ints (NOT a JSONB use)
);

CREATE TABLE automation_step_action_command (
  step_id        bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  command        text NOT NULL,
  command_params jsonb NOT NULL DEFAULT '{}'::jsonb
  -- ^ JSONB CARVE-OUT (ADR-001). Reason: Tesla Fleet command API contract is external
  --   and unbounded. command_params must NEVER be queried with WHERE/GROUP BY in
  --   production code paths. Review date: 2027-04-22.
);

CREATE TABLE automation_step_action_notify (
  step_id    bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  channel_id bigint NOT NULL REFERENCES notification_channels(id),
  template   text NOT NULL  -- mustache-style template, NOT json
);

CREATE TABLE automation_step_action_set_setting (
  step_id     bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  setting_key text NOT NULL,
  value_text  text,
  value_num   double precision,
  value_bool  boolean
);
```

### Tags
Tags are a separate normalized table:
```sql
CREATE TABLE automation_tags (
  automation_id bigint NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  tag           text   NOT NULL,
  PRIMARY KEY (automation_id, tag)
);
```
No `tags jsonb` column anywhere.

### History
`automation_history_snapshots` becomes:
```sql
CREATE TABLE automation_executions (
  id            bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  automation_id bigint NOT NULL REFERENCES automations(id),
  triggered_at  timestamptz NOT NULL,
  trigger_step_id bigint REFERENCES automation_steps(id),
  status        text NOT NULL CHECK (status IN ('triggered','conditions_failed','executing','succeeded','failed','cancelled')),
  error_message text,
  duration_ms   integer
);
CREATE TABLE automation_execution_steps (
  execution_id bigint NOT NULL REFERENCES automation_executions(id) ON DELETE CASCADE,
  step_id      bigint NOT NULL REFERENCES automation_steps(id),
  step_order   integer NOT NULL,
  status       text NOT NULL CHECK (status IN ('skipped','succeeded','failed')),
  result_text  text,
  error_message text,
  PRIMARY KEY (execution_id, step_order)
);
```
No `context_snapshot jsonb`. Specific captured signals go into `automation_execution_signals(execution_id, signal_name, value_*)` if needed (TBD in Phase 3).

## Consequences

**Positive:**
- Every trigger/condition/action shape is type-checked at write time
- Indexes on signal name, command name, place_id, etc. — fast rule lookup
- UI rule builder generates pure SQL inserts, no JSON serialization
- Audit trail (executions) is rich and queryable
- Adding a new trigger/condition/action kind is a contained migration: enum value + child table + Go handler

**Negative:**
- More tables (~10 vs 1)
- Loading an automation requires a JOIN per kind — Go repo code is more complex
- The `automation_step_kind` enum requires a migration when adding kinds (acceptable — kinds are added rarely)

**Risks:**
- The single JSONB carve-out (`command_params`) could expand if Tesla adds many parameter shapes. Mitigation: review date in 12 months; if >20 distinct shapes seen, consider per-command child tables.
- Future "if/else" branching automations don't fit the linear `step_order` model. Mitigation: deferred — when needed, add a `parent_step_id` and `branch_kind` column.
