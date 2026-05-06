-- Phase-46 / Prompt 43 — rollback for vehicle_settings.
--
-- Hard-drops the table; the FK on vehicles(id) makes the cascade
-- automatic so there is nothing else to clean up.

DROP TABLE IF EXISTS vehicle_settings;
