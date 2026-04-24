package database

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type TripRepo struct {
	db *DB
}

func NewTripRepo(db *DB) *TripRepo {
	return &TripRepo{db: db}
}

func (r *TripRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit, offset int, startTime, endTime time.Time) ([]*models.Trip, error) {
	query := `SELECT id, vehicle_id, name, description, start_ts, end_ts, total_distance_mi, total_energy_kwh,
		total_duration_min, created_at, updated_at
		FROM trips WHERE vehicle_id=$1`
	args := []interface{}{vehicleID}
	argIdx := 2
	if !startTime.IsZero() {
		query += fmt.Sprintf(" AND start_ts >= $%d", argIdx)
		args = append(args, startTime)
		argIdx++
	}
	if !endTime.IsZero() {
		query += fmt.Sprintf(" AND start_ts <= $%d", argIdx)
		args = append(args, endTime)
		argIdx++
	}
	query += fmt.Sprintf(" ORDER BY start_ts DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, limit, offset)
	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var trips []*models.Trip
	for rows.Next() {
		t := &models.Trip{}
		if err := rows.Scan(&t.ID, &t.VehicleID, &t.Name, &t.Description, &t.StartTs, &t.EndTs,
			&t.TotalDistanceMi, &t.TotalEnergyKWh, &t.TotalDurationMin, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		trips = append(trips, t)
	}
	return trips, rows.Err()
}

func (r *TripRepo) GetAll(ctx context.Context, limit, offset int, startTime, endTime time.Time) ([]*models.Trip, error) {
	query := `SELECT id, vehicle_id, name, description, start_ts, end_ts, total_distance_mi, total_energy_kwh,
		total_duration_min, created_at, updated_at
		FROM trips WHERE 1=1`
	args := []interface{}{}
	argIdx := 1
	if !startTime.IsZero() {
		query += fmt.Sprintf(" AND start_ts >= $%d", argIdx)
		args = append(args, startTime)
		argIdx++
	}
	if !endTime.IsZero() {
		query += fmt.Sprintf(" AND start_ts <= $%d", argIdx)
		args = append(args, endTime)
		argIdx++
	}
	query += fmt.Sprintf(" ORDER BY start_ts DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, limit, offset)
	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var trips []*models.Trip
	for rows.Next() {
		t := &models.Trip{}
		if err := rows.Scan(&t.ID, &t.VehicleID, &t.Name, &t.Description, &t.StartTs, &t.EndTs,
			&t.TotalDistanceMi, &t.TotalEnergyKWh, &t.TotalDurationMin, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		trips = append(trips, t)
	}
	return trips, rows.Err()
}

func (r *TripRepo) GetDriveIDs(ctx context.Context, tripID int64) ([]int64, error) {
	query := `SELECT drive_id FROM trip_drives WHERE trip_id=$1`
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
			       date_trunc('month', start_ts) AS month_start
			FROM drives
			WHERE start_ts IS NOT NULL
			GROUP BY vehicle_id, date_trunc('month', start_ts)
		),
		existing_trips AS (
			SELECT vehicle_id,
			       date_trunc('month', start_ts) AS month_start
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
		WHERE start_ts >= $1 AND start_ts < $2 AND start_ts IS NOT NULL
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
func (r *TripRepo) UpsertMonthTrip(ctx context.Context, vehicleID int64, monthStart time.Time, inProgress bool) (int64, error) {
	monthEnd := monthStart.AddDate(0, 1, 0)
	name := monthStart.Format("Jan 2006") + " Summary"
	if inProgress {
		name = monthStart.Format("Jan 2006") + " (In Progress)"
	}

	// Use NOW() as end_ts for the current in-progress month
	effectiveEnd := monthEnd
	if inProgress {
		effectiveEnd = time.Now().UTC()
	}

	// Aggregate drives for this month
	var totalDist float64
	err := r.db.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(distance_mi), 0)
		FROM drives
		WHERE vehicle_id = $1
		  AND start_ts >= $2 AND start_ts < $3
	`, vehicleID, monthStart, monthEnd).Scan(&totalDist)
	if err != nil {
		return 0, fmt.Errorf("aggregate drives: %w", err)
	}

	// Aggregate charging for this month
	var totalEnergy float64
	err = r.db.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(charge_energy_added), 0)
		FROM charging_sessions
		WHERE vehicle_id = $1
		  AND start_ts >= $2 AND start_ts < $3
	`, vehicleID, monthStart, monthEnd).Scan(&totalEnergy)
	if err != nil {
		return 0, fmt.Errorf("aggregate charges: %w", err)
	}

	// Upsert: update if a trip for this month already exists, otherwise insert
	var tripID int64
	err = r.db.Pool.QueryRow(ctx, `
		INSERT INTO trips (vehicle_id, name, start_ts, end_ts,
		                   total_distance_mi, total_energy_kwh)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (vehicle_id, start_ts) WHERE start_ts = date_trunc('month', start_ts)
		DO UPDATE SET name = EXCLUDED.name,
		              end_ts = EXCLUDED.end_ts,
		              total_distance_mi = EXCLUDED.total_distance_mi,
		              total_energy_kwh = EXCLUDED.total_energy_kwh
		RETURNING id
	`, vehicleID, name, monthStart, effectiveEnd,
		totalDist, totalEnergy).Scan(&tripID)
	if err != nil {
		// ON CONFLICT may not work if there's no unique index — fall back to check-then-insert
		var existingID int64
		checkErr := r.db.Pool.QueryRow(ctx, `
			SELECT id FROM trips WHERE vehicle_id = $1 AND start_ts = $2
		`, vehicleID, monthStart).Scan(&existingID)
		if checkErr == nil {
			// Trip exists — update it
			_, err = r.db.Pool.Exec(ctx, `
				UPDATE trips SET name=$1, end_ts=$2, total_distance_mi=$3,
				                 total_energy_kwh=$4
				WHERE id=$5
			`, name, effectiveEnd, totalDist, totalEnergy, existingID)
			if err != nil {
				return 0, fmt.Errorf("update trip: %w", err)
			}
			tripID = existingID
		} else {
			// Trip doesn't exist — insert without ON CONFLICT
			err = r.db.Pool.QueryRow(ctx, `
				INSERT INTO trips (vehicle_id, name, start_ts, end_ts,
				                   total_distance_mi, total_energy_kwh)
				VALUES ($1, $2, $3, $4, $5, $6)
				RETURNING id
			`, vehicleID, name, monthStart, effectiveEnd,
				totalDist, totalEnergy).Scan(&tripID)
			if err != nil {
				return 0, fmt.Errorf("insert trip: %w", err)
			}
		}
	}

	// Link drives to the trip via trip_drives (idempotent with ON CONFLICT DO NOTHING)
	_, err = r.db.Pool.Exec(ctx, `
		INSERT INTO trip_drives (trip_id, drive_id)
		SELECT $1, id FROM drives
		WHERE vehicle_id = $2
		  AND start_ts >= $3 AND start_ts < $4
		ON CONFLICT DO NOTHING
	`, tripID, vehicleID, monthStart, monthEnd)
	if err != nil {
		return 0, fmt.Errorf("link drives: %w", err)
	}

	return tripID, nil
}
