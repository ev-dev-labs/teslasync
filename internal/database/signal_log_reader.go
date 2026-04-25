package database

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// SignalLogReader provides point-in-time signal reconstruction queries against
// the signal_log hypertable. All queries use context.WithTimeout to prevent
// runaway scans on the hypertable.
type SignalLogReader struct {
	db *DB
}

// NewSignalLogReader creates a reader backed by the given Postgres pool.
func NewSignalLogReader(db *DB) *SignalLogReader {
	return &SignalLogReader{db: db}
}

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

const queryTimeout = 10 * time.Second

// SnapshotAt returns the latest value of every signal for a vehicle at or before
// the given timestamp. Reconstructs full signal context at any point in time.
//
// Uses DISTINCT ON with the (vehicle_id, signal, created_at DESC) index for
// efficient last-value-per-signal lookups on the hypertable.
func (r *SignalLogReader) SnapshotAt(ctx context.Context, vehicleID int64, at time.Time) (map[string]interface{}, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	query := `SELECT DISTINCT ON (signal) signal, value_num, value_str, value_bool, value_jsonb
	          FROM signal_log
	          WHERE vehicle_id = $1 AND created_at <= $2
	          ORDER BY signal, created_at DESC`

	rows, err := r.db.Pool.Query(ctx, query, vehicleID, at)
	if err != nil {
		return nil, fmt.Errorf("snapshot at %v for vehicle %d: %w", at, vehicleID, err)
	}
	defer rows.Close()

	result := make(map[string]interface{})
	for rows.Next() {
		signal, val, err := scanSignalValue(rows)
		if err != nil {
			return nil, fmt.Errorf("snapshot at scan: %w", err)
		}
		if val != nil {
			result[signal] = val
		}
	}
	return result, rows.Err()
}

// SignalAt returns a single signal's value at or before the given timestamp.
// Returns (nil, nil) if the signal was never recorded before that time.
func (r *SignalLogReader) SignalAt(ctx context.Context, vehicleID int64, signal string, at time.Time) (interface{}, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	query := `SELECT value_num, value_str, value_bool, value_jsonb
	          FROM signal_log
	          WHERE vehicle_id = $1 AND signal = $2 AND created_at <= $3
	          ORDER BY created_at DESC
	          LIMIT 1`

	var vNum *float64
	var vStr *string
	var vBool *bool
	var vJsonb []byte

	err := r.db.Pool.QueryRow(ctx, query, vehicleID, signal, at).Scan(&vNum, &vStr, &vBool, &vJsonb)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("signal %q at %v for vehicle %d: %w", signal, at, vehicleID, err)
	}

	return decodeValue(vNum, vStr, vBool, vJsonb), nil
}

