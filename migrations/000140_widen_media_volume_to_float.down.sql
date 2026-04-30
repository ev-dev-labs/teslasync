-- Revert media audio volume columns back to INTEGER.

ALTER TABLE media_snapshots ALTER COLUMN audio_volume TYPE INTEGER USING audio_volume::INTEGER;
ALTER TABLE media_snapshots ALTER COLUMN audio_volume_max TYPE INTEGER USING audio_volume_max::INTEGER;

ALTER TABLE vehicle_live_state ALTER COLUMN media_audio_volume TYPE INTEGER USING media_audio_volume::INTEGER;
ALTER TABLE vehicle_live_state ALTER COLUMN media_audio_volume_increment TYPE INTEGER USING media_audio_volume_increment::INTEGER;
ALTER TABLE vehicle_live_state ALTER COLUMN media_audio_volume_max TYPE INTEGER USING media_audio_volume_max::INTEGER;
