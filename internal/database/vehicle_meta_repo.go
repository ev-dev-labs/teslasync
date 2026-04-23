package database

import (
	"context"
	"errors"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/jackc/pgx/v5"
)

// VehicleMetaRepo persists low-frequency vehicle meta snapshots to the
// consolidated `vehicle_meta_snapshots` hypertable (ADR-003).
//
// The table replaces five legacy snapshot tables (tire_pressure_snapshots,
// media_snapshots, safety_snapshots, vehicle_config_snapshots,
// user_preference_snapshots). The `category` discriminator selects the
// active column group; other groups remain NULL and compress away in the
// columnstore. See migrations/000142_baseline_typed.up.sql.
type VehicleMetaRepo struct {
	db *DB
}

func NewVehicleMetaRepo(db *DB) *VehicleMetaRepo {
	return &VehicleMetaRepo{db: db}
}

// BulkInsert efficiently writes a batch of vehicle meta snapshots using
// pgx.CopyFrom. Returns nil for empty input.
func (r *VehicleMetaRepo) BulkInsert(ctx context.Context, ms []models.VehicleMetaSnapshot) error {
	if len(ms) == 0 {
		return nil
	}

	cols := []string{
		"vehicle_id",
		"ts",
		"category",

		// Tire
		"tire_pressure_fl_psi",
		"tire_pressure_fr_psi",
		"tire_pressure_rl_psi",
		"tire_pressure_rr_psi",
		"tire_temp_fl_c",
		"tire_temp_fr_c",
		"tire_temp_rl_c",
		"tire_temp_rr_c",

		// Media
		"media_source",
		"media_track_title",
		"media_track_artist",
		"media_track_album",
		"media_volume",
		"media_is_playing",
		"media_track_duration_sec",

		// Safety
		"autopilot_state",
		"fcw_active",
		"blind_spot_active",
		"emergency_lane_assist",
		"abs_active",
		"speed_limit_mode",

		// Config
		"software_version",
		"car_type",
		"exterior_color",
		"wheel_type",
		"spoiler_type",
		"has_ludicrous_mode",

		// Preference
		"drive_mode",
		"regen_level",
		"steering_mode",
		"acceleration_mode",
		"climate_keeper_mode",
		"pet_mode",

		"source",
	}

	rows := pgx.CopyFromSlice(len(ms), func(i int) ([]any, error) {
		m := ms[i]
		return []any{
			m.VehicleID,
			m.Ts,
			m.Category,

			m.TirePressureFLPSI,
			m.TirePressureFRPSI,
			m.TirePressureRLPSI,
			m.TirePressureRRPSI,
			m.TireTempFLC,
			m.TireTempFRC,
			m.TireTempRLC,
			m.TireTempRRC,

			m.MediaSource,
			m.MediaTrackTitle,
			m.MediaTrackArtist,
			m.MediaTrackAlbum,
			m.MediaVolume,
			m.MediaIsPlaying,
			m.MediaTrackDurationSec,

			m.AutopilotState,
			m.FCWActive,
			m.BlindSpotActive,
			m.EmergencyLaneAssist,
			m.ABSActive,
			m.SpeedLimitMode,

			m.SoftwareVersion,
			m.CarType,
			m.ExteriorColor,
			m.WheelType,
			m.SpoilerType,
			m.HasLudicrousMode,

			m.DriveMode,
			m.RegenLevel,
			m.SteeringMode,
			m.AccelerationMode,
			m.ClimateKeeperMode,
			m.PetMode,

			m.Source,
		}, nil
	})

	if _, err := r.db.Pool.CopyFrom(ctx, pgx.Identifier{"vehicle_meta_snapshots"}, cols, rows); err != nil {
		return fmt.Errorf("vehicle-meta-snapshots-repo-bulk-insert: %w", err)
	}
	return nil
}

// GetLatest returns the most recent vehicle meta snapshot for the given
// vehicle, or (nil, nil) when no rows exist. The returned snapshot may belong
// to any category (tire, media, safety, config, preference) — callers that
// need a specific group should filter accordingly.
func (r *VehicleMetaRepo) GetLatest(ctx context.Context, vehicleID int64) (*models.VehicleMetaSnapshot, error) {
	const query = `
		SELECT
			vehicle_id, ts, category,
			tire_pressure_fl_psi, tire_pressure_fr_psi, tire_pressure_rl_psi, tire_pressure_rr_psi,
			tire_temp_fl_c, tire_temp_fr_c, tire_temp_rl_c, tire_temp_rr_c,
			media_source, media_track_title, media_track_artist, media_track_album,
			media_volume, media_is_playing, media_track_duration_sec,
			autopilot_state, fcw_active, blind_spot_active, emergency_lane_assist,
			abs_active, speed_limit_mode,
			software_version, car_type, exterior_color, wheel_type, spoiler_type, has_ludicrous_mode,
			drive_mode, regen_level, steering_mode, acceleration_mode, climate_keeper_mode, pet_mode,
			source
		FROM vehicle_meta_snapshots
		WHERE vehicle_id = $1
		ORDER BY ts DESC
		LIMIT 1`

	var m models.VehicleMetaSnapshot
	err := r.db.Pool.QueryRow(ctx, query, vehicleID).Scan(
		&m.VehicleID, &m.Ts, &m.Category,
		&m.TirePressureFLPSI, &m.TirePressureFRPSI, &m.TirePressureRLPSI, &m.TirePressureRRPSI,
		&m.TireTempFLC, &m.TireTempFRC, &m.TireTempRLC, &m.TireTempRRC,
		&m.MediaSource, &m.MediaTrackTitle, &m.MediaTrackArtist, &m.MediaTrackAlbum,
		&m.MediaVolume, &m.MediaIsPlaying, &m.MediaTrackDurationSec,
		&m.AutopilotState, &m.FCWActive, &m.BlindSpotActive, &m.EmergencyLaneAssist,
		&m.ABSActive, &m.SpeedLimitMode,
		&m.SoftwareVersion, &m.CarType, &m.ExteriorColor, &m.WheelType, &m.SpoilerType, &m.HasLudicrousMode,
		&m.DriveMode, &m.RegenLevel, &m.SteeringMode, &m.AccelerationMode, &m.ClimateKeeperMode, &m.PetMode,
		&m.Source,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("vehicle-meta-snapshots-repo-get-latest: %w", err)
	}
	return &m, nil
}
