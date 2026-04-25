package database

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
	"github.com/sony/gobreaker"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

// SignalHistoryRow represents a single signal value at a point in time.
type SignalHistoryRow struct {
	VehicleID  int64
	Signal     string
	ValueNum   *float64
	ValueStr   *string
	ValueBool  *bool
	ValueJsonb *string
	CreatedAt  time.Time
}

// SignalHistoryWriter buffers incoming signals and batch-inserts them into
// the signal_log table every flushInterval. Uses pgx CopyFrom for
// maximum insert performance.
type SignalHistoryWriter struct {
	db       *DB
	mu       sync.Mutex
	buffer   []SignalHistoryRow
	interval time.Duration
}

// NewSignalHistoryWriter creates a writer with the given flush interval.
func NewSignalHistoryWriter(db *DB, flushInterval time.Duration) *SignalHistoryWriter {
	if flushInterval <= 0 {
		flushInterval = config.SignalFlushInterval
	}
	return &SignalHistoryWriter{
		db:       db,
		buffer:   make([]SignalHistoryRow, 0, 512),
		interval: flushInterval,
	}
}

// Append buffers signal values for the next batch flush. Non-blocking.
func (w *SignalHistoryWriter) Append(vehicleID int64, signals map[string]interface{}) {
	now := time.Now().UTC()
	w.mu.Lock()
	for name, value := range signals {
		if value == nil {
			continue
		}
		// Skip invalid markers
		if m, isMap := value.(map[string]interface{}); isMap {
			if inv, has := m["invalid"]; has {
				if b, isBool := inv.(bool); isBool && b {
					continue
				}
			}
		}

		row := SignalHistoryRow{VehicleID: vehicleID, Signal: name, CreatedAt: now}
		switch v := value.(type) {
		case float64:
			row.ValueNum = &v
		case int:
			f := float64(v)
			row.ValueNum = &f
		case int64:
			f := float64(v)
			row.ValueNum = &f
		case bool:
			row.ValueBool = &v
		case string:
			if v != "" && v != "<nil>" {
				row.ValueStr = &v
			} else {
				continue
			}
		case map[string]interface{}:
			// Compound signal (DoorState, DetailedChargeState, etc.)
			jsonBytes, err := json.Marshal(v)
			if err == nil {
				s := string(jsonBytes)
				row.ValueJsonb = &s
			} else {
				continue
			}
		default:
			continue
		}
		w.buffer = append(w.buffer, row)
	}
	w.mu.Unlock()
}

// FlushLoop runs the periodic batch insert. Call in a goroutine.
// Stops when ctx is cancelled, performing a final flush before returning.
func (w *SignalHistoryWriter) FlushLoop(ctx context.Context) {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			// Final flush on shutdown
			w.flush(context.Background())
			return
		case <-ticker.C:
			w.flush(ctx)
		}
	}
}

func (w *SignalHistoryWriter) flush(ctx context.Context) {
	w.mu.Lock()
	if len(w.buffer) == 0 {
		w.mu.Unlock()
		return
	}
	rows := w.buffer
	w.buffer = make([]SignalHistoryRow, 0, cap(rows))
	w.mu.Unlock()

	flushFn := func() error {
		return RetryOnTransient(ctx, "signal_log_flush", func(ctx context.Context) error {
			_, copyErr := w.db.Pool.CopyFrom(ctx,
				pgx.Identifier{"signal_log"},
				[]string{"vehicle_id", "signal", "value_num", "value_str", "value_bool", "value_jsonb", "created_at"},
				pgx.CopyFromSlice(len(rows), func(i int) ([]interface{}, error) {
					r := rows[i]
					return []interface{}{r.VehicleID, r.Signal, r.ValueNum, r.ValueStr, r.ValueBool, r.ValueJsonb, r.CreatedAt}, nil
				}),
			)
			return copyErr
		})
	}

	var err error
	if w.db.WriteBreaker != nil {
		err = w.db.WriteBreaker.Execute(flushFn)
	} else {
		err = flushFn()
	}

	if err != nil {
		if errors.Is(err, gobreaker.ErrOpenState) {
			log.Debug().Int("rows", len(rows)).Msg("signal_log: circuit breaker open, re-queuing")
		} else {
			log.Warn().Err(err).Int("rows", len(rows)).Msg("signal_log: batch insert failed after retries")
		}
		// Re-queue failed rows for the next flush (bounded to prevent memory leak)
		w.mu.Lock()
		const maxRequeue = 10000
		if len(rows) <= maxRequeue {
			w.buffer = append(rows, w.buffer...)
		} else {
			log.Warn().Int("dropped", len(rows)-maxRequeue).Msg("signal_log: dropping oldest rows (requeue limit)")
			w.buffer = append(rows[len(rows)-maxRequeue:], w.buffer...)
		}
		w.mu.Unlock()
	}
}

