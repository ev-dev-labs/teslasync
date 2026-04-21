package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type SafetyRepo struct {
	db *DB
}

func NewSafetyRepo(db *DB) *SafetyRepo {
	return &SafetyRepo{db: db}
}

func (r *SafetyRepo) Insert(ctx context.Context, snap *models.SafetySnapshot) error {
	if snap.Signals == nil {
		snap.Signals = models.SignalsMap{}
	}
	query := `INSERT INTO safety_snapshots (vehicle_id, automatic_blind_spot_camera, automatic_emergency_braking_off, blind_spot_collision_warning, cruise_follow_distance, emergency_lane_departure_avoidance, forward_collision_warning, lane_departure_avoidance, speed_limit_warning, pin_to_drive_enabled, miles_since_reset, self_driving_miles_since_reset, signals)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		snap.VehicleID, snap.AutomaticBlindSpotCamera, snap.AutomaticEmergencyBrakingOff,
		snap.BlindSpotCollisionWarning, snap.CruiseFollowDistance,
		snap.EmergencyLaneDepartureAvoidance, snap.ForwardCollisionWarning,
		snap.LaneDepartureAvoidance, snap.SpeedLimitWarning,
		snap.PinToDriveEnabled, snap.MilesSinceReset, snap.SelfDrivingMilesSinceReset,
		snap.Signals,
	).Scan(&snap.ID)
}

func (r *SafetyRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.SafetySnapshot, error) {
	query := `SELECT id, vehicle_id, automatic_blind_spot_camera, automatic_emergency_braking_off, blind_spot_collision_warning, cruise_follow_distance, emergency_lane_departure_avoidance, forward_collision_warning, lane_departure_avoidance, speed_limit_warning, pin_to_drive_enabled, miles_since_reset, self_driving_miles_since_reset, signals, created_at
		FROM safety_snapshots WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.SafetySnapshot
	for rows.Next() {
		s := &models.SafetySnapshot{}
		if err := rows.Scan(&s.ID, &s.VehicleID, &s.AutomaticBlindSpotCamera, &s.AutomaticEmergencyBrakingOff,
			&s.BlindSpotCollisionWarning, &s.CruiseFollowDistance,
			&s.EmergencyLaneDepartureAvoidance, &s.ForwardCollisionWarning,
			&s.LaneDepartureAvoidance, &s.SpeedLimitWarning,
			&s.PinToDriveEnabled, &s.MilesSinceReset, &s.SelfDrivingMilesSinceReset,
			&s.Signals,
			&s.CreatedAt); err != nil {
			return nil, err
		}
		snaps = append(snaps, s)
	}
	return snaps, rows.Err()
}

func (r *SafetyRepo) GetLatest(ctx context.Context, vehicleID int64) (*models.SafetySnapshot, error) {
	snaps, err := r.GetByVehicle(ctx, vehicleID, 1)
	if err != nil || len(snaps) == 0 {
		return nil, err
	}
	return snaps[0], nil
}
