---
description: "Automations data model: database migrations for automations, automation_history, and related tables"
---

# Automations: Database Migrations

## Overview

Create the core database schema for the automations engine. This is the foundation
that all other automation prompts build on.

## Migration: `000109_add_automations.up.sql`

```sql
-- Core automations table
CREATE TABLE IF NOT EXISTS automations (
    id                  BIGSERIAL PRIMARY KEY,
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    vehicle_id          BIGINT REFERENCES vehicles(id) ON DELETE CASCADE,  -- NULL = all vehicles
    enabled             BOOLEAN NOT NULL DEFAULT true,

    -- Trigger
    trigger_type        TEXT NOT NULL,  -- 'cron', 'battery', 'vehicle_state', 'geofence', 'mqtt', 'webhook', 'sunrise_sunset', 'energy', 'calendar'
    trigger_config      JSONB NOT NULL DEFAULT '{}',

    -- Conditions (optional guards)
    conditions          JSONB NOT NULL DEFAULT '[]',  -- array of condition objects

    -- Actions
    actions             JSONB NOT NULL DEFAULT '[]',  -- ordered array of action objects

    -- Options
    cooldown_minutes    INTEGER NOT NULL DEFAULT 0,
    max_executions_hour INTEGER NOT NULL DEFAULT 0,   -- 0 = unlimited
    stop_on_failure     BOOLEAN NOT NULL DEFAULT false,
    notify_on_run       BOOLEAN NOT NULL DEFAULT false,
    notify_on_failure   BOOLEAN NOT NULL DEFAULT true,
    seasonal_start      INTEGER,  -- month 1-12, NULL = no seasonal restriction
    seasonal_end        INTEGER,  -- month 1-12
    priority            INTEGER NOT NULL DEFAULT 50,  -- 1=highest, 100=lowest

    -- State
    last_triggered_at   TIMESTAMPTZ,
    last_success_at     TIMESTAMPTZ,
    last_failure_at     TIMESTAMPTZ,
    execution_count     BIGINT NOT NULL DEFAULT 0,
    failure_count       BIGINT NOT NULL DEFAULT 0,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    auto_disabled       BOOLEAN NOT NULL DEFAULT false,
    auto_disabled_reason TEXT,

    -- Metadata
    preset_id           TEXT,  -- if created from a preset template
    tags                TEXT[] NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automations_vehicle ON automations (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_automations_enabled ON automations (enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_automations_trigger ON automations (trigger_type);

-- Execution history
CREATE TABLE IF NOT EXISTS automation_history (
    id                  BIGSERIAL PRIMARY KEY,
    automation_id       BIGINT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    automation_name     TEXT NOT NULL,
    vehicle_id          BIGINT,
    triggered_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    duration_ms         INTEGER,

    -- Trigger info
    trigger_type        TEXT NOT NULL,
    trigger_snapshot    JSONB NOT NULL DEFAULT '{}',  -- what triggered it (e.g., battery_level=19)

    -- Condition evaluation
    conditions_met      BOOLEAN NOT NULL DEFAULT true,
    conditions_snapshot JSONB NOT NULL DEFAULT '[]',  -- each condition's evaluation result

    -- Action results
    actions_executed    JSONB NOT NULL DEFAULT '[]',  -- [{action, status, error, duration_ms}]
    actions_total       INTEGER NOT NULL DEFAULT 0,
    actions_succeeded   INTEGER NOT NULL DEFAULT 0,
    actions_failed      INTEGER NOT NULL DEFAULT 0,

    -- Overall status
    status              TEXT NOT NULL DEFAULT 'running',  -- running, success, partial, failed, skipped, cancelled
    error               TEXT,

    -- FSM tracking
    fsm_state           TEXT,
    
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_history_automation ON automation_history (automation_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_history_status ON automation_history (status);
CREATE INDEX IF NOT EXISTS idx_automation_history_time ON automation_history (triggered_at DESC);

-- Automation variables (key-value store for cross-automation state)
CREATE TABLE IF NOT EXISTS automation_variables (
    id          BIGSERIAL PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE,
    value       TEXT NOT NULL DEFAULT '',
    vehicle_id  BIGINT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

And `000109_add_automations.down.sql`:
```sql
DROP TABLE IF EXISTS automation_variables;
DROP TABLE IF EXISTS automation_history;
DROP TABLE IF EXISTS automations;
```

## Models

In `internal/models/models.go`, add:

```go
type Automation struct {
    ID                   int64           `json:"id" db:"id"`
    Name                 string          `json:"name" db:"name"`
    Description          string          `json:"description" db:"description"`
    VehicleID            *int64          `json:"vehicle_id" db:"vehicle_id"`
    Enabled              bool            `json:"enabled" db:"enabled"`
    TriggerType          string          `json:"trigger_type" db:"trigger_type"`
    TriggerConfig        json.RawMessage `json:"trigger_config" db:"trigger_config"`
    Conditions           json.RawMessage `json:"conditions" db:"conditions"`
    Actions              json.RawMessage `json:"actions" db:"actions"`
    CooldownMinutes      int             `json:"cooldown_minutes" db:"cooldown_minutes"`
    MaxExecutionsHour    int             `json:"max_executions_hour" db:"max_executions_hour"`
    StopOnFailure        bool            `json:"stop_on_failure" db:"stop_on_failure"`
    NotifyOnRun          bool            `json:"notify_on_run" db:"notify_on_run"`
    NotifyOnFailure      bool            `json:"notify_on_failure" db:"notify_on_failure"`
    Priority             int             `json:"priority" db:"priority"`
    LastTriggeredAt      *time.Time      `json:"last_triggered_at" db:"last_triggered_at"`
    ExecutionCount       int64           `json:"execution_count" db:"execution_count"`
    FailureCount         int64           `json:"failure_count" db:"failure_count"`
    ConsecutiveFailures  int             `json:"consecutive_failures" db:"consecutive_failures"`
    AutoDisabled         bool            `json:"auto_disabled" db:"auto_disabled"`
    AutoDisabledReason   *string         `json:"auto_disabled_reason" db:"auto_disabled_reason"`
    PresetID             *string         `json:"preset_id" db:"preset_id"`
    Tags                 []string        `json:"tags" db:"tags"`
    CreatedAt            time.Time       `json:"created_at" db:"created_at"`
    UpdatedAt            time.Time       `json:"updated_at" db:"updated_at"`
}

