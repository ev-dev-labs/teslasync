-- Remove daily cascading continuous aggregates.
SELECT public.remove_retention_policy('public.cagg_charging_daily', if_exists => TRUE);
SELECT public.remove_retention_policy('public.cagg_climate_daily',  if_exists => TRUE);

SELECT public.remove_continuous_aggregate_policy('public.cagg_charging_daily', if_exists => TRUE);
SELECT public.remove_continuous_aggregate_policy('public.cagg_climate_daily',  if_exists => TRUE);

DROP MATERIALIZED VIEW IF EXISTS public.cagg_charging_daily;
DROP MATERIALIZED VIEW IF EXISTS public.cagg_climate_daily;
