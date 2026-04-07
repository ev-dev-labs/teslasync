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

func (r *TripRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int, startTime, endTime time.Time) ([]*models.Trip, error) {
	query := `SELECT id, vehicle_id, name, start_date, end_date, total_distance_km, total_energy_kwh,
		total_cost, drive_count, charge_count, created_at
		FROM trips WHERE vehicle_id=$1`
	args := []interface{}{vehicleID}
	argIdx := 2
	if !startTime.IsZero() {
		query += fmt.Sprintf(" AND start_date >= $%d", argIdx)
		args = append(args, startTime)
		argIdx++
	}
	if !endTime.IsZero() {
		query += fmt.Sprintf(" AND start_date <= $%d", argIdx)
		args = append(args, endTime)
		argIdx++
	}
	query += fmt.Sprintf(" ORDER BY start_date DESC LIMIT $%d", argIdx)
	args = append(args, limit)
	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var trips []*models.Trip
	for rows.Next() {
		t := &models.Trip{}
		if err := rows.Scan(&t.ID, &t.VehicleID, &t.Name, &t.StartDate, &t.EndDate,
			&t.TotalDistanceKm, &t.TotalEnergyKWh, &t.TotalCost, &t.DriveCount, &t.ChargeCount, &t.CreatedAt); err != nil {
			return nil, err
		}
		trips = append(trips, t)
	}
	return trips, rows.Err()
}

func (r *TripRepo) GetAll(ctx context.Context, limit int, startTime, endTime time.Time) ([]*models.Trip, error) {
	query := `SELECT id, vehicle_id, name, start_date, end_date, total_distance_km, total_energy_kwh,
		total_cost, drive_count, charge_count, created_at
		FROM trips WHERE 1=1`
	args := []interface{}{}
	argIdx := 1
	if !startTime.IsZero() {
		query += fmt.Sprintf(" AND start_date >= $%d", argIdx)
		args = append(args, startTime)
		argIdx++
	}
	if !endTime.IsZero() {
		query += fmt.Sprintf(" AND start_date <= $%d", argIdx)
		args = append(args, endTime)
		argIdx++
	}
	query += fmt.Sprintf(" ORDER BY start_date DESC LIMIT $%d", argIdx)
	args = append(args, limit)
	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var trips []*models.Trip
	for rows.Next() {
		t := &models.Trip{}
		if err := rows.Scan(&t.ID, &t.VehicleID, &t.Name, &t.StartDate, &t.EndDate,
			&t.TotalDistanceKm, &t.TotalEnergyKWh, &t.TotalCost, &t.DriveCount, &t.ChargeCount, &t.CreatedAt); err != nil {
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
// and charging sessions. It only creates trips for months that don't already
// have one, making it safe to call repeatedly (idempotent).
func (r *TripRepo) GenerateMonthlyTrips(ctx context.Context) (int, error) {
	// Find all vehicle/month combinations that have drives but no trip yet
	query := `
		WITH drive_months AS (
			SELECT vehicle_id,
			       date_trunc('month', start_date) AS month_start
			FROM drives
			WHERE start_date IS NOT NULL
			GROUP BY vehicle_id, date_trunc('month', start_date)
		),
		existing_trips AS (
			SELECT vehicle_id,
			       date_trunc('month', start_date) AS month_start
			FROM trips
		),
		missing AS (
			SELECT dm.vehicle_id, dm.month_start
			FROM drive_months dm
			LEFT JOIN existing_trips et
			  ON dm.vehicle_id = et.vehicle_id AND dm.month_start = et.month_start
			WHERE et.vehicle_id IS NULL
			  AND dm.month_start < date_trunc('month', NOW()) -- don't generate for current month (incomplete)
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
		monthEnd := mk.monthStart.AddDate(0, 1, 0)
		name := mk.monthStart.Format("Jan 2006") + " Summary"

		// Aggregate drives for this month
		var totalDist float64
		var driveCount int
		err := r.db.Pool.QueryRow(ctx, `
			SELECT COALESCE(SUM(distance), 0), COUNT(*)
			FROM drives
			WHERE vehicle_id = $1
			  AND start_date >= $2 AND start_date < $3
		`, mk.vehicleID, mk.monthStart, monthEnd).Scan(&totalDist, &driveCount)
		if err != nil {
			return created, fmt.Errorf("aggregate drives: %w", err)
		}

		// Aggregate charging for this month
		var totalEnergy float64
		var totalCost float64
		var chargeCount int
		err = r.db.Pool.QueryRow(ctx, `
			SELECT COALESCE(SUM(charge_energy_added), 0),
			       COALESCE(SUM(cost), 0),
			       COUNT(*)
			FROM charging_sessions
			WHERE vehicle_id = $1
			  AND start_date >= $2 AND start_date < $3
		`, mk.vehicleID, mk.monthStart, monthEnd).Scan(&totalEnergy, &totalCost, &chargeCount)
		if err != nil {
			return created, fmt.Errorf("aggregate charges: %w", err)
		}

		// Insert the trip
		var tripID int64
		err = r.db.Pool.QueryRow(ctx, `
			INSERT INTO trips (vehicle_id, name, start_date, end_date,
			                   total_distance_km, total_energy_kwh, total_cost,
			                   drive_count, charge_count)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			RETURNING id
		`, mk.vehicleID, name, mk.monthStart, monthEnd,
			totalDist, totalEnergy, totalCost, driveCount, chargeCount).Scan(&tripID)
		if err != nil {
			return created, fmt.Errorf("insert trip: %w", err)
		}

		// Link drives to the trip via trip_drives
		_, err = r.db.Pool.Exec(ctx, `
			INSERT INTO trip_drives (trip_id, drive_id)
			SELECT $1, id FROM drives
			WHERE vehicle_id = $2
			  AND start_date >= $3 AND start_date < $4
		`, tripID, mk.vehicleID, mk.monthStart, monthEnd)
		if err != nil {
			return created, fmt.Errorf("link drives: %w", err)
		}

		created++
	}

	return created, nil
}
