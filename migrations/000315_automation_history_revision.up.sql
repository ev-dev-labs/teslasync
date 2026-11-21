ALTER TABLE automation_history ADD COLUMN automation_revision timestamptz;

COMMENT ON COLUMN automation_history.automation_revision IS
    'Revision of the evaluated rule snapshot; NULL for runs without verified revision provenance.';
