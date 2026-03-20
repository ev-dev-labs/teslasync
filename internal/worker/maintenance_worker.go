package worker

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/teslasync/teslasync/internal/config"
	"github.com/teslasync/teslasync/internal/database"
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

	// Run VACUUM ANALYZE to reclaim space and update statistics
	if posDeleted > 0 || statesDeleted > 0 {
		if err := db.VacuumAnalyze(maintCtx); err != nil {
			log.Error().Err(err).Msg("VACUUM ANALYZE failed")
		}
	}

	log.Info().
		Int64("positions_deleted", posDeleted).
		Int64("states_deleted", statesDeleted).
		Dur("duration", time.Since(start)).
		Msg("scheduled maintenance complete")
}

// ensurePartitions creates monthly partitions for the current and next month.
func ensurePartitions(ctx context.Context, db *database.DB) error {
	tables := []string{"positions"}
	for _, t := range tables {
		for _, offset := range []string{"CURRENT_DATE", "CURRENT_DATE + INTERVAL '1 month'"} {
			query := fmt.Sprintf("SELECT create_monthly_partition('%s', %s)", t, offset)
			if _, err := db.Pool.Exec(ctx, query); err != nil {
				log.Warn().Err(err).Str("table", t).Msg("failed to create partition")
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
