-- Phase-46 / Prompt 04 rollback: drop the operator-controlled service
-- mode row (any unsaved banner content is lost — operators should
-- record the prior state before downgrading).
BEGIN;

DROP TABLE IF EXISTS system_state;

COMMIT;
