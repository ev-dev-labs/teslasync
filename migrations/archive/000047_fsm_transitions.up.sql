-- Unified FSM transition log for ALL state machines.
-- Every transition across vehicle FSM, drive/charge sub-FSMs, alert cooldown,
-- notification delivery, and command execution is logged here.
CREATE TABLE fsm_transitions (
    id                   BIGSERIAL PRIMARY KEY,
    vehicle_id           BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    fsm_type             VARCHAR(30) NOT NULL,   -- 'vehicle', 'drive_session', 'charge_session',
                                                  -- 'alert_cooldown', 'notification', 'command'
    fsm_instance_id      BIGINT,                 -- drive_id, charge_session_id, notification_id,
                                                  -- command_id, or NULL for vehicle FSM
    from_state           VARCHAR(30) NOT NULL,
    to_state             VARCHAR(30) NOT NULL,
    trigger              VARCHAR(50) NOT NULL,
    guard                VARCHAR(50),
    mode                 VARCHAR(20) NOT NULL DEFAULT 'immediate',
    context_snapshot     JSONB,                  -- type-specific data at transition time
    duration_in_state_ms BIGINT,                 -- how long in from_state before transitioning
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fsm_trans_vehicle_time ON fsm_transitions (vehicle_id, created_at DESC);
CREATE INDEX idx_fsm_trans_type ON fsm_transitions (fsm_type, created_at DESC);
CREATE INDEX idx_fsm_trans_instance ON fsm_transitions (fsm_type, fsm_instance_id)
    WHERE fsm_instance_id IS NOT NULL;
CREATE INDEX idx_fsm_trans_trigger ON fsm_transitions (trigger);
