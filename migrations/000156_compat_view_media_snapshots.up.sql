-- Compatibility VIEW for media_snapshots after JSONB consolidation.
--
-- Migrations 000142–000144 moved 9 nullable media telemetry columns
-- (now-playing metadata, playback source, volume bounds) into a `signals`
-- JSONB column on media_snapshots and then dropped them. This view flattens
-- `signals` back to individual column names so that external consumers
-- (Grafana media/now-playing panels, ad-hoc BI queries, psql exploration)
-- keep working without modification. Internal Go code reads the `signals`
-- column directly via hydrateFromSignals and does not depend on this view.
--
-- The native core columns (playback_status, audio_volume) are passed through
-- unchanged; the remaining media signals are extracted from `signals` with
-- the same SQL types they had before the migration.

CREATE OR REPLACE VIEW v_media_snapshots AS
SELECT
    id,
    vehicle_id,
    -- Core columns (native)
    playback_status,
    audio_volume,
    -- Signals extracted back to column names
    signals->>'now_playing_title'                            AS now_playing_title,
    signals->>'now_playing_artist'                           AS now_playing_artist,
    signals->>'now_playing_album'                            AS now_playing_album,
    signals->>'now_playing_station'                          AS now_playing_station,
    (signals->>'now_playing_duration')::int                  AS now_playing_duration,
    (signals->>'now_playing_elapsed')::int                   AS now_playing_elapsed,
    signals->>'playback_source'                              AS playback_source,
    (signals->>'audio_volume_max')::double precision         AS audio_volume_max,
    (signals->>'audio_volume_increment')::double precision   AS audio_volume_increment,
    signals,
    created_at
FROM media_snapshots;

COMMENT ON VIEW v_media_snapshots IS
    'Compatibility view flattening media_snapshots.signals JSONB back to '
    'named columns. For use by Grafana media panels and ad-hoc SQL; Go code '
    'reads signals directly. See migration 000156.';
