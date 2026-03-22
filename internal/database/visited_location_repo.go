package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type VisitedLocationRepo struct {
	db *DB
}

func NewVisitedLocationRepo(db *DB) *VisitedLocationRepo {
	return &VisitedLocationRepo{db: db}
}

func (r *VisitedLocationRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.VisitedLocation, error) {
	query := `SELECT vl.id, vl.vehicle_id, vl.address_id, COALESCE(a.display_name, 'Unknown'), vl.visit_count,
		vl.total_duration_min, vl.last_visited, vl.created_at
		FROM visited_locations vl LEFT JOIN addresses a ON a.id = vl.address_id
		WHERE vl.vehicle_id=$1 ORDER BY vl.visit_count DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var locs []*models.VisitedLocation
	for rows.Next() {
		l := &models.VisitedLocation{}
		if err := rows.Scan(&l.ID, &l.VehicleID, &l.AddressID, &l.AddressName, &l.VisitCount,
			&l.TotalDurationMin, &l.LastVisited, &l.CreatedAt); err != nil {
			return nil, err
		}
		locs = append(locs, l)
	}
	return locs, rows.Err()
}

func (r *VisitedLocationRepo) GetAll(ctx context.Context, limit int) ([]*models.VisitedLocation, error) {
	query := `SELECT vl.id, vl.vehicle_id, vl.address_id, COALESCE(a.display_name, 'Unknown'), vl.visit_count,
		vl.total_duration_min, vl.last_visited, vl.created_at
		FROM visited_locations vl LEFT JOIN addresses a ON a.id = vl.address_id
		ORDER BY vl.visit_count DESC LIMIT $1`
	rows, err := r.db.Pool.Query(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var locs []*models.VisitedLocation
	for rows.Next() {
		l := &models.VisitedLocation{}
		if err := rows.Scan(&l.ID, &l.VehicleID, &l.AddressID, &l.AddressName, &l.VisitCount,
			&l.TotalDurationMin, &l.LastVisited, &l.CreatedAt); err != nil {
			return nil, err
		}
		locs = append(locs, l)
	}
	return locs, rows.Err()
}
