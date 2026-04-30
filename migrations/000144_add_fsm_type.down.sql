DROP INDEX IF EXISTS idx_fsm_transitions_type;
ALTER TABLE fsm_transitions DROP COLUMN IF EXISTS fsm_type;