// SnapshotBetween returns the latest value of every signal received within a
// time window. Useful for answering "what signals changed during this
// drive/charge session".
func (r *SignalLogReader) SnapshotBetween(ctx context.Context, vehicleID int64, from, to time.Time) (map[string]interface{}, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	query := `SELECT DISTINCT ON (signal) signal, value_num, value_str, value_bool, value_jsonb
	          FROM signal_log
	          WHERE vehicle_id = $1 AND created_at >= $2 AND created_at <= $3
	          ORDER BY signal, created_at DESC`

	rows, err := r.db.Pool.Query(ctx, query, vehicleID, from, to)
	if err != nil {
		return nil, fmt.Errorf("snapshot between %v–%v for vehicle %d: %w", from, to, vehicleID, err)
	}
	defer rows.Close()

	result := make(map[string]interface{})
	for rows.Next() {
		signal, val, err := scanSignalValue(rows)
		if err != nil {
			return nil, fmt.Errorf("snapshot between scan: %w", err)
		}
		if val != nil {
			result[signal] = val
		}
	}
	return result, rows.Err()
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

// scanSignalValue scans a row with columns (signal, value_num, value_str,
// value_bool, value_jsonb) and returns the decoded value using the priority:
// value_num → value_bool → value_jsonb → value_str.
func scanSignalValue(rows pgx.Rows) (string, interface{}, error) {
	var signal string
	var vNum *float64
	var vStr *string
	var vBool *bool
	var vJsonb []byte

	if err := rows.Scan(&signal, &vNum, &vStr, &vBool, &vJsonb); err != nil {
		return "", nil, err
	}
	return signal, decodeValue(vNum, vStr, vBool, vJsonb), nil
}

// DriveAggregates computes average speed, max speed, and average power during
// a time window from signal_log entries. Speed is filtered to >0 samples only
// for the average (excluding stationary readings). Power is computed from
// AVG(PackVoltage) × AVG(PackCurrent) / 1000.
func (r *SignalLogReader) DriveAggregates(ctx context.Context, vehicleID int64, from, to time.Time) (avgSpeed, maxSpeed, avgPower float64) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	query := `SELECT
		AVG(value_num) FILTER (WHERE signal = 'VehicleSpeed' AND value_num > 0),
		MAX(value_num) FILTER (WHERE signal = 'VehicleSpeed'),
		AVG(value_num) FILTER (WHERE signal = 'PackCurrent'),
		AVG(value_num) FILTER (WHERE signal = 'PackVoltage')
	FROM signal_log
	WHERE vehicle_id = $1 AND created_at >= $2 AND created_at <= $3
	  AND signal IN ('VehicleSpeed', 'PackCurrent', 'PackVoltage')`

	var pAvgSpeed, pMaxSpeed, pAvgCurrent, pAvgVoltage *float64
	err := r.db.Pool.QueryRow(ctx, query, vehicleID, from, to).Scan(
		&pAvgSpeed, &pMaxSpeed, &pAvgCurrent, &pAvgVoltage,
	)
	if err != nil {
		return 0, 0, 0
	}
	if pAvgSpeed != nil {
		avgSpeed = *pAvgSpeed
	}
	if pMaxSpeed != nil {
		maxSpeed = *pMaxSpeed
	}
	if pAvgCurrent != nil && pAvgVoltage != nil {
		avgPower = (*pAvgVoltage) * (*pAvgCurrent) / 1000.0 // kW
	}
	return avgSpeed, maxSpeed, avgPower
}

// RegenEnergy estimates regenerative braking energy recovered during a time
// window. Uses negative PackCurrent samples (regen = charging the battery)
// paired with PackVoltage readings to compute approximate kWh.
//
// Falls back to 0 when no negative-current samples exist.
func (r *SignalLogReader) RegenEnergy(ctx context.Context, vehicleID int64, from, to time.Time) float64 {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	// Estimate regen energy: sum of (|negative current| × avg voltage) × avg sample interval.
	// We approximate by using AVG(|negative current|) × AVG(voltage) × duration.
	// More accurate would be per-sample integration, but this is sufficient for drive summary.
	query := `SELECT
		AVG(ABS(value_num)) FILTER (WHERE signal = 'PackCurrent' AND value_num < 0),
		COUNT(*) FILTER (WHERE signal = 'PackCurrent' AND value_num < 0),
		COUNT(*) FILTER (WHERE signal = 'PackCurrent'),
		AVG(value_num) FILTER (WHERE signal = 'PackVoltage')
	FROM signal_log
	WHERE vehicle_id = $1 AND created_at >= $2 AND created_at <= $3
	  AND signal IN ('PackCurrent', 'PackVoltage')`

	var pAvgRegenCurrent *float64
	var regenCount, totalCount int64
	var pAvgVoltage *float64
	err := r.db.Pool.QueryRow(ctx, query, vehicleID, from, to).Scan(
		&pAvgRegenCurrent, &regenCount, &totalCount, &pAvgVoltage,
	)
	if err != nil || pAvgRegenCurrent == nil || pAvgVoltage == nil || totalCount == 0 {
		return 0
	}

	// Fraction of drive time spent in regen
	regenFraction := float64(regenCount) / float64(totalCount)
	durationHours := to.Sub(from).Hours()

	// Energy = avg_regen_current × avg_voltage × regen_time_fraction × duration / 1000
	kwh := (*pAvgRegenCurrent) * (*pAvgVoltage) * regenFraction * durationHours / 1000.0
	if kwh < 0 {
		kwh = 0
	}
	return kwh
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
