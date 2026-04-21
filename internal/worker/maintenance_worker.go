package worker

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// StartMaintenanceWorker runs periodic database cleanup on a 24-hour schedule.
// It deletes old positions and vehicle states based on configured retention
// periods, ensures partitions exist for the current and next month, then
// runs VACUUM ANALYZE to reclaim space.
func StartMaintenanceWorker(ctx context.Context, db *database.DB, cfg *config.Config) {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()

	log.Info().Msg("maintenance worker started")

	// Run initial cleanup shortly after startup (5 minute delay to let the system settle)
	select {
	case <-ctx.Done():
		return
	case <-time.After(5 * time.Minute):
		runMaintenance(ctx, db, cfg)
	}

	for {
		select {
		case <-ctx.Done():
			log.Info().Msg("maintenance worker stopping")
			return
		case <-ticker.C:
			runMaintenance(ctx, db, cfg)
		}
	}
}

func runMaintenance(ctx context.Context, db *database.DB, cfg *config.Config) {
	log.Info().Msg("starting scheduled maintenance")
	start := time.Now()

	// Use a separate context with a generous timeout for maintenance operations
	maintCtx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()

	// Refresh materialized views before any data deletion so views reflect latest data
	refreshMaterializedViews(maintCtx, db)

	// Position table retention and chunk management are handled by TimescaleDB
	// retention policies (see internal/database/retention.go) applied at
	// startup based on RETENTION_*_DAYS env vars. No manual partition or row
	// deletion is required here.

	// Clean up old API call logs (keep 30 days)
	apiLogsDeleted, err := cleanupOldLogs(maintCtx, db, "api_call_logs", 30)
	if err != nil {
		log.Error().Err(err).Msg("API call log cleanup failed")
	}

	// Clean up old notification logs (keep 90 days)
	notifLogsDeleted, err := cleanupOldLogs(maintCtx, db, "notification_logs", 90)
	if err != nil {
		log.Error().Err(err).Msg("notification log cleanup failed")
	}

	// Generate daily battery health snapshots from charging telemetry
	batSnaps := generateBatterySnapshots(maintCtx, db)

	log.Info().
		Int64("api_logs_deleted", apiLogsDeleted).
		Int64("notif_logs_deleted", notifLogsDeleted).
		Int("battery_snapshots_created", batSnaps).
		Dur("duration", time.Since(start)).
		Msg("scheduled maintenance complete")
}

// refreshMaterializedViews refreshes all manually-maintained materialized
// views concurrently. Runs before data deletion so views reflect the latest
// raw data.
//
// NOTE: cagg_position_hourly / cagg_charging_hourly / cagg_climate_hourly /
// cagg_position_daily are TimescaleDB continuous aggregates and are refreshed
// automatically by policies attached in migration 000147 — do not add them
// here.
func refreshMaterializedViews(ctx context.Context, db *database.DB) {
	views := []string{
		"mv_energy_daily",
		"mv_signal_stats",
	}
	for _, v := range views {
		start := time.Now()
		_, err := db.Pool.Exec(ctx, fmt.Sprintf("REFRESH MATERIALIZED VIEW CONCURRENTLY %s", v))
		if err != nil {
			log.Error().Err(err).Str("view", v).Msg("materialized view refresh failed")
		} else {
			log.Info().Str("view", v).Dur("duration", time.Since(start)).Msg("materialized view refreshed")
		}
	}
}

// compressOldPositions, ensurePartitions, and cleanOldPartitions have been
// removed. The positions table is now a TimescaleDB hypertable; chunk
// management and retention are handled automatically by TimescaleDB
// (see internal/database/retention.go).

func cleanupOldLogs(ctx context.Context, db *database.DB, table string, retentionDays int) (int64, error) {
	query := fmt.Sprintf("DELETE FROM %s WHERE created_at < NOW() - ($1 || ' days')::INTERVAL", table)
	tag, err := db.Pool.Exec(ctx, query, fmt.Sprintf("%d", retentionDays))
	if err != nil {
		return 0, err
	}
	deleted := tag.RowsAffected()
	if deleted > 0 {
		log.Info().Int64("deleted", deleted).Str("table", table).Msg("cleaned up old logs")
	}
	return deleted, nil
}

