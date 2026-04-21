-- Widen media audio volume columns from INTEGER to DOUBLE PRECISION.
-- Tesla sends fractional float values (e.g. 2.6667) that get rounded
-- when stored in INTEGER columns, causing data loss.

-- media_snapshots: audio_volume and audio_volume_max
ALTER TABLE media_snapshots ALTER COLUMN audio_volume TYPE DOUBLE PRECISION;
ALTER TABLE media_snapshots ALTER COLUMN audio_volume_max TYPE DOUBLE PRECISION;

-- vehicle_live_state: all three media_audio_volume columns
ALTER TABLE vehicle_live_state ALTER COLUMN media_audio_volume TYPE DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ALTER COLUMN media_audio_volume_increment TYPE DOUBLE PRECISION;
ALTER TABLE vehicle_live_state ALTER COLUMN media_audio_volume_max TYPE DOUBLE PRECISION;
