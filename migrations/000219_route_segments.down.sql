-- Migration 219: Route segments (rollback).
--
-- Drops the Ghost Racing / EV Segments identity table (and its two indexes,
-- which fall with the table). IF EXISTS keeps the rollback a safe no-op on a
-- database where the up migration never ran. Segments are DERIVED from the
-- drives table, so dropping this cache loses only the stable segment ids and the
-- best-effort persisted rows — the Ghost Racing endpoints degrade to a 500 (the
-- list can no longer UPSERT / address segments) until the up migration is
-- re-applied, which is the intended "feature removed" state for a down migration.

DROP TABLE IF EXISTS route_segments;
