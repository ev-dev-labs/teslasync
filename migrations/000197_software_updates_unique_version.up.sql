-- Migration 197: Deduplicate software_updates and enforce UNIQUE (vehicle_id, version).
--
-- Surfaced in production when the Software Updates page rendered 50 rows
-- of the SAME firmware version (e.g. "2026.14.3") for one vehicle. Root
-- cause: TelemetryHandler.trackVehicleConfig spawns a goroutine on every
-- payload that includes a Version field; SoftwareUpdateRepo.InsertIfChanged
-- did "SELECT latest, then INSERT if different" non-atomically. Under the
-- per-field MQTT firehose (Phase-72…77 cutover) several payloads land in
-- flight simultaneously, all SELECTs return the SAME pre-INSERT latest,
-- all comparisons see "new version differs", all INSERTs proceed.
--
-- The schema previously had no UNIQUE constraint to backstop the racy
-- code, so the database happily accepted the duplicates. This migration
-- (a) drops the existing duplicates keeping the EARLIEST row per
-- (vehicle_id, version) so the timeline still reflects the moment a
-- version was first observed, and (b) adds a UNIQUE INDEX on
-- (vehicle_id, version) so the database itself enforces the invariant.
-- The companion repo refactor switches InsertIfChanged to an atomic
-- INSERT … ON CONFLICT DO NOTHING that depends on this index.
--
-- Trade-off: a real reinstall of the SAME version (rollback then
-- reinstall) will no longer produce a second row. For OTA firmware
-- tracking we care about version transitions, not reinstall counts;
-- if reinstall tracking is ever needed, the unique key can be widened
-- (e.g. include installed_at::date).

-- Dedupe: keep the earliest row per (vehicle_id, version). MIN(created_at)
-- is the natural choice — that's when the version was first observed.
-- Using id-tiebreak via MIN(id) keeps the deletion deterministic when two
-- rows somehow share a created_at to microsecond precision.
DELETE FROM software_updates s
USING (
    SELECT vehicle_id, version, MIN(id) AS keep_id
    FROM software_updates
    GROUP BY vehicle_id, version
    HAVING COUNT(*) > 1
) dups
WHERE s.vehicle_id = dups.vehicle_id
  AND s.version    = dups.version
  AND s.id        <> dups.keep_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_software_updates_vehicle_version
    ON software_updates (vehicle_id, version);
