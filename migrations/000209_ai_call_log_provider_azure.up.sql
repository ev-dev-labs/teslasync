-- 000209_ai_call_log_provider_azure.up.sql
--
-- Phase-50 / F3 follow-up: extend the ai_call_log provider check
-- constraint to include Azure (introduced as a first-class provider
-- in Phase-50 / F1 — see internal/ai/provider/azure/azure.go and the
-- AzureAI provider config block in 000208_ai_provider_config_renest).
--
-- Before this migration the audit decorator silently failed to write
-- ai_call_log rows for Azure calls — the INSERT was rejected by the
-- check constraint with:
--
--     new row for relation "_hyper_39_NN_chunk" violates check
--     constraint "ai_call_log_provider_chk" (SQLSTATE 23514)
--
-- which the decorator only logged at WARN, so user requests still
-- completed but request metering / cost auditing for Azure was lost.
--
-- The replacement set is the canonical providers in F1's registry
-- (internal/ai/provider/registry.go) plus the eval mock — same shape
-- as 000203 with `azure` added.
--
-- DROP / ADD is atomic in a single transaction; existing rows do
-- not need to be re-validated because the new constraint is a
-- strict superset of the old one.
ALTER TABLE ai_call_log
    DROP CONSTRAINT ai_call_log_provider_chk;

ALTER TABLE ai_call_log
    ADD CONSTRAINT ai_call_log_provider_chk
        CHECK (provider IN ('ollama','openai','anthropic','azure','mock'));
