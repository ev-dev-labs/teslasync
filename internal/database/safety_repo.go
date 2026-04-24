package database

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// SafetyRepo reads/writes safety settings data via the consolidated
// vehicle_meta_snapshots table (category='safety'). The old safety_snapshots
// table was dropped in migration 000142_baseline_typed.
type SafetyRepo struct {
	db *DB
}

func NewSafetyRepo(db *DB) *SafetyRepo {
	return &SafetyRepo{db: db}
}

func (r *SafetyRepo) Insert(ctx context.Context, snap *models.SafetySnapshot) error {
	// Map old model fields to new schema columns:
	//   ForwardCollisionWarning (string) → fcw_active (bool)
	//   BlindSpotCollisionWarning (bool) → blind_spot_active (bool)
	//   EmergencyLaneDepartureAvoidance (bool) → emergency_lane_assist (bool)
	//   SpeedLimitWarning (string) → speed_limit_mode (text)
	var fcwActive *bool
	if snap.ForwardCollisionWarning != nil {
		b := *snap.ForwardCollisionWarning != "Off" && *snap.ForwardCollisionWarning != ""
		fcwActive = &b
	}

	// Prefer BlindSpotCollisionWarning; fall back to AutomaticBlindSpotCamera
	blindSpotActive := snap.BlindSpotCollisionWarning
	if blindSpotActive == nil {
		blindSpotActive = snap.AutomaticBlindSpotCamera
	}

	query := `INSERT INTO vehicle_meta_snapshots
		(vehicle_id, ts, category,
		 fcw_active, blind_spot_active, emergency_lane_assist,
		 speed_limit_mode, source)
		VALUES ($1, $2, 'safety', $3, $4, $5, $6, 'fleet_telemetry')
		ON CONFLICT (vehicle_id, ts, category) DO NOTHING`
	_, err := r.db.Pool.Exec(ctx, query,
		snap.VehicleID, time.Now().UTC(),
		fcwActive, blindSpotActive, snap.EmergencyLaneDepartureAvoidance,
		snap.SpeedLimitWarning)
	return err
}

func (r *SafetyRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.SafetySnapshot, error) {
	query := `SELECT vehicle_id,
		fcw_active, blind_spot_active, emergency_lane_assist,
		speed_limit_mode, ts
		FROM vehicle_meta_snapshots
		WHERE vehicle_id = $1 AND category = 'safety'
		ORDER BY ts DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.SafetySnapshot
	for rows.Next() {
		s := &models.SafetySnapshot{}
		var fcwActive *bool
		if err := rows.Scan(&s.VehicleID,
			&fcwActive, &s.BlindSpotCollisionWarning, &s.EmergencyLaneDepartureAvoidance,
			&s.SpeedLimitWarning, &s.CreatedAt); err != nil {
			return nil, err
		}
		// Map fcw_active (bool) back to ForwardCollisionWarning (string)
		if fcwActive != nil {
			if *fcwActive {
				w := "Warning"
				s.ForwardCollisionWarning = &w
			} else {
				w := "Off"
				s.ForwardCollisionWarning = &w
			}
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
