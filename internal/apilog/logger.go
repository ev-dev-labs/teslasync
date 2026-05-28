package apilog

import (
	"context"
	"time"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

const (
	// DefaultQueueCapacity is the default buffered channel size for the
	// async writer when AsyncOptions.QueueCapacity is zero.
	DefaultQueueCapacity = 4096

	// DefaultBatchSize is the default number of entries the async writer
	// accumulates before flushing via the BatchInserter.
	DefaultBatchSize = 100

	// DefaultFlushInterval is the maximum age of a buffered entry before
	// the async writer flushes regardless of batch size.
	DefaultFlushInterval = 1 * time.Second
)

// DropsCounter counts entries dropped by the async writer because the
// buffered channel was full at Enqueue time, OR because the writer has
// already shut down. Exported so the inbound HTTP middleware can use the
// same counter without re-registering a duplicate metric.
var DropsCounter = promauto.NewCounter(prometheus.CounterOpts{
	Name: "api_call_log_drops_total",
	Help: "Total api_call_log entries dropped due to async writer queue full.",
})

// Logger is the writer port the API middleware and worker outbound
// clients depend on. Implementations MUST make Enqueue non-blocking
// (drop-on-full) and Shutdown drain-with-deadline.
type Logger interface {
	// Enqueue adds an entry for asynchronous persistence. MUST NOT block
	// the caller; on queue full the entry is dropped and DropsCounter
	// is incremented. After Shutdown returns, Enqueue is a silent
	// no-op (still counts as a drop).
	Enqueue(*teslamodel.APICallLog)

	// Shutdown closes the input channel, drains pending entries to the
	// underlying inserter (subject to ctx deadline), and from then on
	// Enqueue silently drops. Safe to call concurrently with in-flight
	// Enqueues from request goroutines (those will drop, not panic).
	Shutdown(ctx context.Context) error
}

// BatchInserter is the database port the async writer uses to flush a
// batch of entries. Production wiring uses
// (*database.APICallLogRepo).CreateBatch which is implemented via
// pgx.CopyFrom for low-overhead insertion.
type BatchInserter interface {
	CreateBatch(ctx context.Context, batch []*teslamodel.APICallLog) error
}

// nullLogger is the disabled-mode logger used when the async writer was
// constructed with a nil inserter (typically API_LOGS_INBOUND_ENABLED=false).
// All operations are silent no-ops.
type nullLogger struct{}

func (n *nullLogger) Enqueue(*teslamodel.APICallLog) {}
func (n *nullLogger) Shutdown(context.Context) error { return nil }

// NewNoop returns a Logger whose Enqueue and Shutdown are no-ops. Useful
// for tests and for production wiring when API logging is disabled.
func NewNoop() Logger { return &nullLogger{} }
