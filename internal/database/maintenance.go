package database

import (
	"context"
	"fmt"
)

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
