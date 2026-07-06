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
	q, vals := buildInsertFromMap(table, vehicleID, ts, row)
	if _, err := db.Pool.Exec(ctx, q, vals...); err != nil {
		return fmt.Errorf("insert %s from map: %w", table, err)
	}
	return nil
}

// buildInsertFromMap constructs the parameterized INSERT statement and the
// matching argument slice for a row keyed by column name. The identity columns
// vehicle_id/ts are the leading two arguments; the remaining columns follow in
// deterministic sorted order so the generated SQL is stable and the $N
// placeholder positions line up 1:1 with the returned args.
//
// Only $N placeholders carry data — no map value is ever interpolated into the
// SQL text — so the statement is injection-safe provided the column keys are
// trusted schema identifiers (see insertRowFromMap's contract). Splitting this
// pure builder out of the Exec call keeps the SQL/arg construction unit-testable
// without a live database.
func buildInsertFromMap(table string, vehicleID int64, ts time.Time, row map[string]any) (string, []any) {
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
	return q, vals
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
