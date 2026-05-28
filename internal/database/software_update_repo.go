package database

import (
	"context"
	"errors"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	"github.com/jackc/pgx/v5"
)

type SoftwareUpdateRepo struct {
	db *DB
}

func NewSoftwareUpdateRepo(db *DB) *SoftwareUpdateRepo {
	return &SoftwareUpdateRepo{db: db}
}

func (r *SoftwareUpdateRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int, start, end time.Time) ([]*vehiclemodel.SoftwareUpdate, error) {
	hasRange := !start.IsZero() && !end.IsZero()
	var startArg, endArg interface{}
	if hasRange {
		startArg = start
		endArg = end
	}
	query := `SELECT id, vehicle_id, version, status, scheduled_at, installed_at, created_at
		FROM software_updates
		WHERE vehicle_id=$1
		  AND ($3::timestamptz IS NULL OR created_at BETWEEN $3 AND $4)
		ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit, startArg, endArg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var updates []*vehiclemodel.SoftwareUpdate
	for rows.Next() {
		u := &vehiclemodel.SoftwareUpdate{}
		if err := rows.Scan(&u.ID, &u.VehicleID, &u.Version, &u.Status, &u.ScheduledAt, &u.InstalledAt, &u.CreatedAt); err != nil {
			return nil, err
		}
		updates = append(updates, u)
	}
	return updates, rows.Err()
}

func (r *SoftwareUpdateRepo) GetAll(ctx context.Context, limit int, start, end time.Time) ([]*vehiclemodel.SoftwareUpdate, error) {
	hasRange := !start.IsZero() && !end.IsZero()
	var startArg, endArg interface{}
	if hasRange {
		startArg = start
		endArg = end
	}
	query := `SELECT id, vehicle_id, version, status, scheduled_at, installed_at, created_at
		FROM software_updates
		WHERE ($2::timestamptz IS NULL OR created_at BETWEEN $2 AND $3)
		ORDER BY created_at DESC LIMIT $1`
	rows, err := r.db.Pool.Query(ctx, query, limit, startArg, endArg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var updates []*vehiclemodel.SoftwareUpdate
	for rows.Next() {
		u := &vehiclemodel.SoftwareUpdate{}
		if err := rows.Scan(&u.ID, &u.VehicleID, &u.Version, &u.Status, &u.ScheduledAt, &u.InstalledAt, &u.CreatedAt); err != nil {
			return nil, err
		}
		updates = append(updates, u)
	}
	return updates, rows.Err()
}

// GetLatestVersion returns the most recent version string for a vehicle.
// Returns ("", nil) when no records exist — the empty-version case is a
// normal "no firmware observed yet" state and not a query error. Pre-fix
// this method bubbled pgx.ErrNoRows up to its caller, which interacted
// with InsertIfChanged's read-then-write logic in unsafe ways (any error
// from the SELECT bypassed the dedupe guard and let the INSERT proceed
// regardless). After migration 000197 the dedupe is enforced by a UNIQUE
// index on (vehicle_id, version), so InsertIfChanged no longer relies on
// this method, but the public API surface is preserved for callers that
// want a quick "what version is this car on?" lookup.
func (r *SoftwareUpdateRepo) GetLatestVersion(ctx context.Context, vehicleID int64) (string, error) {
	var version string
	err := r.db.Pool.QueryRow(ctx,
		`SELECT version FROM software_updates WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT 1`,
		vehicleID).Scan(&version)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return version, nil
}

// softwareUpdateInsertIfChangedSQL is the atomic upsert that replaces the
// pre-Phase-43a "SELECT latest then INSERT if different" pattern. The
// ON CONFLICT clause depends on the UNIQUE INDEX on (vehicle_id, version)
// added by migration 000197 — without that index the ON CONFLICT target
// has no constraint to bind to and PostgreSQL raises an error at execute
// time. The companion regression test
// (TestSoftwareUpdateRepo_InsertIfChangedSQL_AtomicUpsert) anchors both
// the ON CONFLICT clause and the RETURNING id projection so a future
// drift removing either is caught at CI time.
//
// Why ON CONFLICT DO NOTHING (not DO UPDATE):
//
//   - The trigger is the per-payload telemetry firehose, which fires on
//     every payload that includes a Version field — many per minute. We
//     want the FIRST observation of a version to win and subsequent
//     re-observations to be silent no-ops, so created_at/installed_at
//     reflect the first time the platform saw the firmware (matches the
//     pre-fix behavioural intent).
//
//   - DO UPDATE would touch the row on every payload, generate WAL noise
//     and bloat the index without changing any user-visible value.
//
// Why RETURNING id (not RowsAffected):
//
//   - pgx's CommandTag.RowsAffected() returns 0 for both "row already
//     exists, no insert" and "row inserted but the driver couldn't read
//     the count". RETURNING id distinguishes them: the rowset is empty
//     iff the conflict path was taken (deterministic, no driver
//     dependence). The caller scans Next() to learn whether an insert
//     happened.
const softwareUpdateInsertIfChangedSQL = `
INSERT INTO software_updates (vehicle_id, version, status, installed_at, created_at)
VALUES ($1, $2, $3, NOW(), NOW())
ON CONFLICT (vehicle_id, version) DO NOTHING
RETURNING id`

// InsertIfChanged inserts a new firmware version record only if no row
// for (vehicle_id, version) exists yet. Returns true if a new record was
// inserted, false if the row was already present (no-op).
//
// Race-safety: this method is called by trackVehicleConfig in a goroutine
// per telemetry payload. Pre-fix the implementation was a non-atomic
// SELECT-then-INSERT that produced one duplicate row per concurrent
// payload under MQTT firehose load (production observed up to 50 rows of
// the same version for a single vehicle). The atomic upsert below relies
// on the UNIQUE INDEX added in migration 000197 to serialise concurrent
// inserts at the database — N concurrent calls now produce exactly 1 row
// regardless of arrival order.
func (r *SoftwareUpdateRepo) InsertIfChanged(ctx context.Context, vehicleID int64, version, status string) (bool, error) {
	var id int64
	err := r.db.Pool.QueryRow(ctx, softwareUpdateInsertIfChangedSQL, vehicleID, version, status).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		// Conflict path: row for (vehicle_id, version) already existed.
		// This is the common case under the per-payload firehose and is
		// not an error — the version was previously recorded.
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}
