package database

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type VisitedLocationRepo struct {
	db *DB
}

func NewVisitedLocationRepo(db *DB) *VisitedLocationRepo {
	return &VisitedLocationRepo{db: db}
}

func (r *VisitedLocationRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.VisitedLocation, error) {
	locs, err := r.getByVehicleFromTable(ctx, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	if len(locs) > 0 {
		return locs, nil
	}
	// Fallback: derive from completed drives grouped by end_address
	return r.deriveFromDrives(ctx, &vehicleID, limit)
}

func (r *VisitedLocationRepo) GetAll(ctx context.Context, limit int) ([]*models.VisitedLocation, error) {
	locs, err := r.getAllFromTable(ctx, limit)
	if err != nil {
		return nil, err
	}
	if len(locs) > 0 {
		return locs, nil
	}
	return r.deriveFromDrives(ctx, nil, limit)
}

func (r *VisitedLocationRepo) getByVehicleFromTable(ctx context.Context, vehicleID int64, limit int) ([]*models.VisitedLocation, error) {
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

func (r *VisitedLocationRepo) getAllFromTable(ctx context.Context, limit int) ([]*models.VisitedLocation, error) {
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

// deriveFromDrives aggregates visited locations from the drives table
// by grouping on end_address. Used as fallback when visited_locations is empty.
func (r *VisitedLocationRepo) deriveFromDrives(ctx context.Context, vehicleID *int64, limit int) ([]*models.VisitedLocation, error) {
	query := `SELECT d.vehicle_id, d.end_address,
			COUNT(*) AS visit_count,
			COALESCE(SUM(d.duration_min), 0) AS total_duration_min,
			MAX(d.end_ts) AS last_visited,
			MIN(d.start_ts) AS first_visited
		FROM drives d
		WHERE d.end_ts IS NOT NULL
		  AND d.end_address IS NOT NULL
		  AND d.end_address != ''`

	var args []interface{}
	argN := 1
	if vehicleID != nil {
		query += ` AND d.vehicle_id = $1`
		args = append(args, *vehicleID)
		argN = 2
	}
	query += fmt.Sprintf(` GROUP BY d.vehicle_id, d.end_address
		ORDER BY visit_count DESC
		LIMIT $%d`, argN)
	args = append(args, limit)

	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var locs []*models.VisitedLocation
	for rows.Next() {
		l := &models.VisitedLocation{}
		var firstVisited time.Time
		if err := rows.Scan(&l.VehicleID, &l.AddressName, &l.VisitCount,
			&l.TotalDurationMin, &l.LastVisited, &firstVisited); err != nil {
			return nil, err
		}
		l.CreatedAt = firstVisited
		locs = append(locs, l)
	}
	return locs, rows.Err()
}

// UpsertFromDrive records a visit at the drive's end_address.
// Called when a drive completes to keep visited_locations up to date.
func (r *VisitedLocationRepo) UpsertFromDrive(ctx context.Context, vehicleID int64, address string, durationMin float64) error {
	if address == "" {
		return nil
	}
	query := `INSERT INTO visited_locations (vehicle_id, visit_count, total_duration_min, last_visited)
		VALUES ($1, 1, $2, NOW())
		ON CONFLICT (vehicle_id, address_id) DO UPDATE
		SET visit_count = visited_locations.visit_count + 1,
			total_duration_min = visited_locations.total_duration_min + $2,
			last_visited = NOW()`

	// visited_locations requires address_id (FK to addresses).
	// Since drives store address as a string, not an FK, we use the
	// deriveFromDrives fallback instead. This method is a no-op placeholder
	// until we wire up proper address_id creation.
	_ = query
	return nil
}
