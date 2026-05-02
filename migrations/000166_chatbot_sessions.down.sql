BEGIN;

DROP INDEX IF EXISTS idx_chatbot_sessions_updated_at;
DROP TABLE IF EXISTS chatbot_sessions;

COMMIT;
