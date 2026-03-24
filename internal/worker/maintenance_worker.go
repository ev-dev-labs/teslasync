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

	// Ensure partitions exist for current and next month
	if err := ensurePartitions(maintCtx, db); err != nil {
		log.Error().Err(err).Msg("partition creation failed")
	}

	// Clean up old partitions beyond retention period
	if err := cleanOldPartitions(maintCtx, db, "positions", cfg.Retention.PositionRetentionDays); err != nil {
		log.Error().Err(err).Msg("partition cleanup failed")
	}

	// Compress old positions into hourly summaries before deletion
	if err := compressOldPositions(maintCtx, db); err != nil {
		log.Error().Err(err).Msg("position compression failed")
	}

	// Clean up old positions that may remain in the default partition
	posDeleted, err := db.CleanupOldPositions(maintCtx, cfg.Retention.PositionRetentionDays)
	if err != nil {
		log.Error().Err(err).Msg("position cleanup failed")
	}

	// Clean up old vehicle states
	statesDeleted, err := db.CleanupOldStates(maintCtx, cfg.Retention.DataRetentionDays)
	if err != nil {
		log.Error().Err(err).Msg("vehicle state cleanup failed")
	}

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

	// Run VACUUM ANALYZE to reclaim space and update statistics
	if posDeleted > 0 || statesDeleted > 0 {
		if err := db.VacuumAnalyze(maintCtx); err != nil {
			log.Error().Err(err).Msg("VACUUM ANALYZE failed")
		}
	}

	log.Info().
		Int64("positions_deleted", posDeleted).
		Int64("states_deleted", statesDeleted).
		Int64("api_logs_deleted", apiLogsDeleted).
		Int64("notif_logs_deleted", notifLogsDeleted).
		Dur("duration", time.Since(start)).
		Msg("scheduled maintenance complete")
}

// compressOldPositions aggregates positions older than 30 days into hourly
// summaries (avg speed, power, battery, coordinates, temps) and removes the
// redundant individual rows. This dramatically reduces storage for historical
// data while preserving meaningful trends.
func compressOldPositions(ctx context.Context, db *database.DB) error {
	log.Info().Msg("compressing old positions into hourly summaries")

	// Insert one representative row per (vehicle, hour) with averaged values
	query := `
	WITH hourly AS (
		SELECT
			vehicle_id,
			date_trunc('hour', created_at) as hour,
			AVG(speed) as avg_speed,
			AVG(power) as avg_power,
			AVG(battery_level) as avg_battery,
			AVG(latitude) as avg_lat,
			AVG(longitude) as avg_lng,
			AVG(inside_temp) as avg_inside_temp,
			AVG(outside_temp) as avg_outside_temp,
			COUNT(*) as sample_count,
			MIN(created_at) as first_at
		FROM positions
		WHERE created_at < NOW() - INTERVAL '30 days'
		GROUP BY vehicle_id, date_trunc('hour', created_at)
		HAVING COUNT(*) > 1
	)
	INSERT INTO positions (vehicle_id, speed, power, battery_level, latitude, longitude,
		inside_temp, outside_temp, created_at)
	SELECT vehicle_id, avg_speed, avg_power, avg_battery::int, avg_lat, avg_lng,
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
		WHERE created_at < NOW() - INTERVAL '30 days'
		AND id NOT IN (
			SELECT MIN(id) FROM positions
			WHERE created_at < NOW() - INTERVAL '30 days'
			GROUP BY vehicle_id, date_trunc('hour', created_at)
		)
	`)
	if err != nil {
		return fmt.Errorf("compress positions delete: %w", err)
	}

	log.Info().Int64("rows_removed", res.RowsAffected()).Msg("position compression complete")
	return nil
}

// ensurePartitions creates monthly partitions for the current and next month.
// Uses inline DDL to avoid dependency on a stored function that may not exist
// in external PostgreSQL instances.
func ensurePartitions(ctx context.Context, db *database.DB) error {
	tables := []string{"positions"}
	for _, t := range tables {
		for _, monthOffset := range []int{0, 1} {
			start := time.Now().AddDate(0, monthOffset, 0)
			partStart := time.Date(start.Year(), start.Month(), 1, 0, 0, 0, 0, time.UTC)
			partEnd := partStart.AddDate(0, 1, 0)
			partName := fmt.Sprintf("%s_%s", t, partStart.Format("2006_01"))

			query := fmt.Sprintf(`
				DO $$
				BEGIN
					IF NOT EXISTS (
						SELECT 1 FROM pg_tables WHERE tablename = '%s'
					) THEN
						EXECUTE format(
							'CREATE TABLE IF NOT EXISTS %s PARTITION OF %s FOR VALUES FROM (%%L) TO (%%L)',
							'%s'::timestamp, '%s'::timestamp
						);
					END IF;
				END $$;
			`, partName, partName, t, partStart.Format("2006-01-02"), partEnd.Format("2006-01-02"))

			if _, err := db.Pool.Exec(ctx, query); err != nil {
				log.Warn().Err(err).Str("table", t).Str("partition", partName).Msg("failed to create partition")
				if monthOffset == 0 {
					return fmt.Errorf("failed to create current month partition %s: %w", partName, err)
				}
			}
		}
	}
	return nil
}

// cleanOldPartitions drops monthly partitions older than the retention period.
func cleanOldPartitions(ctx context.Context, db *database.DB, table string, retentionDays int) error {
	cutoff := time.Now().AddDate(0, 0, -retentionDays).Format("2006-01-02")
	query := fmt.Sprintf(`
		DO $$ 
		DECLARE r RECORD;
		BEGIN
			FOR r IN SELECT tablename FROM pg_tables 
			         WHERE tablename LIKE '%s_%%' 
			         AND tablename != '%s_default'
			         AND tablename < '%s_' || to_char(date '%s', 'YYYY_MM')
			LOOP
				EXECUTE 'DROP TABLE IF EXISTS ' || r.tablename;
				RAISE NOTICE 'Dropped partition: %%', r.tablename;
			END LOOP;
		END $$;
	`, table, table, table, cutoff)
	_, err := db.Pool.Exec(ctx, query)
	return err
}

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
