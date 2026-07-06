package tempimpact

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

// tempImpactPool is the minimal pgx surface dbTempImpactRepo needs.
// Declaring it as an interface (rather than binding directly to
// *pgxpool.Pool) lets the repo scan/loop logic be unit-tested with an
// in-package fake — this codebase does not vendor pgxmock. *pgxpool.Pool
// satisfies it, mirroring the sleepPool precedent in internal/api/sleep.
type tempImpactPool interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// tempImpactRepository is the data surface the Handler needs. Kept as an
// interface so handler tests can supply a fake without a live database,
// matching the sleep / mileage handler precedent.
type tempImpactRepository interface {
	EfficiencyBuckets(ctx context.Context, vehicleID int64) ([]tempEfficiencyBucket, error)
	MonthlyTrend(ctx context.Context, vehicleID int64) ([]monthlyTempTrend, error)
	DrivePoints(ctx context.Context, vehicleID int64) ([]drivePoint, error)
}

// efficiencyBucketsSQL groups drives into ambient-temperature bands and
// aggregates SI drive columns. distance_m is SI on disk; $2/$3 carry the
// meters-per-mile constants so the legacy km / per-100-mile response
// fields stay byte-for-byte with the pre-refactor contract. Exposed as a
// package constant so the SQL-shape test can pin the column list without
// a live DB.
const efficiencyBucketsSQL = `
		SELECT
		  CASE
		    WHEN ambient_temp_c_avg < 0 THEN 'Below 0°C'
		    WHEN ambient_temp_c_avg < 10 THEN '0-10°C'
		    WHEN ambient_temp_c_avg < 20 THEN '10-20°C'
		    WHEN ambient_temp_c_avg < 30 THEN '20-30°C'
		    ELSE 'Above 30°C'
		  END as temp_bucket,
		  COUNT(*) as drive_count,
		  AVG(distance_m / 1000.0) as avg_distance_km,
		  AVG(duration_s) as avg_duration_s,
		  AVG(CASE WHEN distance_m > 0
		           THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100
		           ELSE 0 END) as avg_battery_pct_per_100km,
		  AVG(ambient_temp_c_avg) as avg_temp
		FROM drives
		WHERE vehicle_id = $1 AND distance_m > $3 AND ambient_temp_c_avg IS NOT NULL
		GROUP BY temp_bucket
		ORDER BY MIN(ambient_temp_c_avg)`

// monthlyTrendSQL rolls the last 12 months of drives into per-month
// averages. total_distance is returned in km to preserve the legacy
// response semantics while distance_m stays SI on disk.
const monthlyTrendSQL = `
		SELECT DATE_TRUNC('month', started_at) as month,
		       AVG(ambient_temp_c_avg) as avg_temp,
		       AVG(CASE WHEN distance_m > 0
		                THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100
		                ELSE 0 END) as avg_efficiency,
		       COUNT(*) as drive_count,
		       SUM(distance_m / 1000.0) as total_distance
		FROM drives
		WHERE vehicle_id = $1 AND distance_m > $3 AND ambient_temp_c_avg IS NOT NULL
		  AND started_at > NOW() - interval '12 months'
		GROUP BY month
		ORDER BY month`

// drivePointsSQL returns the most recent 500 drives as a scatter series.
// distance_km is derived in SQL from SI distance_m; efficiency_wh_km
// applies the same legacy 0.75 factor the pre-refactor endpoint used.
const drivePointsSQL = `
		SELECT ambient_temp_c_avg,
		       CASE WHEN distance_m > 0
		            THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100 * 0.75
		            ELSE 0 END as efficiency_wh_km,
		       distance_m / 1000.0 as distance_km,
		       started_at::date
		FROM drives
		WHERE vehicle_id = $1 AND distance_m > $3 AND ambient_temp_c_avg IS NOT NULL
		ORDER BY started_at DESC
		LIMIT 500`

// dbTempImpactRepo is the production tempImpactRepository backed by the
// pgx pool.
type dbTempImpactRepo struct {
	pool tempImpactPool
}

// newDBTempImpactRepo binds the repo to the shared pool. A nil pool is a
// wiring bug (mirrors newDBSleepRepo's fail-fast precedent), not a
// runtime state.
func newDBTempImpactRepo(db *database.DB) *dbTempImpactRepo {
	if db == nil || db.Pool == nil {
		panic("tempimpact.newDBTempImpactRepo: db pool must not be nil")
	}
	return &dbTempImpactRepo{pool: db.Pool}
}

