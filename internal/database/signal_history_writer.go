package database

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

// SignalHistoryRow represents a single signal value at a point in time.
type SignalHistoryRow struct {
	VehicleID int64
	Signal    string
	ValueNum  *float64
	ValueStr  *string
	ValueBool *bool
	CreatedAt time.Time
}

// SignalHistoryWriter buffers incoming signals and batch-inserts them into
// the signal_history table every flushInterval. Uses pgx CopyFrom for
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
		flushInterval = 2 * time.Second
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
			continue // skip nested objects (Location, etc.)
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

	_, err := w.db.Pool.CopyFrom(ctx,
		pgx.Identifier{"signal_history"},
		[]string{"vehicle_id", "signal", "value_num", "value_str", "value_bool", "created_at"},
		pgx.CopyFromSlice(len(rows), func(i int) ([]interface{}, error) {
			r := rows[i]
			return []interface{}{r.VehicleID, r.Signal, r.ValueNum, r.ValueStr, r.ValueBool, r.CreatedAt}, nil
		}),
	)
	if err != nil {
		log.Warn().Err(err).Int("rows", len(rows)).Msg("signal_history: batch insert failed")
	}
}

// Cleanup deletes rows older than the retention period.
func (w *SignalHistoryWriter) Cleanup(ctx context.Context, retentionDays int) {
	result, err := w.db.Pool.Exec(ctx,
		"DELETE FROM signal_history WHERE created_at < NOW() - $1::interval",
		fmt.Sprintf("%d days", retentionDays))
	if err != nil {
		log.Warn().Err(err).Msg("signal_history: TTL cleanup failed")
		return
	}
	log.Info().Int64("deleted", result.RowsAffected()).Int("retention_days", retentionDays).Msg("signal_history: TTL cleanup")
}

// SignalHistoryEntry is a single row from signal_history for API responses.
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
		"SELECT COUNT(*) FROM signal_history WHERE vehicle_id = $1 AND signal = ANY($2) AND created_at BETWEEN $3 AND $4",
		vehicleID, signals, from, to).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	// Fetch page
	rows, err := w.db.Pool.Query(ctx,
		`SELECT signal, value_num, value_str, value_bool, created_at
		 FROM signal_history
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
		"SELECT DISTINCT signal FROM signal_history WHERE vehicle_id = $1 ORDER BY signal",
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

// SignalStats holds min/max/avg/count for a signal.
type SignalStats struct {
	Signal string  `json:"signal"`
	Min    float64 `json:"min"`
	Max    float64 `json:"max"`
	Avg    float64 `json:"avg"`
	Count  int64   `json:"count"`
}

// Stats returns aggregate stats per signal.
func (w *SignalHistoryWriter) Stats(ctx context.Context, vehicleID int64, signals []string, from, to time.Time) ([]SignalStats, error) {
	rows, err := w.db.Pool.Query(ctx,
		`SELECT signal, COALESCE(MIN(value_num), 0), COALESCE(MAX(value_num), 0), COALESCE(AVG(value_num), 0), COUNT(*)
		 FROM signal_history
		 WHERE vehicle_id = $1 AND signal = ANY($2) AND created_at BETWEEN $3 AND $4 AND value_num IS NOT NULL
		 GROUP BY signal ORDER BY signal`,
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
