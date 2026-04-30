package database

import (
	"context"
	"encoding/json"
	"time"

	"github.com/rs/zerolog/log"
)

const (
	// maxBufferSize holds ~2 hours of signals at 80 signals/sec (~50 MB RAM).
	maxBufferSize = 500_000
	// drainBatchSize caps how many rows are flushed per tick to avoid
	// slamming Postgres with the full backlog on recovery.
	drainBatchSize = 10_000
	// drainInterval is the minimum pause between successive drain batches.
	drainInterval = 100 * time.Millisecond
)

// Append buffers signal values for the next batch flush. Non-blocking.
func (w *SignalHistoryWriter) Append(vehicleID int64, signals map[string]interface{}) {
	base := time.Now().UTC()
	w.mu.Lock()
	offset := 0
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

		row := SignalHistoryRow{VehicleID: vehicleID, Signal: name}
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
			// Flatten Location-type compounds into separate Latitude/Longitude rows
			if latName, lonName, isLoc := locationCompoundNames(name); isLoc {
				if lat, latOk := v["latitude"].(float64); latOk {
					latVal := lat
					w.buffer = append(w.buffer, SignalHistoryRow{
						VehicleID: vehicleID, Signal: latName,
						ValueNum: &latVal, CreatedAt: base.Add(time.Duration(offset) * time.Nanosecond),
					})
					offset++
				}
				if lon, lonOk := v["longitude"].(float64); lonOk {
					lonVal := lon
					w.buffer = append(w.buffer, SignalHistoryRow{
						VehicleID: vehicleID, Signal: lonName,
						ValueNum: &lonVal, CreatedAt: base.Add(time.Duration(offset) * time.Nanosecond),
					})
					offset++
				}
				continue
			}
			// Other compound signals — JSON-marshal into value_jsonb
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
		row.CreatedAt = base.Add(time.Duration(offset) * time.Nanosecond)
		w.buffer = append(w.buffer, row)
		offset++
	}
	// Enforce buffer capacity — drop oldest rows on overflow
	if len(w.buffer) > maxBufferSize {
		dropped := len(w.buffer) - maxBufferSize
		w.buffer = w.buffer[dropped:]
		log.Warn().Int("dropped", dropped).Int("buffer_size", maxBufferSize).
			Msg("signal_log: buffer full, dropped oldest signals")
	}
	w.mu.Unlock()
}

// drainBacklog drains remaining buffer in rate-limited batches after an
// initial flush. Stops when the buffer is empty or ctx is cancelled.
func (w *SignalHistoryWriter) drainBacklog(ctx context.Context) {
	for {
		w.mu.Lock()
		remaining := len(w.buffer)
		w.mu.Unlock()
		if remaining == 0 {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(drainInterval):
			w.flush(ctx)
		}
	}
}

// drainAll flushes the entire buffer (used at shutdown).
func (w *SignalHistoryWriter) drainAll(ctx context.Context) {
	for {
		w.mu.Lock()
		remaining := len(w.buffer)
		w.mu.Unlock()
		if remaining == 0 {
			return
		}
		w.flush(ctx)
	}
}