// EfficiencyBuckets returns per-temperature-band drive aggregates. Values
// are returned raw (unrounded); the handler owns display rounding. A
// scan or iteration error fails the whole call — these buckets are the
// primary payload, not a best-effort extra.
func (r *dbTempImpactRepo) EfficiencyBuckets(ctx context.Context, vehicleID int64) ([]tempEfficiencyBucket, error) {
	rows, err := r.pool.Query(ctx, efficiencyBucketsSQL, vehicleID, driveStatsMetersPerMile, driveStatsTwoMilesMeters)
	if err != nil {
		return nil, fmt.Errorf("query temperature efficiency buckets: %w", err)
	}
	defer rows.Close()

	out := make([]tempEfficiencyBucket, 0)
	for rows.Next() {
		var b tempEfficiencyBucket
		var avgDist, avgDur, avgBat, avgTemp *float64
		if err := rows.Scan(&b.TempBucket, &b.DriveCount, &avgDist, &avgDur, &avgBat, &avgTemp); err != nil {
			return nil, fmt.Errorf("scan temperature efficiency row: %w", err)
		}
		if avgDist != nil {
			b.AvgDistanceKm = *avgDist
		}
		if avgDur != nil {
			b.AvgDurationS = *avgDur
		}
		if avgBat != nil {
			b.AvgBatteryPer100km = *avgBat
		}
		if avgTemp != nil {
			b.AvgTemp = *avgTemp
		}
		out = append(out, b)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate temperature efficiency rows: %w", err)
	}
	return out, nil
}

// MonthlyTrend returns per-month temperature/efficiency aggregates for the
// trailing 12 months. Values are returned raw; the handler rounds.
func (r *dbTempImpactRepo) MonthlyTrend(ctx context.Context, vehicleID int64) ([]monthlyTempTrend, error) {
	rows, err := r.pool.Query(ctx, monthlyTrendSQL, vehicleID, driveStatsMetersPerMile, driveStatsTwoMilesMeters)
	if err != nil {
		return nil, fmt.Errorf("query monthly temperature trend: %w", err)
	}
	defer rows.Close()

	out := make([]monthlyTempTrend, 0)
	for rows.Next() {
		var tt monthlyTempTrend
		var month time.Time
		var avgTemp, avgEff, totalDist *float64
		if err := rows.Scan(&month, &avgTemp, &avgEff, &tt.DriveCount, &totalDist); err != nil {
			return nil, fmt.Errorf("scan monthly trend row: %w", err)
		}
		tt.Month = month.Format("2006-01")
		if avgTemp != nil {
			tt.AvgTemp = *avgTemp
		}
		if avgEff != nil {
			tt.AvgEfficiency = *avgEff
		}
		if totalDist != nil {
			tt.TotalDistance = *totalDist
		}
		out = append(out, tt)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate monthly trend rows: %w", err)
	}
	return out, nil
}

// DrivePoints returns up to 500 recent drives as a scatter series. Values
// are returned raw; the handler rounds. A single malformed row is skipped
// rather than failing the whole series (best-effort scatter), preserving
// the pre-refactor resilience; a transport-level iteration error is still
// surfaced so the caller can decide how to degrade.
func (r *dbTempImpactRepo) DrivePoints(ctx context.Context, vehicleID int64) ([]drivePoint, error) {
	rows, err := r.pool.Query(ctx, drivePointsSQL, vehicleID, driveStatsMetersPerMile, driveStatsTwoMilesMeters)
	if err != nil {
		return nil, fmt.Errorf("query drive points: %w", err)
	}
	defer rows.Close()

	out := make([]drivePoint, 0)
	for rows.Next() {
		var p drivePoint
		var temp, eff, dist *float64
		var driveDate time.Time
		if err := rows.Scan(&temp, &eff, &dist, &driveDate); err != nil {
			log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("temp impact: drive point row scan failed; skipping")
			continue
		}
		if temp != nil {
			p.OutsideTemp = *temp
		}
		if eff != nil {
			p.EfficiencyWhKm = *eff
		}
		if dist != nil {
			p.DistanceKm = *dist
		}
		p.DriveDate = driveDate.Format("2006-01-02")
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate drive point rows: %w", err)
	}
	return out, nil
}