// generateBatterySnapshots derives daily battery health metrics from charging
// telemetry and charging sessions, then inserts one snapshot per vehicle
// (skipping if today's snapshot already exists).
func generateBatterySnapshots(ctx context.Context, db *database.DB) int {
	// Nominal specs for health score derivation (Model Y LR baseline)
	const nominalCapacity = 75.0
	const nominalRangeKm = 531.0

	rows, err := db.Pool.Query(ctx, `SELECT id FROM vehicles`)
	if err != nil {
		log.Error().Err(err).Msg("battery-snapshots: failed to list vehicles")
		return 0
	}
	defer rows.Close()

	var vehicleIDs []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			vehicleIDs = append(vehicleIDs, id)
		}
	}

	created := 0
	today := time.Now().UTC().Truncate(24 * time.Hour)
	for _, vid := range vehicleIDs {
		// Skip if we already have a snapshot for today
		var exists bool
		_ = db.Pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM battery_snapshots WHERE vehicle_id=$1 AND created_at >= $2)`,
			vid, today).Scan(&exists)
		if exists {
			continue
		}

		var healthScore, capacityKWh, degradation, estRange, avgTemp float64
		var cycleCount int

		// Derive capacity from latest energy_remaining in charging_telemetry
		var latestEnergy, latestRange *float64
		_ = db.Pool.QueryRow(ctx,
			`SELECT (signals->>'energy_remaining')::double precision,
			        (signals->>'est_battery_range')::double precision
			 FROM charging_telemetry
			 WHERE vehicle_id = $1 AND signals ? 'energy_remaining'
			 ORDER BY created_at DESC LIMIT 1`, vid).Scan(&latestEnergy, &latestRange)

		if latestEnergy != nil && *latestEnergy > 0 {
			capacityKWh = *latestEnergy
			healthScore = (capacityKWh / nominalCapacity) * 100
			if healthScore > 100 {
				healthScore = 100
			}
			degradation = 100 - healthScore
		}
		if latestRange != nil && *latestRange > 0 {
			estRange = *latestRange
		}

		// Count charge cycles from charging sessions (sum of SOC deltas / 100)
		var totalSOCDelta *float64
		_ = db.Pool.QueryRow(ctx,
			`SELECT SUM(GREATEST(end_battery_level - start_battery_level, 0))
			 FROM charging_sessions WHERE vehicle_id = $1 AND end_battery_level > start_battery_level`,
			vid).Scan(&totalSOCDelta)
		if totalSOCDelta != nil {
			cycleCount = int(*totalSOCDelta / 100)
		}

		// Get average module temp from latest charging telemetry
		var modTemp *float64
		_ = db.Pool.QueryRow(ctx,
			`SELECT ((signals->>'module_temp_max')::double precision
			       + (signals->>'module_temp_min')::double precision) / 2.0
			 FROM charging_telemetry WHERE vehicle_id = $1
			 AND signals ? 'module_temp_max' AND signals ? 'module_temp_min'
			 ORDER BY created_at DESC LIMIT 1`, vid).Scan(&modTemp)
		if modTemp != nil {
			avgTemp = *modTemp
		}

		// Only insert if we have meaningful data
		if healthScore == 0 && capacityKWh == 0 && estRange == 0 {
			continue
		}

		_, err := db.Pool.Exec(ctx,
			`INSERT INTO battery_snapshots (vehicle_id, health_score, capacity_kwh, degradation_pct, est_range_km, cycle_count, avg_cell_temp_c, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			vid, healthScore, capacityKWh, degradation, estRange, cycleCount, avgTemp, time.Now().UTC())
		if err != nil {
			log.Error().Err(err).Int64("vehicle_id", vid).Msg("battery-snapshots: failed to insert")
			continue
		}
		created++
		log.Info().
			Int64("vehicle_id", vid).
			Float64("health_score", healthScore).
			Float64("capacity_kwh", capacityKWh).
			Int("cycle_count", cycleCount).
			Msg("battery-snapshots: created daily snapshot")
	}
	return created
}
