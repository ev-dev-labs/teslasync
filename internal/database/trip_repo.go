package database

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/jackc/pgx/v5"
)

// Phase-42 SI canonical schema (migration 000185_drives_si). The trips and
// trip_drives tables are forward-only:
//   - trips: id, vehicle_id, name, started_at, ended_at, created_by_user,
//            auto_generated, notes
//   - trip_drives: trip_id, drive_id, position INT NOT NULL
//
// Phase-42 dropped these legacy columns from trips:
//   - the legacy start_ts / end_ts pair (renamed to started_at / ended_at)
//   - description (now `notes`; mapped at the repo boundary)
//   - the total_distance / total_energy / total_duration columns are GONE;
//     totals are recomputed on read from drives via trip_drives JOIN per
//     migration 000185's "intentionally NOT denormalized" comment
//   - created_at / updated_at (derive from started_at / ended_at)
//
// trip_drives gained a mandatory `position INT` ordering column and lost
// the audit `added_at` column.
//
// models.Trip keeps legacy field names + units (mi, kWh, minutes) for JSON
// wire compatibility per Prompt 0073 covenant #11. Conversion happens at the
// repo boundary so the public shape consumed by the frontend is preserved.

// tripSelectColumns produces the SI canonical SELECT column list with totals
// recomputed on read from drives via trip_drives JOIN. Aliases are chosen so
// scanning lines up with the legacy models.Trip field order (id, vehicle_id,
// name, description, start_ts, end_ts, total_distance_mi, total_energy_kwh,
// total_duration_min, created_at, updated_at).
const tripSelectColumns = `
	t.id,
	t.vehicle_id,
	COALESCE(t.name, '') AS name,
	t.notes AS description,
	t.started_at AS start_ts,
	t.ended_at AS end_ts,
	COALESCE(td_agg.distance_m, 0) / 1609.344 AS total_distance_mi,
	COALESCE(td_agg.energy_used_wh, 0) / 1000.0 AS total_energy_kwh,
	COALESCE(td_agg.duration_s, 0) / 60.0 AS total_duration_min,
	t.started_at AS created_at,
	COALESCE(t.ended_at, t.started_at) AS updated_at`

// tripFromClause is the SI-canonical FROM clause that joins trips to its
// derived totals. The LEFT JOIN ensures trips with zero linked drives still
// surface (totals come back as 0).
const tripFromClause = `
	FROM trips t
	LEFT JOIN (
		SELECT td.trip_id,
		       SUM(d.distance_m)      AS distance_m,
		       SUM(d.energy_used_wh)  AS energy_used_wh,
		       SUM(d.duration_s)      AS duration_s
		FROM trip_drives td
		JOIN drives d ON d.id = td.drive_id
		GROUP BY td.trip_id
	) td_agg ON td_agg.trip_id = t.id`

type TripRepo struct {
	db *DB
}

func NewTripRepo(db *DB) *TripRepo {
	return &TripRepo{db: db}
}

// scanTrip scans a single row from a query that selects tripSelectColumns
// into a models.Trip with derived totals populated as non-nil pointers
// (totals always exist on the new schema; the LEFT JOIN supplies 0 when no
// drives are linked).
func scanTrip(rows pgx.Rows) (*models.Trip, error) {
	t := &models.Trip{}
	var (
		totalDistanceMi  float64
		totalEnergyKWh   float64
		totalDurationMin float64
	)
	if err := rows.Scan(
		&t.ID, &t.VehicleID, &t.Name, &t.Description,
		&t.StartTs, &t.EndTs,
		&totalDistanceMi, &totalEnergyKWh, &totalDurationMin,
		&t.CreatedAt, &t.UpdatedAt,
	); err != nil {
		return nil, err
	}
	t.TotalDistanceMi = &totalDistanceMi
	t.TotalEnergyKWh = &totalEnergyKWh
	t.TotalDurationMin = &totalDurationMin
	return t, nil
}

