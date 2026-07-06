package drivingcoach

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

const (
	driveStatsMetersPerMile = 1609.344
	driveStatsMpsPerMph     = 0.44704

	// coachingQueryTimeout bounds the analytics scan of the drives table.
	// The pool already enforces a per-connection statement_timeout, but a
	// request-scoped ceiling keeps a slow year-long scan from outliving the
	// caller regardless of pool configuration.
	coachingQueryTimeout = 15 * time.Second
)

// dbDriveCoachingRepo is the production driveCoachingRepository, backed by the
// SI-canonical drives table (migration 000185).
type dbDriveCoachingRepo struct {
	db *database.DB
}

// newDBDriveCoachingRepo binds the repository to a live connection pool.
func newDBDriveCoachingRepo(db *database.DB) *dbDriveCoachingRepo {
	return &dbDriveCoachingRepo{db: db}
}

// CoachingDrives returns the drives for one vehicle since the given instant,
// newest first, with distance/speed/power projected from SI back to the legacy
// display units (mi/mph/kW) the coaching math is calibrated against. The SI→
// legacy conversion happens at the SQL boundary so the downstream thresholds
// (expressed in mph/kW/mi/°C) remain untouched per the covenant. Drives shorter
// than half a mile are excluded as noise.
func (r *dbDriveCoachingRepo) CoachingDrives(ctx context.Context, vehicleID int64, since time.Time) ([]driveAnalysis, error) {
	ctx, cancel := context.WithTimeout(ctx, coachingQueryTimeout)
	defer cancel()

	rows, err := r.db.Pool.Query(ctx, `
		SELECT id, started_at,
		       distance_m / $3 AS distance_mi_calc,
		       COALESCE(max_speed_mps, 0) / $4 AS max_speed_mph_calc,
		       COALESCE(avg_speed_mps, 0) / $4 AS avg_speed_mph_calc,
		       COALESCE(avg_power_w, 0) / 1000.0 AS avg_power_kw_calc,
		       NULL::double precision,
		       COALESCE(start_soc_pct, 0)::float8,
		       COALESCE(end_soc_pct, 0)::float8,
		       COALESCE(ambient_temp_c_avg, 20)
		FROM drives
		WHERE vehicle_id = $1
		  AND started_at >= $2
		  AND distance_m > $5
		ORDER BY started_at DESC`,
		vehicleID, since,
		driveStatsMetersPerMile, driveStatsMpsPerMph,
		0.5*driveStatsMetersPerMile)
	if err != nil {
		return nil, fmt.Errorf("query coaching drives for vehicle %d: %w", vehicleID, err)
	}
	defer rows.Close()

	var drives []driveAnalysis
	for rows.Next() {
		var d driveAnalysis
		var powerMinPtr *float64
		if err := rows.Scan(&d.id, &d.date, &d.distance,
			&d.speedMax, &d.speedAvg, &d.powerMax, &powerMinPtr,
			&d.socStart, &d.socEnd, &d.outsideTemp); err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("driving-coach: scan error")
			continue
		}
		if powerMinPtr != nil {
			d.powerMin = *powerMinPtr
			d.hasPowerRange = true
		}
		drives = append(drives, d)
	}
	// pgx defers row-stream errors (e.g. a connection dropped mid-result) to
	// rows.Err(); without this check a truncated scan would silently surface
	// as a short/empty coaching payload with a 200 status.
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate coaching drives for vehicle %d: %w", vehicleID, err)
	}
	return drives, nil
}

// Compile-time assertion: the production repo satisfies the handler's port.
var _ driveCoachingRepository = (*dbDriveCoachingRepo)(nil)
