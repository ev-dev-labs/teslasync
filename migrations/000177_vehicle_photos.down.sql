-- Phase-46 / Prompt 54 — rollback for vehicle_photos.
--
-- Drops the index. On-disk photo files under cfg.VehiclePhotoDir are
-- intentionally left in place — operators may want to keep the bytes
-- for a possible re-introduction of the feature.

DROP TABLE IF EXISTS vehicle_photos;
