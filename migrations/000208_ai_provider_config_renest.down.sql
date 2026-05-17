-- 000208_ai_provider_config_renest.down.sql
--
-- Intentionally a no-op. See 000208_ai_provider_config_renest.up.sql
-- for the rationale. Reversing the conversion would lose any
-- non-default providers' configurations and is unsafe to automate.

SELECT 1;