// Cleanup deletes rows older than the retention period.
func (w *SignalHistoryWriter) Cleanup(ctx context.Context, retentionDays int) {
	result, err := w.db.Pool.Exec(ctx,
		"DELETE FROM signal_log WHERE created_at < NOW() - $1::interval",
		fmt.Sprintf("%d days", retentionDays))
	if err != nil {
		log.Warn().Err(err).Msg("signal_log: TTL cleanup failed")
		return
	}
	log.Info().Int64("deleted", result.RowsAffected()).Int("retention_days", retentionDays).Msg("signal_log: TTL cleanup")
}

// GetHistory returns time-series data for a single signal within a date range.
// Results are ordered by created_at ASC for chart rendering.
func (w *SignalHistoryWriter) GetHistory(ctx context.Context, vehicleID int64, signalName string, from, to time.Time, limit int) ([]SignalHistoryRow, error) {
	if limit <= 0 || limit > 10000 {
		limit = 1000
	}
	query := `SELECT vehicle_id, signal, value_num, value_str, value_bool, created_at
	          FROM signal_log
	          WHERE vehicle_id = $1 AND signal = $2 AND created_at BETWEEN $3 AND $4
	          ORDER BY created_at ASC
	          LIMIT $5`
	rows, err := w.db.Pool.Query(ctx, query, vehicleID, signalName, from, to, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var results []SignalHistoryRow
	for rows.Next() {
		var r SignalHistoryRow
		if err := rows.Scan(&r.VehicleID, &r.Signal, &r.ValueNum, &r.ValueStr, &r.ValueBool, &r.CreatedAt); err != nil {
			return nil, err
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

// GetGlobalStats returns total signal count and date range for a vehicle.
func (w *SignalHistoryWriter) GetGlobalStats(ctx context.Context, vehicleID int64) (int64, *time.Time, *time.Time, error) {
	var count int64
	var oldest, newest *time.Time
	err := w.db.Pool.QueryRow(ctx,
		`SELECT COUNT(*), MIN(created_at), MAX(created_at)
		 FROM signal_log WHERE vehicle_id = $1`, vehicleID).Scan(&count, &oldest, &newest)
	return count, oldest, newest, err
}

// SignalHistoryEntry is a single row from signal_log for API responses.
type SignalHistoryEntry struct {
	Signal    string   `json:"signal"`
	ValueNum  *float64 `json:"value_num,omitempty"`
	ValueStr  *string  `json:"value_str,omitempty"`
	ValueBool *bool    `json:"value_bool,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// Query returns signal history rows with pagination.
func (w *SignalHistoryWriter) Query(ctx context.Context, vehicleID int64, signals []string, from, to time.Time, page, perPage int) ([]SignalHistoryEntry, int64, error) {
	if perPage <= 0 { perPage = 50 }
	if perPage > 100 { perPage = 100 }
	if page < 1 { page = 1 }
	offset := (page - 1) * perPage

	// Count total
	var total int64
	err := w.db.Pool.QueryRow(ctx,
		"SELECT COUNT(*) FROM signal_log WHERE vehicle_id = $1 AND signal = ANY($2) AND created_at BETWEEN $3 AND $4",
		vehicleID, signals, from, to).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	// Fetch page
	rows, err := w.db.Pool.Query(ctx,
		`SELECT signal, value_num, value_str, value_bool, created_at
		 FROM signal_log
		 WHERE vehicle_id = $1 AND signal = ANY($2) AND created_at BETWEEN $3 AND $4
		 ORDER BY created_at DESC LIMIT $5 OFFSET $6`,
		vehicleID, signals, from, to, perPage, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	entries := make([]SignalHistoryEntry, 0)
	for rows.Next() {
		var e SignalHistoryEntry
		if err := rows.Scan(&e.Signal, &e.ValueNum, &e.ValueStr, &e.ValueBool, &e.CreatedAt); err != nil {
			return nil, 0, err
		}
		entries = append(entries, e)
	}
	return entries, total, rows.Err()
}

// AvailableSignals returns distinct signal names for a vehicle.
func (w *SignalHistoryWriter) AvailableSignals(ctx context.Context, vehicleID int64) ([]string, error) {
	rows, err := w.db.Pool.Query(ctx,
		"SELECT DISTINCT signal FROM signal_log WHERE vehicle_id = $1 ORDER BY signal",
		vehicleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	signals := make([]string, 0)
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		signals = append(signals, s)
	}
	return signals, rows.Err()
}

// GetLatestPerSignal returns the most recent value for every signal for a given vehicle.
// Used on startup to warm the in-memory SignalStore after a pod restart.
// Uses DISTINCT ON for an efficient single-pass scan.
func (w *SignalHistoryWriter) GetLatestPerSignal(ctx context.Context, vehicleID int64) (map[string]interface{}, error) {
	query := `SELECT DISTINCT ON (signal) signal, value_num, value_str, value_bool
	          FROM signal_log
	          WHERE vehicle_id = $1
	          ORDER BY signal, created_at DESC`
	rows, err := w.db.Pool.Query(ctx, query, vehicleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]interface{})
	for rows.Next() {
		var signal string
		var vNum *float64
		var vStr *string
		var vBool *bool
		if err := rows.Scan(&signal, &vNum, &vStr, &vBool); err != nil {
			return nil, err
		}
		switch {
		case vStr != nil:
			result[signal] = *vStr
		case vNum != nil:
			result[signal] = *vNum
		case vBool != nil:
			result[signal] = *vBool
		}
	}
	return result, rows.Err()
}

// SnapshotAt returns the latest value of every signal for a vehicle at or before
// the given timestamp. This reconstructs the full signal context at any point in time.
// Uses DISTINCT ON with the (vehicle_id, signal, created_at DESC) index.
func (w *SignalHistoryWriter) SnapshotAt(ctx context.Context, vehicleID int64, at time.Time) (map[string]interface{}, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	query := `SELECT DISTINCT ON (signal) signal, value_num, value_str, value_bool, created_at
	          FROM signal_log
	          WHERE vehicle_id = $1 AND created_at <= $2
	          ORDER BY signal, created_at DESC`
	rows, err := w.db.Pool.Query(ctx, query, vehicleID, at)
	if err != nil {
		return nil, fmt.Errorf("snapshot at %v for vehicle %d: %w", at, vehicleID, err)
	}
	defer rows.Close()

	result := make(map[string]interface{})
	for rows.Next() {
		var signal string
		var vNum *float64
		var vStr *string
		var vBool *bool
		var createdAt time.Time
		if err := rows.Scan(&signal, &vNum, &vStr, &vBool, &createdAt); err != nil {
			return nil, fmt.Errorf("snapshot at scan: %w", err)
		}
		switch {
		case vNum != nil:
			result[signal] = *vNum
		case vStr != nil:
			result[signal] = *vStr
		case vBool != nil:
			result[signal] = *vBool
		}
	}
	return result, rows.Err()
}

// SignalAt returns the value of a specific signal at or before the given timestamp.
// Returns nil if the signal was never recorded before that time.
func (w *SignalHistoryWriter) SignalAt(ctx context.Context, vehicleID int64, signal string, at time.Time) (interface{}, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	query := `SELECT value_num, value_str, value_bool
	          FROM signal_log
	          WHERE vehicle_id = $1 AND signal = $2 AND created_at <= $3
	          ORDER BY created_at DESC
	          LIMIT 1`
	var vNum *float64
	var vStr *string
	var vBool *bool
	err := w.db.Pool.QueryRow(ctx, query, vehicleID, signal, at).Scan(&vNum, &vStr, &vBool)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("signal %q at %v for vehicle %d: %w", signal, at, vehicleID, err)
	}
	switch {
	case vNum != nil:
		return *vNum, nil
	case vStr != nil:
		return *vStr, nil
	case vBool != nil:
		return *vBool, nil
	}
	return nil, nil
}

// SnapshotBetween returns the latest value of every signal received between two timestamps.
// Useful for getting "what signals changed during this drive/charge session".
func (w *SignalHistoryWriter) SnapshotBetween(ctx context.Context, vehicleID int64, from, to time.Time) (map[string]interface{}, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	query := `SELECT DISTINCT ON (signal) signal, value_num, value_str, value_bool, created_at
	          FROM signal_log
	          WHERE vehicle_id = $1 AND created_at >= $2 AND created_at <= $3
	          ORDER BY signal, created_at DESC`
	rows, err := w.db.Pool.Query(ctx, query, vehicleID, from, to)
	if err != nil {
		return nil, fmt.Errorf("snapshot between %v-%v for vehicle %d: %w", from, to, vehicleID, err)
	}
	defer rows.Close()

	result := make(map[string]interface{})
	for rows.Next() {
		var signal string
		var vNum *float64
		var vStr *string
		var vBool *bool
		var createdAt time.Time
		if err := rows.Scan(&signal, &vNum, &vStr, &vBool, &createdAt); err != nil {
			return nil, fmt.Errorf("snapshot between scan: %w", err)
		}
		switch {
		case vNum != nil:
			result[signal] = *vNum
		case vStr != nil:
			result[signal] = *vStr
		case vBool != nil:
			result[signal] = *vBool
		}
	}
	return result, rows.Err()
}

// SignalStats holds min/max/avg/count for a signal.
type SignalStats struct {
	Signal string  `json:"signal"`
	Min    float64 `json:"min"`
	Max    float64 `json:"max"`
	Avg    float64 `json:"avg"`
	Count  int64   `json:"count"`
}

// Stats returns aggregate stats per signal using the cagg_signal_hourly continuous aggregate.
func (w *SignalHistoryWriter) Stats(ctx context.Context, vehicleID int64, signals []string, from, to time.Time) ([]SignalStats, error) {
	rows, err := w.db.Pool.Query(ctx,
		`SELECT signal_name, COALESCE(MIN(min_value), 0), COALESCE(MAX(max_value), 0),
		        COALESCE(SUM(avg_value * sample_count) / NULLIF(SUM(sample_count), 0), 0), COALESCE(SUM(sample_count), 0)
		 FROM cagg_signal_hourly
		 WHERE vehicle_id = $1 AND signal_name = ANY($2) AND hour >= $3 AND hour < $4
		 GROUP BY signal_name ORDER BY signal_name`,
		vehicleID, signals, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	stats := make([]SignalStats, 0)
	for rows.Next() {
		var s SignalStats
		if err := rows.Scan(&s.Signal, &s.Min, &s.Max, &s.Avg, &s.Count); err != nil {
			return nil, err
		}
		stats = append(stats, s)
	}
	return stats, rows.Err()
}