func (r *TripRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit, offset int, startTime, endTime time.Time) ([]*models.Trip, error) {
	query := `SELECT ` + tripSelectColumns + tripFromClause + ` WHERE t.vehicle_id=$1`
	args := []interface{}{vehicleID}
	argIdx := 2
	if !startTime.IsZero() {
		query += fmt.Sprintf(" AND t.started_at >= $%d", argIdx)
		args = append(args, startTime)
		argIdx++
	}
	if !endTime.IsZero() {
		query += fmt.Sprintf(" AND t.started_at <= $%d", argIdx)
		args = append(args, endTime)
		argIdx++
	}
	query += fmt.Sprintf(" ORDER BY t.started_at DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, limit, offset)
	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var trips []*models.Trip
	for rows.Next() {
		t, err := scanTrip(rows)
		if err != nil {
			return nil, err
		}
		trips = append(trips, t)
	}
	return trips, rows.Err()
}

func (r *TripRepo) GetAll(ctx context.Context, limit, offset int, startTime, endTime time.Time) ([]*models.Trip, error) {
	query := `SELECT ` + tripSelectColumns + tripFromClause + ` WHERE 1=1`
	args := []interface{}{}
	argIdx := 1
	if !startTime.IsZero() {
		query += fmt.Sprintf(" AND t.started_at >= $%d", argIdx)
		args = append(args, startTime)
		argIdx++
	}
	if !endTime.IsZero() {
		query += fmt.Sprintf(" AND t.started_at <= $%d", argIdx)
		args = append(args, endTime)
		argIdx++
	}
	query += fmt.Sprintf(" ORDER BY t.started_at DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, limit, offset)
	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var trips []*models.Trip
	for rows.Next() {
		t, err := scanTrip(rows)
		if err != nil {
			return nil, err
		}
		trips = append(trips, t)
	}
	return trips, rows.Err()
}

func (r *TripRepo) GetDriveIDs(ctx context.Context, tripID int64) ([]int64, error) {
	query := `SELECT drive_id FROM trip_drives WHERE trip_id=$1 ORDER BY position`
	rows, err := r.db.Pool.Query(ctx, query, tripID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// GenerateMonthlyTrips creates monthly trip summaries by aggregating drives
// and charging sessions. Creates trips for all months with drives, including
// the current month (marked as in-progress). Idempotent — existing trips are
// updated for the current month, and completed months are never re-created.
func (r *TripRepo) GenerateMonthlyTrips(ctx context.Context) (int, error) {
	// Find all vehicle/month combinations that have drives but no trip yet
	// (excluding the current month — handled separately with upsert)
	query := `
		WITH drive_months AS (
			SELECT vehicle_id,
			       date_trunc('month', started_at) AS month_start
			FROM drives
			WHERE started_at IS NOT NULL
			GROUP BY vehicle_id, date_trunc('month', started_at)
		),
		existing_trips AS (
			SELECT vehicle_id,
			       date_trunc('month', started_at) AS month_start
			FROM trips
		),
		missing AS (
			SELECT dm.vehicle_id, dm.month_start
			FROM drive_months dm
			LEFT JOIN existing_trips et
			  ON dm.vehicle_id = et.vehicle_id AND dm.month_start = et.month_start
			WHERE et.vehicle_id IS NULL
			  AND dm.month_start < date_trunc('month', NOW())
			ORDER BY dm.month_start
		)
		SELECT vehicle_id, month_start FROM missing
	`

	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return 0, fmt.Errorf("find missing months: %w", err)
	}
	defer rows.Close()

	type monthKey struct {
		vehicleID  int64
		monthStart time.Time
	}
	var missing []monthKey
	for rows.Next() {
		var mk monthKey
		if err := rows.Scan(&mk.vehicleID, &mk.monthStart); err != nil {
			return 0, err
		}
		missing = append(missing, mk)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}

	created := 0
	for _, mk := range missing {
		if _, err := r.UpsertMonthTrip(ctx, mk.vehicleID, mk.monthStart, false); err != nil {
			return created, err
		}
		created++
	}

	// Also upsert the current month as in-progress (updates if it already exists)
	currentMonth := time.Now().UTC().Truncate(24 * time.Hour)
	currentMonth = time.Date(currentMonth.Year(), currentMonth.Month(), 1, 0, 0, 0, 0, time.UTC)

	curMonthVehicles, err := r.vehiclesWithDrivesInMonth(ctx, currentMonth)
	if err != nil {
		return created, fmt.Errorf("current month vehicles: %w", err)
	}
	for _, vid := range curMonthVehicles {
		if _, err := r.UpsertMonthTrip(ctx, vid, currentMonth, true); err != nil {
			return created, fmt.Errorf("upsert current month: %w", err)
		}
		created++
	}

	return created, nil
}

// vehiclesWithDrivesInMonth returns vehicle IDs that have drives in the given month.
func (r *TripRepo) vehiclesWithDrivesInMonth(ctx context.Context, monthStart time.Time) ([]int64, error) {
	monthEnd := monthStart.AddDate(0, 1, 0)
	rows, err := r.db.Pool.Query(ctx, `
		SELECT DISTINCT vehicle_id FROM drives
		WHERE started_at >= $1 AND started_at < $2 AND started_at IS NOT NULL
	`, monthStart, monthEnd)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// UpsertMonthTrip creates or updates a trip summary for a given vehicle/month.
// For in-progress months, it updates the existing trip with fresh aggregates.
//
// Phase-42 (migration 000185) eliminated the total_distance / total_energy /
// total_duration columns from trips entirely — those values are recomputed
// from constituent drives on read (see tripSelectColumns). The writer now
// only persists the columns that still exist on the SI schema (vehicle_id,
// name, started_at, ended_at). The legacy ON CONFLICT clause is removed
// because the SI schema has no unique constraint on (vehicle_id, started_at);
// idempotency is achieved by the explicit "find existing first, then update
// or insert" path.
func (r *TripRepo) UpsertMonthTrip(ctx context.Context, vehicleID int64, monthStart time.Time, inProgress bool) (int64, error) {
	monthEnd := monthStart.AddDate(0, 1, 0)
	name := monthStart.Format("Jan 2006") + " Summary"
	if inProgress {
		name = monthStart.Format("Jan 2006") + " (In Progress)"
	}

	// Use NOW() as ended_at for the current in-progress month
	effectiveEnd := monthEnd
	if inProgress {
		effectiveEnd = time.Now().UTC()
	}

	// Find an existing monthly trip for this vehicle.
	var tripID int64
	err := r.db.Pool.QueryRow(ctx, `
		SELECT id FROM trips
		WHERE vehicle_id = $1 AND started_at = $2
	`, vehicleID, monthStart).Scan(&tripID)
	switch {
	case err == nil:
		// Existing — update name + ended_at.
		if _, err := r.db.Pool.Exec(ctx, `
			UPDATE trips SET name=$1, ended_at=$2
			WHERE id=$3
		`, name, effectiveEnd, tripID); err != nil {
			return 0, fmt.Errorf("update trip: %w", err)
		}
	case errors.Is(err, pgx.ErrNoRows):
		// Insert new.
		if err := r.db.Pool.QueryRow(ctx, `
			INSERT INTO trips (vehicle_id, name, started_at, ended_at)
			VALUES ($1, $2, $3, $4)
			RETURNING id
		`, vehicleID, name, monthStart, effectiveEnd).Scan(&tripID); err != nil {
			return 0, fmt.Errorf("insert trip: %w", err)
		}
	default:
		return 0, fmt.Errorf("lookup trip: %w", err)
	}

	// Link drives to the trip via trip_drives. The SI schema requires a
	// `position` ordering column; assign positions by chronological drive
	// start. Use a transaction so the wipe + reinsert is atomic and the
	// final ordering is correct even if the membership shifts (e.g., a
	// new drive lands inside the month between runs).
	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin link tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM trip_drives WHERE trip_id=$1`, tripID); err != nil {
		return 0, fmt.Errorf("clear trip_drives: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO trip_drives (trip_id, drive_id, position)
		SELECT $1, id,
		       ROW_NUMBER() OVER (ORDER BY started_at)
		FROM drives
		WHERE vehicle_id = $2
		  AND started_at >= $3 AND started_at < $4
	`, tripID, vehicleID, monthStart, monthEnd); err != nil {
		return 0, fmt.Errorf("link drives: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit link tx: %w", err)
	}

	return tripID, nil
}
