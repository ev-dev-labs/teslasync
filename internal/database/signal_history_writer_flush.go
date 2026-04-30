package database

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
	"github.com/sony/gobreaker"
)

const (
	// redisBacklogKey is the Redis list used as a secondary WAL for signal rows
	// that couldn't be flushed to Postgres when the in-memory buffer overflows.
	redisBacklogKey = "signal_log:backlog"
	// redisBacklogTTL prevents unbounded accumulation — stale backlog expires.
	redisBacklogTTL = 24 * time.Hour
	// redisBacklogThreshold is the buffer size above which overflow rows are
	// pushed to Redis on flush failure, providing crash-resilient persistence.
	redisBacklogThreshold = 50_000
)

// FlushLoop runs the periodic batch insert. Call in a goroutine.
// Stops when ctx is cancelled, performing a final drain before returning.
func (w *SignalHistoryWriter) FlushLoop(ctx context.Context) {
	// On startup, recover any rows that were pushed to Redis during a prior crash.
	w.drainRedisBacklog(ctx)

	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			// Final drain on shutdown — flush everything
			w.drainAll(context.Background())
			return
		case <-ticker.C:
			w.flush(ctx)
			// If buffer still has rows (recovery backlog), drain in batches
			w.drainBacklog(ctx)
		}
	}
}

// drainRedisBacklog recovers rows from the Redis backlog list that were
// persisted during a previous crash/outage. Called once at startup.
// If Redis is nil or unreachable this is a no-op.
func (w *SignalHistoryWriter) drainRedisBacklog(ctx context.Context) {
	if w.redis == nil {
		return
	}
	count := 0
	for {
		data, err := w.redis.LPop(ctx, redisBacklogKey).Bytes()
		if errors.Is(err, redis.Nil) {
			break
		}
		if err != nil {
			log.Warn().Err(err).Msg("signal_log: Redis backlog drain error")
			break
		}
		var row SignalHistoryRow
		if json.Unmarshal(data, &row) == nil {
			w.mu.Lock()
			w.buffer = append(w.buffer, row)
			w.mu.Unlock()
			count++
		}
	}
	if count > 0 {
		log.Info().Int("rows", count).Msg("signal_log: drained Redis backlog")
	}
}

// pushToRedisBacklog persists overflow rows to a Redis list so they survive
// an app crash. Only called when insertBatch fails AND the in-memory buffer
// exceeds redisBacklogThreshold. Fails silently if Redis is nil or down.
func (w *SignalHistoryWriter) pushToRedisBacklog(rows []SignalHistoryRow) {
	if w.redis == nil {
		return
	}
	pipe := w.redis.Pipeline()
	for _, row := range rows {
		data, err := json.Marshal(row)
		if err != nil {
			continue
		}
		pipe.RPush(context.Background(), redisBacklogKey, data)
	}
	pipe.Expire(context.Background(), redisBacklogKey, redisBacklogTTL)
	if _, err := pipe.Exec(context.Background()); err != nil {
		log.Warn().Err(err).Int("rows", len(rows)).
			Msg("signal_log: failed to push overflow to Redis backlog")
		return
	}
	log.Info().Int("rows", len(rows)).Msg("signal_log: pushed overflow to Redis backlog")
}

func (w *SignalHistoryWriter) flush(ctx context.Context) {
	w.mu.Lock()
	if len(w.buffer) == 0 {
		w.mu.Unlock()
		return
	}

	// Log buffer backlog when it's non-trivial
	if bufLen := len(w.buffer); bufLen > 1000 {
		log.Warn().Int("buffered", bufLen).Msg("signal_log: buffer backlog")
	}

	// Take at most drainBatchSize rows to avoid slamming Postgres on recovery
	n := min(len(w.buffer), drainBatchSize)
	rows := make([]SignalHistoryRow, n)
	copy(rows, w.buffer[:n])
	w.buffer = w.buffer[n:]
	w.mu.Unlock()

	// Dedup within the batch: same (vehicle_id, signal, truncated-to-second timestamp)
	// keeps last value. Prevents duplicate PK violations when two pods process the
	// same MQTT message with slightly different NOW() calls within the same second.
	seen := make(map[string]int, len(rows))
	for i, r := range rows {
		key := fmt.Sprintf("%d:%s:%d", r.VehicleID, r.Signal, r.CreatedAt.Unix())
		seen[key] = i
	}
	if len(seen) < len(rows) {
		deduped := make([]SignalHistoryRow, 0, len(seen))
		for _, idx := range seen {
			deduped = append(deduped, rows[idx])
		}
		log.Debug().Int("before", len(rows)).Int("after", len(deduped)).Msg("signal_log: in-memory dedup")
		rows = deduped
	}

	flushFn := func() error {
		return RetryOnTransient(ctx, "signal_log_flush", func(ctx context.Context) error {
			batch := &pgx.Batch{}
			for _, r := range rows {
				batch.Queue(
					`INSERT INTO signal_log (vehicle_id, signal, value_num, value_str, value_bool, value_jsonb, created_at)
					 VALUES ($1, $2, $3, $4, $5, $6, $7)
					 ON CONFLICT (created_at, vehicle_id, signal) DO UPDATE SET
					 value_num = EXCLUDED.value_num, value_str = EXCLUDED.value_str,
					 value_bool = EXCLUDED.value_bool, value_jsonb = EXCLUDED.value_jsonb`,
					r.VehicleID, r.Signal, r.ValueNum, r.ValueStr, r.ValueBool, r.ValueJsonb, r.CreatedAt,
				)
			}
			br := w.db.Pool.SendBatch(ctx, batch)
			defer br.Close()
			for range rows {
				if _, err := br.Exec(); err != nil {
					return fmt.Errorf("signal_log batch exec: %w", err)
				}
			}
			return nil
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
		// Re-queue failed rows at front, capped to maxBufferSize
		w.mu.Lock()
		w.buffer = append(rows, w.buffer...)
		if len(w.buffer) > maxBufferSize {
			dropped := len(w.buffer) - maxBufferSize
			overflow := make([]SignalHistoryRow, dropped)
			copy(overflow, w.buffer[:dropped])
			w.buffer = w.buffer[dropped:]

			// Push overflow to Redis backlog before losing them
			if len(w.buffer) >= redisBacklogThreshold {
				w.mu.Unlock()
				w.pushToRedisBacklog(overflow)
			} else {
				w.mu.Unlock()
			}
			log.Warn().Int("dropped", dropped).Msg("signal_log: dropping oldest rows (buffer limit)")
		} else {
			w.mu.Unlock()
		}
	}
}