type AutomationHistory struct {
    ID                int64           `json:"id" db:"id"`
    AutomationID      int64           `json:"automation_id" db:"automation_id"`
    AutomationName    string          `json:"automation_name" db:"automation_name"`
    VehicleID         *int64          `json:"vehicle_id" db:"vehicle_id"`
    TriggeredAt       time.Time       `json:"triggered_at" db:"triggered_at"`
    CompletedAt       *time.Time      `json:"completed_at" db:"completed_at"`
    DurationMs        *int            `json:"duration_ms" db:"duration_ms"`
    TriggerType       string          `json:"trigger_type" db:"trigger_type"`
    TriggerSnapshot   json.RawMessage `json:"trigger_snapshot" db:"trigger_snapshot"`
    ConditionsMet     bool            `json:"conditions_met" db:"conditions_met"`
    ActionsExecuted   json.RawMessage `json:"actions_executed" db:"actions_executed"`
    ActionsTotal      int             `json:"actions_total" db:"actions_total"`
    ActionsSucceeded  int             `json:"actions_succeeded" db:"actions_succeeded"`
    ActionsFailed     int             `json:"actions_failed" db:"actions_failed"`
    Status            string          `json:"status" db:"status"`
    Error             *string         `json:"error" db:"error"`
    FSMState          *string         `json:"fsm_state" db:"fsm_state"`
    CreatedAt         time.Time       `json:"created_at" db:"created_at"`
}
```

## Repository

Create `internal/database/automation_repo.go` with full CRUD:
- `Create(ctx, automation)` — INSERT RETURNING id
- `GetByID(ctx, id)` — single automation
- `GetAll(ctx, enabledOnly bool)` — list all
- `GetByVehicle(ctx, vehicleID)` — list for a vehicle
- `GetByTriggerType(ctx, triggerType)` — list by trigger
- `Update(ctx, automation)` — full update
- `SetEnabled(ctx, id, enabled)` — toggle
- `Delete(ctx, id)` — soft or hard delete
- `IncrementExecution(ctx, id, success bool)` — update counters + timestamps
- `SetAutoDisabled(ctx, id, reason)` — mark auto-disabled

Create `internal/database/automation_history_repo.go`:
- `Create(ctx, history)` — insert execution record
- `Complete(ctx, id, status, error, durationMs)` — update completion
- `GetByAutomation(ctx, automationID, limit, offset)` — paginated history
- `GetRecent(ctx, limit)` — recent across all automations

Create `internal/database/automation_variable_repo.go`:
- `Get(ctx, key)` / `Set(ctx, key, value)` / `Delete(ctx, key)`

## Verification

```bash
go build ./...
ls migrations/000109_add_automations.*
grep -n "AutomationRepo" internal/database/automation_repo.go
```
