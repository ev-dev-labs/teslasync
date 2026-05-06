-- Phase-42 / Prompt 0033 (rollback).
-- Forward-only: there is no legacy schema to restore here. Rolling back
-- this migration leaves no drives / trips / trip_drives tables; any
-- consumer that requires them must re-apply the up.sql.
--
-- Order matters — drop the join first (so the trips and drives drops
-- are not blocked by inbound FKs), then trips (no inbound FK), then
-- drives. CASCADE handles any residual external FK (e.g. share_tokens
-- via 000125_add_share_tokens) the same way the up.sql does.
DROP TABLE IF EXISTS trip_drives CASCADE;
DROP TABLE IF EXISTS trips       CASCADE;
DROP TABLE IF EXISTS drives      CASCADE;
