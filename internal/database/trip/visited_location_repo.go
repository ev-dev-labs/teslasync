package trip

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	geomodel "github.com/ev-dev-labs/teslasync/internal/models/geo"
)

// The legacy visited_locations and addresses tables are intentionally
// dropped without recreation (ADR-004 #4 forward-only). Visited-location
// queries derive on demand from the SI canonical drives table (migration
// 000185_drives_si). Attached geofence names take priority over the
// end-of-drive geocode so renaming a saved place also updates its visited-
// location label. Synthetic IDs use MIN(d.id) per group.

type VisitedLocationRepo struct {
	db *database.DB
}

func NewVisitedLocationRepo(db *database.DB) *VisitedLocationRepo {
	return &VisitedLocationRepo{db: db}
}

func (r *VisitedLocationRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*geomodel.VisitedLocation, error) {
	return r.deriveFromDrives(ctx, &vehicleID, limit)
}

func (r *VisitedLocationRepo) GetAll(ctx context.Context, limit int) ([]*geomodel.VisitedLocation, error) {
	return r.deriveFromDrives(ctx, nil, limit)
}

// deriveFromDrives is the only visited-location read path now that the
// legacy visited_locations table is gone.
func (r *VisitedLocationRepo) deriveFromDrives(ctx context.Context, vehicleID *int64, limit int) ([]*geomodel.VisitedLocation, error) {
	const placeName = `COALESCE(NULLIF(g.name, ''), NULLIF(d.end_place, ''))`
	query := `SELECT MIN(d.id) AS id,
			d.vehicle_id,
			` + placeName + `,
			COUNT(*) AS visit_count,
			COALESCE(SUM(d.duration_s), 0) AS total_duration_s,
			MAX(d.ended_at) AS last_visited,
			MIN(d.started_at) AS first_visited
		FROM drives d
		LEFT JOIN geofences g ON g.id = d.end_geofence_id
		WHERE d.ended_at IS NOT NULL
		  AND ` + placeName + ` IS NOT NULL`

	var args []interface{}
	argN := 1
	if vehicleID != nil {
		query += ` AND d.vehicle_id = $1`
		args = append(args, *vehicleID)
		argN = 2
	}
	query += fmt.Sprintf(` GROUP BY d.vehicle_id, %s
		ORDER BY visit_count DESC
		LIMIT $%d`, placeName, argN)
	args = append(args, limit)

	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var locs []*geomodel.VisitedLocation
	for rows.Next() {
		l := &geomodel.VisitedLocation{}
		var firstVisited time.Time
		if err := rows.Scan(&l.ID, &l.VehicleID, &l.AddressName, &l.VisitCount,
			&l.TotalDurationS, &l.LastVisited, &firstVisited); err != nil {
			return nil, err
		}
		l.CreatedAt = firstVisited
		locs = append(locs, l)
	}
	return locs, rows.Err()
}

// UpsertFromDrive is a no-op stub kept for caller compatibility.
//
// The legacy visited_locations table is gone. Visit counts are computed on
// demand from drives via deriveFromDrives, so explicit upserts are unnecessary;
// this no-op preserves existing caller compatibility.
func (r *VisitedLocationRepo) UpsertFromDrive(ctx context.Context, vehicleID int64, address string, durationS float64) error {
	_ = ctx
	_ = vehicleID
	_ = address
	_ = durationS
	return nil
}
