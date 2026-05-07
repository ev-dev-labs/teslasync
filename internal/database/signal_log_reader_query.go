package database

import (
	"context"
	"fmt"
	"time"
)

// SignalTraceEntry represents a single signal value at a point in time,
// returned by SignalTrace for time-series reconstruction (position traces,
// energy curves, etc.).
//
// Phase-42: signal_log carries one typed column per ValueKind
// (str_value/bool_value/int_value/float_value/time_value); ValueNum holds
// the merged numeric (Float64 ∪ Int64) projection so consumers do not have
// to switch on value_kind. ValueJson is retained as a no-op nil since the
// canonical signal_log schema has no JSONB column, but the field is left
// in place to preserve the legacy SignalTraceEntry shape for callers that
// still reference it.
type SignalTraceEntry struct {
	Timestamp time.Time
	Signal    string
	ValueNum  *float64
	ValueStr  *string
	ValueBool *bool
	ValueJson map[string]interface{}
}

// SignalTrace returns all values of specific signals within a time window,
// sorted by timestamp ASC. Designed for position traces, energy curves, and
// other time-series visualizations.
//
// Phase-42 schema: SELECT ts, field, str_value, bool_value, int_value,
// float_value FROM signal_log; the legacy single value_num column has
// been replaced with two typed columns and we COALESCE float_value with
// int_value::float8 so callers continue to receive a single *float64.
func (r *SignalLogReader) SignalTrace(ctx context.Context, vehicleID int64, signals []string, from, to time.Time) ([]SignalTraceEntry, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	query := `SELECT ts, field, str_value, bool_value,
	                 COALESCE(float_value, int_value::float8) AS num_value
	          FROM signal_log
	          WHERE vehicle_id = $1 AND field = ANY($2)
	            AND ts >= $3 AND ts <= $4
	          ORDER BY ts ASC`

	rows, err := r.db.Pool.Query(ctx, query, vehicleID, signals, from, to)
	if err != nil {
		return nil, fmt.Errorf("signal trace for vehicle %d: %w", vehicleID, err)
	}
	defer rows.Close()

	var entries []SignalTraceEntry
	for rows.Next() {
		var e SignalTraceEntry
		if err := rows.Scan(&e.Timestamp, &e.Signal, &e.ValueStr, &e.ValueBool, &e.ValueNum); err != nil {
			return nil, fmt.Errorf("signal trace scan: %w", err)
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if entries == nil {
		entries = []SignalTraceEntry{}
	}
	return entries, nil
}

// LatestTimestamp returns the most recent signal timestamp for a vehicle.
// Returns (zero time, nil) if no signals exist for the vehicle.
//
// Phase-42 schema: signal_log uses `ts` (TIMESTAMPTZ) instead of the
// legacy `created_at` column.
func (r *SignalLogReader) LatestTimestamp(ctx context.Context, vehicleID int64) (time.Time, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	query := `SELECT MAX(ts) FROM signal_log WHERE vehicle_id = $1`

	var ts *time.Time
	err := r.db.Pool.QueryRow(ctx, query, vehicleID).Scan(&ts)
	if err != nil {
		return time.Time{}, fmt.Errorf("latest timestamp for vehicle %d: %w", vehicleID, err)
	}
	if ts == nil {
		return time.Time{}, nil
	}
	return *ts, nil
}
