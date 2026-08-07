-- Journey Details still showed an identical Start and Destination after the
-- place-label rewrite (migration 000226), including on drives covering many
-- miles between two clearly different places.
--
-- Re-labelling could never have fixed those rows. The geocoder is handed
-- drives.start_lat/start_lng and drives.end_lat/end_lng, and completion can
-- persist the same fix into both pairs when the drive's boundary moments carry
-- no Location sample and the point-in-time snapshot fallback resolves to one
-- position. A repair pass then reads those two identical coordinate pairs and
-- faithfully writes the identical label into start_place and end_place. The
-- route map hid the problem because it renders the recorded GPS track rather
-- than the stored endpoint columns.
--
-- The code now corrects a drive's endpoints from its track before geocoding.
-- Revision 3 exists to requeue the rows that revision 2 already marked as
-- current, so they are re-resolved once with corrected coordinates.
--
-- Only rows that can actually be affected are requeued. Re-geocoding the whole
-- table would take one provider request per endpoint at roughly one request per
-- second, so the backlog is restricted to drives whose endpoints cannot
-- describe two distinct places: identical labels, identical coordinates, or a
-- missing endpoint.
UPDATE drives
SET place_label_version = 0
WHERE place_label_version >= 2
  AND (
        start_place IS NOT DISTINCT FROM end_place
     OR (start_lat IS NOT DISTINCT FROM end_lat AND start_lng IS NOT DISTINCT FROM end_lng)
     OR start_lat IS NULL OR start_lng IS NULL
     OR end_lat IS NULL OR end_lng IS NULL
  );

ALTER TABLE drives ALTER COLUMN place_label_version SET DEFAULT 3;

-- The 000226 index is partial on `place_label_version < 2`, which cannot serve
-- the `< 3` backlog query, so it is replaced rather than kept alongside.
DROP INDEX IF EXISTS idx_drives_place_label_stale;
CREATE INDEX IF NOT EXISTS idx_drives_place_label_stale_v3
    ON drives (id DESC)
    WHERE place_label_version < 3;
