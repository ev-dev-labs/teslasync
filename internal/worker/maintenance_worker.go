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
// periods, then runs VACUUM ANALYZE to reclaim space.
func StartMaintenanceWorker(ctx context.Context, db *database.DB, cfg *config.Config) {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()

	log.Info().
		Int("data_retention_days", cfg.Retention.DataRetentionDays).
		Int("position_retention_days", cfg.Retention.PositionRetentionDays).
		Msg("maintenance worker started")

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

	// Compress old positions into hourly summaries before deletion
	if err := compressOldPositions(maintCtx, db); err != nil {
		log.Error().Err(err).Msg("position compression failed")
	}

	// Clean up old positions that may remain in the default partition
	var posDeleted int64
	if cfg.Retention.PositionRetentionDays > 0 {
		var err error
		posDeleted, err = db.CleanupOldPositions(maintCtx, cfg.Retention.PositionRetentionDays)
		if err != nil {
			log.Error().Err(err).Msg("position cleanup failed")
		}
	}

	// Clean up old vehicle states
	var statesDeleted int64
	if cfg.Retention.DataRetentionDays > 0 {
		var err error
		statesDeleted, err = db.CleanupOldStates(maintCtx, cfg.Retention.DataRetentionDays)
		if err != nil {
			log.Error().Err(err).Msg("vehicle state cleanup failed")
		}
	}

	// Clean up old API call logs (keep 30 days)
	apiLogsDeleted, err := cleanupOldLogs(maintCtx, db, "api_call_logs", "ts", 30)
	if err != nil {
		log.Error().Err(err).Msg("API call log cleanup failed")
	}

	// Clean up old notification logs (keep 90 days)
	notifLogsDeleted, err := cleanupOldLogs(maintCtx, db, "notification_logs", "created_at", 90)
	if err != nil {
		log.Error().Err(err).Msg("notification log cleanup failed")
	}

	// Run VACUUM ANALYZE to reclaim space and update statistics
	if posDeleted > 0 || statesDeleted > 0 {
		if err := db.VacuumAnalyze(maintCtx); err != nil {
			log.Error().Err(err).Msg("VACUUM ANALYZE failed")
		}
	}

	// Refresh cagg_fleet_stats materialized view (regular MV, not TimescaleDB CAGG)
	if err := refreshFleetStats(maintCtx, db); err != nil {
		log.Error().Err(err).Msg("cagg_fleet_stats refresh failed")
	}

	// Generate daily battery health snapshots from charging telemetry
	batSnaps := generateBatterySnapshots(maintCtx, db)

	log.Info().
		Int64("positions_deleted", posDeleted).
		Int64("states_deleted", statesDeleted).
		Int64("api_logs_deleted", apiLogsDeleted).
		Int64("notif_logs_deleted", notifLogsDeleted).
		Int("battery_snapshots_created", batSnaps).
		Dur("duration", time.Since(start)).
		Msg("scheduled maintenance complete")
}

// refreshFleetStats refreshes the cagg_fleet_stats materialized view.
// This is a regular MV (not a TimescaleDB continuous aggregate) because the
// source table `drives` is mutable and cannot be converted to a hypertable.
func refreshFleetStats(ctx context.Context, db *database.DB) error {
	log.Info().Msg("refreshing cagg_fleet_stats materialized view")
	_, err := db.Pool.Exec(ctx, "REFRESH MATERIALIZED VIEW CONCURRENTLY cagg_fleet_stats")
	if err != nil {
		return fmt.Errorf("refresh cagg_fleet_stats: %w", err)
	}
	log.Info().Msg("cagg_fleet_stats refresh complete")
	return nil
}

// compressOldPositions aggregates positions older than 30 days into hourly
// summaries (avg speed, battery, coordinates, temps) and removes the
// redundant individual rows. This dramatically reduces storage for historical
// data while preserving meaningful trends.
func compressOldPositions(ctx context.Context, db *database.DB) error {
	log.Info().Msg("compressing old positions into hourly summaries")

	// Insert one representative row per (vehicle, hour) with averaged values
	query := `
	WITH hourly AS (
		SELECT
			vehicle_id,
			date_trunc('hour', ts) as hour,
			AVG(speed_mph) as avg_speed,
			AVG(battery_level) as avg_battery,
			AVG(latitude) as avg_lat,
			AVG(longitude) as avg_lng,
			AVG(inside_temp) as avg_inside_temp,
			AVG(outside_temp) as avg_outside_temp,
			COUNT(*) as sample_count,
			MIN(ts) as first_at
		FROM positions
		WHERE ts < NOW() - INTERVAL '30 days'
		GROUP BY vehicle_id, date_trunc('hour', ts)
		HAVING COUNT(*) > 1
	)
	INSERT INTO positions (vehicle_id, speed_mph, battery_level, latitude, longitude,
		inside_temp, outside_temp, ts)
	SELECT vehicle_id, avg_speed, avg_battery::int, avg_lat, avg_lng,
		avg_inside_temp, avg_outside_temp, first_at
	FROM hourly
	ON CONFLICT DO NOTHING;
	`
	_, err := db.Pool.Exec(ctx, query)
	if err != nil {
		return fmt.Errorf("compress positions insert: %w", err)
	}

	// Delete the now-compressed individual records, keeping the single
	// representative row (MIN(id)) for each (vehicle, hour) bucket.
	res, err := db.Pool.Exec(ctx, `
		DELETE FROM positions
		WHERE ts < NOW() - INTERVAL '30 days'
		AND id NOT IN (
			SELECT MIN(id) FROM positions
			WHERE ts < NOW() - INTERVAL '30 days'
			GROUP BY vehicle_id, date_trunc('hour', ts)
		)
	`)
	if err != nil {
		return fmt.Errorf("compress positions delete: %w", err)
	}

	log.Info().Int64("rows_removed", res.RowsAffected()).Msg("position compression complete")
	return nil
}

func cleanupOldLogs(ctx context.Context, db *database.DB, table, tsCol string, retentionDays int) (int64, error) {
	query := fmt.Sprintf("DELETE FROM %s WHERE %s < NOW() - ($1 || ' days')::INTERVAL", table, tsCol)
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
			`SELECT energy_remaining, est_battery_range FROM charging_telemetry
			 WHERE vehicle_id = $1 AND energy_remaining IS NOT NULL
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
			`SELECT (module_temp_max + module_temp_min) / 2.0
			 FROM charging_telemetry WHERE vehicle_id = $1
			 AND module_temp_max IS NOT NULL AND module_temp_min IS NOT NULL
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
