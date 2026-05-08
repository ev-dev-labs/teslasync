package apilog

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/rs/zerolog/log"
)

// AsyncOptions tunes the async writer's queue and flush behavior. Zero
// values fall back to the Default* constants; pass an explicit value via
// main.go from cfg.APILogs.* to override.
type AsyncOptions struct {
	QueueCapacity int
	BatchSize     int
	FlushInterval time.Duration
}

// asyncLogger is the production implementation of Logger. It owns a
// buffered channel, a worker goroutine and a small in-memory batch.
// Drops are counted in DropsCounter; the worker stops when both the
// channel is closed and drained.
type asyncLogger struct {
	ch        chan *models.APICallLog
	inserter  BatchInserter
	batchSize int
	flushEvry time.Duration
	done      chan struct{}
	closed    atomic.Bool
	closeOnce sync.Once

	// lastWarnNs limits the volume of "queue full" warn logs to one per
	// second so a sustained burst does not flood the log.
	lastWarnNs atomic.Int64
}

// NewAsync constructs the production async writer. The worker goroutine
// starts immediately; call Shutdown on graceful termination to drain
// pending entries. A nil inserter yields a no-op logger so wiring with
// API_LOGS_INBOUND_ENABLED=false is safe.
func NewAsync(inserter BatchInserter, opts AsyncOptions) Logger {
	if inserter == nil {
		return &nullLogger{}
	}

	cap := opts.QueueCapacity
	if cap <= 0 {
		cap = DefaultQueueCapacity
	}
	bs := opts.BatchSize
	if bs <= 0 {
		bs = DefaultBatchSize
	}
	fi := opts.FlushInterval
	if fi <= 0 {
		fi = DefaultFlushInterval
	}

	a := &asyncLogger{
		ch:        make(chan *models.APICallLog, cap),
		inserter:  inserter,
		batchSize: bs,
		flushEvry: fi,
		done:      make(chan struct{}),
	}
	go a.run()
	return a
}

func (a *asyncLogger) Enqueue(entry *models.APICallLog) {
	if entry == nil {
		return
	}
	if a.closed.Load() {
		DropsCounter.Inc()
		return
	}
	select {
	case a.ch <- entry:
	default:
		DropsCounter.Inc()
		a.warnDrop("api_call_log queue full")
	}
}

func (a *asyncLogger) warnDrop(reason string) {
	now := time.Now().UnixNano()
	last := a.lastWarnNs.Load()
	if now-last < int64(time.Second) {
		return
	}
	if !a.lastWarnNs.CompareAndSwap(last, now) {
		return
	}
	log.Warn().Str("reason", reason).Msg("api_call_log entry dropped")
}

func (a *asyncLogger) Shutdown(ctx context.Context) error {
	a.closeOnce.Do(func() {
		a.closed.Store(true)
		close(a.ch)
	})
	select {
	case <-a.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (a *asyncLogger) run() {
	defer close(a.done)

	batch := make([]*models.APICallLog, 0, a.batchSize)
	ticker := time.NewTicker(a.flushEvry)
	defer ticker.Stop()

	flush := func() {
		if len(batch) == 0 {
			return
		}
		// Use a fresh context so a cancelled request context doesn't kill
		// the flush; cap at 10s to keep DB calls bounded.
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := a.inserter.CreateBatch(ctx, batch); err != nil {
			log.Error().Err(err).Int("batch", len(batch)).Msg("api_call_log batch insert failed")
		}
		for i := range batch {
			batch[i] = nil
		}
		batch = batch[:0]
	}

	for {
		select {
		case entry, ok := <-a.ch:
			if !ok {
				flush()
				return
			}
			batch = append(batch, entry)
			if len(batch) >= a.batchSize {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}
