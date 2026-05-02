package database

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// SignalTraceEntry represents a single signal value at a point in time,
// returned by SignalTrace for time-series reconstruction (position traces,
// energy curves, etc.).
//
// Named SignalTraceEntry (not SignalLogEntry) to avoid conflict with
// the MongoDB-based SignalLogEntry in signal_log_repo.go.
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
func (r *SignalLogReader) SignalTrace(ctx context.Context, vehicleID int64, signals []string, from, to time.Time) ([]SignalTraceEntry, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	query := `SELECT created_at, signal, value_num, value_str, value_bool, value_jsonb
	          FROM signal_log
	          WHERE vehicle_id = $1 AND signal = ANY($2)
	            AND created_at >= $3 AND created_at <= $4
	          ORDER BY created_at ASC`

	rows, err := r.db.Pool.Query(ctx, query, vehicleID, signals, from, to)
	if err != nil {
		return nil, fmt.Errorf("signal trace for vehicle %d: %w", vehicleID, err)
	}
	defer rows.Close()

	var entries []SignalTraceEntry
	for rows.Next() {
		var e SignalTraceEntry
		var vJsonb []byte
		if err := rows.Scan(&e.Timestamp, &e.Signal, &e.ValueNum, &e.ValueStr, &e.ValueBool, &vJsonb); err != nil {
			return nil, fmt.Errorf("signal trace scan: %w", err)
		}
		if len(vJsonb) > 0 {
			var m map[string]interface{}
			if err := json.Unmarshal(vJsonb, &m); err == nil {
				e.ValueJson = m
			}
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
func (r *SignalLogReader) LatestTimestamp(ctx context.Context, vehicleID int64) (time.Time, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	query := `SELECT MAX(created_at) FROM signal_log WHERE vehicle_id = $1`

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

// decodeValue applies the canonical priority for multi-typed signal values:
//
//	value_num (float64) → value_bool (bool) → value_jsonb (map) → value_str (string).
//
// Returns nil when all columns are NULL.
func decodeValue(vNum *float64, vStr *string, vBool *bool, vJsonb []byte) interface{} {
	switch {
	case vNum != nil:
		return *vNum
	case vBool != nil:
		return *vBool
	case len(vJsonb) > 0:
		var m map[string]interface{}
		if err := json.Unmarshal(vJsonb, &m); err == nil {
			return m
		}
		// Malformed JSONB — fall through to string
	case vStr != nil:
		return *vStr
	}
	return nil
}
