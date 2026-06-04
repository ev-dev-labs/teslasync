-- Rollback for 000217_signal_continuous_aggregates.up.sql.
--
-- Drops the two continuous aggregates created by the up migration. DROP
-- MATERIALIZED VIEW ... CASCADE also detaches each view's continuous-aggregate
-- refresh policy and internal materialization hypertable, so the up migration's
-- add_continuous_aggregate_policy wiring needs no separate removal here.
-- IF EXISTS keeps the rollback a clean no-op when the extension was absent at
-- up-time (the CAGGs would never have been created) and when re-run.
--
-- Drop order is irrelevant (the two views are independent), but the daily view
-- is dropped first to mirror the reverse of the up creation order. This
-- rollback is strictly scoped to objects this slot owns; canonical_signal and
-- its hypertable/retention wiring belong to 000215 / 000216 and are untouched.
DROP MATERIALIZED VIEW IF EXISTS cagg_canonical_signal_daily  CASCADE;
DROP MATERIALIZED VIEW IF EXISTS cagg_canonical_signal_hourly CASCADE;
