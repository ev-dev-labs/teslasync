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
