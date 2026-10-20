package drivingcoach

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

const (
	coachingMinimumDistanceM = 804.672

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
// newest first. The existing coaching contract uses km, km/h and kW.
// Efficiency comparisons require positive recorded energy; missing energy is
// never inferred from SOC or an assumed battery capacity.
func (r *dbDriveCoachingRepo) CoachingDrives(ctx context.Context, vehicleID int64, since time.Time) ([]driveAnalysis, error) {
	ctx, cancel := context.WithTimeout(ctx, coachingQueryTimeout)
	defer cancel()

	rows, err := r.db.Pool.Query(ctx, `
		SELECT id, started_at,
		       distance_m / 1000.0,
		       max_speed_mps * 3.6,
		       avg_speed_mps * 3.6,
		       avg_power_w / 1000.0,
		       NULL::double precision,
		       energy_used_wh / (distance_m / 1000.0),
		       ambient_temp_c_avg
		FROM drives
		WHERE vehicle_id = $1
		  AND started_at >= $2
		  AND ended_at IS NOT NULL
		  AND distance_m > $3
		  AND energy_used_wh > 0
		  AND max_speed_mps IS NOT NULL
		  AND avg_speed_mps IS NOT NULL
		  AND avg_power_w IS NOT NULL
		  AND ambient_temp_c_avg IS NOT NULL
		ORDER BY started_at DESC`,
		vehicleID, since, coachingMinimumDistanceM)
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
			&d.efficiency, &d.outsideTemp); err != nil {
			return nil, fmt.Errorf("scan coaching drive for vehicle %d: %w", vehicleID, err)
		}
		for _, value := range []float64{d.distance, d.speedMax, d.speedAvg, d.powerMax, d.outsideTemp, d.efficiency} {
			if math.IsNaN(value) || math.IsInf(value, 0) {
				return nil, fmt.Errorf("coaching drive %d has non-finite recorded measurements", d.id)
			}
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
