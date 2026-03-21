package database

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
)

// CleanupOldPositions deletes positions older than the given number of days.
// Uses batched deletes to avoid long-running locks.
func (db *DB) CleanupOldPositions(ctx context.Context, days int) (int64, error) {
	cutoff := time.Now().UTC().AddDate(0, 0, -days)
	log.Info().Time("cutoff", cutoff).Int("retention_days", days).Msg("cleaning up old positions")

	var totalDeleted int64
	batchSize := 10000

	for {
		res, err := db.Pool.Exec(ctx,
			`DELETE FROM positions WHERE created_at < $1 AND ctid IN (
				SELECT ctid FROM positions WHERE created_at < $1 LIMIT $2
			)`, cutoff, batchSize)
		if err != nil {
			return totalDeleted, fmt.Errorf("delete old positions: %w", err)
		}

		deleted := res.RowsAffected()
		totalDeleted += deleted

		if deleted == 0 {
			break
		}

		// Yield between batches to reduce lock contention
		select {
		case <-ctx.Done():
			return totalDeleted, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}

	log.Info().Int64("deleted", totalDeleted).Msg("position cleanup complete")
	return totalDeleted, nil
}

// CleanupOldStates deletes vehicle state records older than the given number of days.
// Uses batched deletes to avoid long-running locks.
func (db *DB) CleanupOldStates(ctx context.Context, days int) (int64, error) {
	cutoff := time.Now().UTC().AddDate(0, 0, -days)
	log.Info().Time("cutoff", cutoff).Int("retention_days", days).Msg("cleaning up old vehicle states")

	var totalDeleted int64
	batchSize := 5000

	for {
		res, err := db.Pool.Exec(ctx,
			`DELETE FROM vehicle_states WHERE start_date < $1 AND id IN (
				SELECT id FROM vehicle_states WHERE start_date < $1 LIMIT $2
			)`, cutoff, batchSize)
		if err != nil {
			return totalDeleted, fmt.Errorf("delete old vehicle states: %w", err)
		}

		deleted := res.RowsAffected()
		totalDeleted += deleted

		if deleted == 0 {
			break
		}

		select {
		case <-ctx.Done():
			return totalDeleted, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}

	log.Info().Int64("deleted", totalDeleted).Msg("vehicle state cleanup complete")
	return totalDeleted, nil
}

// VacuumAnalyze runs VACUUM ANALYZE on the main data tables to reclaim space
// and update query planner statistics. This should be run after large deletes.
func (db *DB) VacuumAnalyze(ctx context.Context) error {
	tables := []string{
		"positions",
		"vehicle_states",
		"drives",
		"charging_sessions",
	}

	for _, table := range tables {
		log.Info().Str("table", table).Msg("running VACUUM ANALYZE")
		// VACUUM cannot run inside a transaction, so we use Exec directly.
		// The table name is from a hardcoded list, not user input.
		if _, err := db.Pool.Exec(ctx, "VACUUM ANALYZE "+table); err != nil {
			log.Warn().Err(err).Str("table", table).Msg("VACUUM ANALYZE failed")
			// Continue with other tables even if one fails
		}
	}

	log.Info().Msg("VACUUM ANALYZE complete")
	return nil
}

// PositionStats holds aggregate counts for the positions table.
type PositionStats struct {
	Total      int64 `json:"total"`
	Compressed int64 `json:"compressed"`
}

// GetPositionStats returns total position count and the number of
// compressed (hourly-aggregated) rows older than 30 days.
func (db *DB) GetPositionStats(ctx context.Context) (PositionStats, error) {
	var stats PositionStats

	err := db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM positions`).Scan(&stats.Total)
	if err != nil {
		return stats, fmt.Errorf("count positions: %w", err)
	}

	// Compressed rows are those older than 30 days where each (vehicle, hour)
	// bucket has exactly one representative row left after aggregation.
	err = db.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN cnt = 1 THEN 1 ELSE 0 END), 0)
		FROM (
			SELECT vehicle_id, date_trunc('hour', created_at) AS hour, COUNT(*) AS cnt
			FROM positions
			WHERE created_at < NOW() - INTERVAL '30 days'
			GROUP BY vehicle_id, date_trunc('hour', created_at)
		) sub
	`).Scan(&stats.Compressed)
	if err != nil {
		return stats, fmt.Errorf("count compressed positions: %w", err)
	}

	return stats, nil
}
