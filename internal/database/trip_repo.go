package database

import (
	"context"
	"fmt"
	"time"

	"github.com/teslasync/teslasync/internal/models"
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
