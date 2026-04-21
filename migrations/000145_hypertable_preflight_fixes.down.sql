-- Revert composite primary keys back to single-column PKs.
--
-- WARNING: This rollback is ONLY safe if migration 000146_create_hypertables
-- has not yet been applied, OR has already been rolled back. TimescaleDB
-- hypertables require the partitioning column to be part of the PK; dropping
-- it from the PK on an active hypertable corrupts the table.

SET statement_timeout = 0;

BEGIN;

ALTER TABLE charging_telemetry DROP CONSTRAINT IF EXISTS charging_telemetry_pkey;
ALTER TABLE charging_telemetry ADD  PRIMARY KEY (id);

ALTER TABLE climate_snapshots DROP CONSTRAINT IF EXISTS climate_snapshots_pkey;
ALTER TABLE climate_snapshots ADD  PRIMARY KEY (id);

ALTER TABLE security_events DROP CONSTRAINT IF EXISTS security_events_pkey;
ALTER TABLE security_events ADD  PRIMARY KEY (id);

-- `positions` shipped with a composite PK in the baseline; keep it composite
-- on rollback so we do not regress the pre-existing schema.
ALTER TABLE positions DROP CONSTRAINT IF EXISTS positions_pkey;
ALTER TABLE positions ADD  PRIMARY KEY (id, created_at);

ALTER TABLE motor_snapshots DROP CONSTRAINT IF EXISTS motor_snapshots_pkey;
ALTER TABLE motor_snapshots ADD  PRIMARY KEY (id);

ALTER TABLE tire_pressure_snapshots DROP CONSTRAINT IF EXISTS tire_pressure_snapshots_pkey;
ALTER TABLE tire_pressure_snapshots ADD  PRIMARY KEY (id);

ALTER TABLE media_snapshots DROP CONSTRAINT IF EXISTS media_snapshots_pkey;
ALTER TABLE media_snapshots ADD  PRIMARY KEY (id);

ALTER TABLE safety_snapshots DROP CONSTRAINT IF EXISTS safety_snapshots_pkey;
ALTER TABLE safety_snapshots ADD  PRIMARY KEY (id);

-- Dropped inbound FKs and BEFORE triggers are NOT recreated here; the baseline
-- schema defined none, so this is a no-op in practice. If a downstream env
-- added any, recreate them manually from the audit report.

COMMIT;
