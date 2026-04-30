ALTER TABLE fsm_transitions ADD COLUMN IF NOT EXISTS fsm_type TEXT NOT NULL DEFAULT 'vehicle';
CREATE INDEX IF NOT EXISTS idx_fsm_transitions_type ON fsm_transitions (vehicle_id, fsm_type, ts DESC);
