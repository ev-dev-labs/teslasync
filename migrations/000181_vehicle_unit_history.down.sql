-- Phase-42 / Prompt 0022: drop vehicle_unit_history.
--
-- Restoring this requires re-running the REST bootstrap (prompt 0023)
-- AND replaying every Setting*Unit signal from the source-of-truth
-- signal_log since the table was first populated. Bootstrap is the
-- faster path: it pulls current state from Tesla's REST API and seeds
-- every (vehicle, unit_kind) with a single SourceRESTBootstrap row at
-- time.Now(). After the bootstrap, normal MQTT ingest resumes and the
-- live history rebuilds organically.
DROP TABLE IF EXISTS vehicle_unit_history;
