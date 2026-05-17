-- 000209_ai_call_log_provider_azure.down.sql
--
-- Revert the provider check constraint to the original Phase-50/F3
-- set. NOTE: any rows inserted with provider='azure' while the up
-- migration was applied will fail the constraint on re-add. This
-- down migration is therefore best-effort; running it requires
-- DELETE-ing or re-labelling Azure rows first.
ALTER TABLE ai_call_log
    DROP CONSTRAINT ai_call_log_provider_chk;

ALTER TABLE ai_call_log
    ADD CONSTRAINT ai_call_log_provider_chk
        CHECK (provider IN ('ollama','openai','anthropic','mock'));
