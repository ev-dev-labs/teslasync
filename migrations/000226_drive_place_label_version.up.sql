-- Drives geocoded before the place-label rewrite stored road-level labels such
-- as "Bothell Everett Highway, Bothell" because every provider adapter
-- (Nominatim, Google, Azure) parsed the road and city but discarded the house
-- number and the point-of-interest name. Both ends of a drive along one road
-- therefore rendered as effectively the same string in Journey Details, which
-- is the bug this column exists to let us repair.
--
-- place_label_version records which labelling revision produced a row's
-- start_place / end_place. The startup repair re-resolves rows below the
-- current revision exactly once, instead of either leaving prod permanently
-- wrong or re-geocoding the whole table on every boot.
--
-- Adding the column with DEFAULT 0 lands every pre-existing row on 0 (stale).
-- Raising the default afterwards means drives written by the new code start at
-- the current revision and are never queued for repair.
ALTER TABLE drives ADD COLUMN IF NOT EXISTS place_label_version SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE drives ALTER COLUMN place_label_version SET DEFAULT 2;

-- Partial index over just the repair backlog: it stays tiny and drops to empty
-- once the repair drains, so the startup scan costs nothing thereafter.
CREATE INDEX IF NOT EXISTS idx_drives_place_label_stale
    ON drives (id DESC)
    WHERE place_label_version < 2;
