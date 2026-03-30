package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type LocationSnapshotRepo struct {
	db *DB
}

func NewLocationSnapshotRepo(db *DB) *LocationSnapshotRepo {
	return &LocationSnapshotRepo{db: db}
}

func (r *LocationSnapshotRepo) Insert(ctx context.Context, snap *models.LocationSnapshot) error {
	query := `INSERT INTO location_snapshots (vehicle_id, destination_name, destination_lat, destination_lon, origin_lat, origin_lon, miles_to_arrival, minutes_to_arrival, route_line, route_traffic_delay_min, located_at_home, located_at_work, located_at_favorite, gps_state)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		snap.VehicleID, snap.DestinationName, snap.DestinationLat, snap.DestinationLon,
		snap.OriginLat, snap.OriginLon, snap.MilesToArrival, snap.MinutesToArrival,
		snap.RouteLine, snap.RouteTrafficDelayMin,
		snap.LocatedAtHome, snap.LocatedAtWork, snap.LocatedAtFavorite, snap.GpsState,
	).Scan(&snap.ID)
}

func (r *LocationSnapshotRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.LocationSnapshot, error) {
	query := `SELECT id, vehicle_id, destination_name, destination_lat, destination_lon, origin_lat, origin_lon, miles_to_arrival, minutes_to_arrival, route_line, route_traffic_delay_min, located_at_home, located_at_work, located_at_favorite, gps_state, created_at
		FROM location_snapshots WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.LocationSnapshot
	for rows.Next() {
		s := &models.LocationSnapshot{}
		if err := rows.Scan(&s.ID, &s.VehicleID, &s.DestinationName, &s.DestinationLat, &s.DestinationLon,
			&s.OriginLat, &s.OriginLon, &s.MilesToArrival, &s.MinutesToArrival,
			&s.RouteLine, &s.RouteTrafficDelayMin,
			&s.LocatedAtHome, &s.LocatedAtWork, &s.LocatedAtFavorite, &s.GpsState,
			&s.CreatedAt); err != nil {
			return nil, err
		}
		snaps = append(snaps, s)
	}
	return snaps, rows.Err()
}

func (r *LocationSnapshotRepo) GetLatest(ctx context.Context, vehicleID int64) (*models.LocationSnapshot, error) {
	snaps, err := r.GetByVehicle(ctx, vehicleID, 1)
	if err != nil || len(snaps) == 0 {
		return nil, err
	}
	return snaps[0], nil
}
