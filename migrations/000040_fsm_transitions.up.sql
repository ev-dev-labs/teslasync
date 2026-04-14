-- Migration 040: Create fsm_transitions table for FSM history tracking
CREATE TABLE IF NOT EXISTS fsm_transitions (
    id          TEXT        PRIMARY KEY,
    entity_id   TEXT        NOT NULL,
    fsm_name    TEXT        NOT NULL,
    from_state  TEXT        NOT NULL,
    event       TEXT        NOT NULL,
    to_state    TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Composite index for debugger queries: filter by entity + type + time
CREATE INDEX IF NOT EXISTS idx_fsm_transitions_entity_type_time
    ON fsm_transitions (entity_id, fsm_name, created_at DESC);

-- Index for stats queries: count by fsm_name
CREATE INDEX IF NOT EXISTS idx_fsm_transitions_fsm_name
    ON fsm_transitions (fsm_name, created_at DESC);
