package position

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// insertRowFromMap performs a parameterized INSERT into `table` using the keys
// of `row` as column names. Identity columns vehicle_id/ts are prepended.
//
// Caller MUST ensure all map keys are valid SQL identifiers; in this codebase
// the keys are sourced from telemetry.HotRoute.Column declarations which are
// authored against the schema.
func insertRowFromMap(ctx context.Context, db *database.DB, table string, vehicleID int64, ts time.Time, row map[string]any) error {
	if len(row) == 0 {
		return nil
	}
	keys := sortedKeys(row)
	cols := make([]string, 0, len(keys)+2)
	vals := make([]any, 0, len(keys)+2)
	cols = append(cols, "vehicle_id", "ts")
	vals = append(vals, vehicleID, ts)
	for _, k := range keys {
		cols = append(cols, k)
		vals = append(vals, row[k])
	}
	placeholders := make([]string, len(cols))
	for i := range cols {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
	}
	q := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", table,
		strings.Join(cols, ","), strings.Join(placeholders, ","))
	if _, err := db.Pool.Exec(ctx, q, vals...); err != nil {
		return fmt.Errorf("insert %s from map: %w", table, err)
	}
	return nil
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// Map-based bulk write entry points delegate to insertRowFromMap for each
// repo's table, keeping telemetry dispatch table-oriented without leaking SQL.

func (r *PositionRepo) InsertFromMap(ctx context.Context, vehicleID int64, ts time.Time, row map[string]any) error {
	return insertRowFromMap(ctx, r.db, "positions", vehicleID, ts, row)
}

// SecurityRepo.InsertFromMap was removed with security_repo.go and the
// security_events typed-table fan-out. Security signals (Locked, SentryMode,
// DoorState, FdWindow, etc.) flow through the typed signal_log pipeline.
