package outbox

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	oteltrace "go.opentelemetry.io/otel/trace"
)

// dispatcherTracer scopes spans for the outbox dispatcher so a single
// publish round-trip (claim → publish → mark) appears as one span in
// Jaeger. Mirrors the pattern in internal/worker/maintenance_worker.go.
const dispatcherTracerName = "internal/outbox/dispatcher"

func dispatcherTracer() oteltrace.Tracer { return otel.Tracer(dispatcherTracerName) }

// Publisher is the narrow contract a dispatcher needs to actually
// emit an event. The concrete implementation in production wraps
// events.Bus.Publish but the test suite swaps in a recorder.
type Publisher interface {
	// PublishOutbox emits ONE row to the downstream broker. Returning
	// nil means "the broker accepted the bytes" (synchronous ack).
	// A non-nil error triggers retry with exponential backoff.
	PublishOutbox(ctx context.Context, row Row) error
}

// Row is the dispatcher's view of one outbox record. The payload and
// headers are passed through as raw bytes — the dispatcher never
// re-serialises them so byte-for-byte fidelity is preserved through
// a republish.
type Row struct {
	ID        int64
	EventType string
	VehicleID int64
	VIN       string
	Payload   []byte
	Headers   []byte
	Attempts  int
	TraceID   string
	CreatedAt time.Time
}

// DispatcherConfig knobs. Zero values get sensible defaults via
// NewDispatcher so callers can omit fields they do not care about.
type DispatcherConfig struct {
	// PollInterval between dispatcher ticks. Default 2s.
	PollInterval time.Duration
	// BatchSize per tick. Default 50; cap 500 to avoid long-lock claims.
	BatchSize int
	// MaxAttempts before a row is moved to 'failed'. Default 10.
	MaxAttempts int
	// BackoffBase is the first retry delay; subsequent retries double
	// up to BackoffMax. Default 2s.
	BackoffBase time.Duration
	// BackoffMax caps the exponential delay. Default 5m.
	BackoffMax time.Duration
	// LeaseDuration is how long the dispatcher claims a row for
	// before another dispatcher may steal it. Default 30s. MUST be
	// strictly greater than the broker publish round-trip timeout.
	LeaseDuration time.Duration
	// StaleLeaseSweep is the period at which expired in_flight leases
	// are reaped back to 'pending'. Default 1m.
	StaleLeaseSweep time.Duration
}

// Dispatcher runs the claim → publish → mark loop. Construct via
// NewDispatcher; the zero value is intentionally non-functional.
type Dispatcher struct {
	store     *Store
	publisher Publisher
	cfg       DispatcherConfig
	hostname  string

	stopOnce sync.Once
	stopped  chan struct{}
}

// NewDispatcher wires a dispatcher. Returns nil if either store or
// publisher is nil — callers can `if d != nil` to defend against a
// degraded boot path.
func NewDispatcher(s *Store, p Publisher, cfg DispatcherConfig) *Dispatcher {
	if s == nil || p == nil {
		return nil
	}
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = 2 * time.Second
	}
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 50
	}
	if cfg.BatchSize > 500 {
		cfg.BatchSize = 500
	}
	if cfg.MaxAttempts <= 0 {
		cfg.MaxAttempts = 10
	}
	if cfg.BackoffBase <= 0 {
		cfg.BackoffBase = 2 * time.Second
	}
	if cfg.BackoffMax <= 0 {
		cfg.BackoffMax = 5 * time.Minute
	}
	if cfg.LeaseDuration <= 0 {
		cfg.LeaseDuration = 30 * time.Second
	}
	if cfg.StaleLeaseSweep <= 0 {
		cfg.StaleLeaseSweep = 1 * time.Minute
	}
	host, err := os.Hostname()
	if err != nil || host == "" {
		host = "unknown"
	}
	return &Dispatcher{
		store:     s,
		publisher: p,
		cfg:       cfg,
		hostname:  host,
		stopped:   make(chan struct{}),
	}
}

// Run blocks until ctx is cancelled. On cancel it returns ctx.Err().
// Safe to invoke under a `go d.Run(ctx)` from the main composition
// root; multiple dispatchers across pods cooperate via the row-level
// lease so a 2-pod deployment doubles throughput, not double-publish.
func (d *Dispatcher) Run(ctx context.Context) error {
	if d == nil {
		return errors.New("outbox: nil dispatcher")
	}
	defer d.stopOnce.Do(func() { close(d.stopped) })

	pollTicker := time.NewTicker(d.cfg.PollInterval)
	defer pollTicker.Stop()
	sweepTicker := time.NewTicker(d.cfg.StaleLeaseSweep)
	defer sweepTicker.Stop()

	log.Info().
		Dur("poll_interval", d.cfg.PollInterval).
		Int("batch_size", d.cfg.BatchSize).
		Int("max_attempts", d.cfg.MaxAttempts).
		Str("host", d.hostname).
		Msg("outbox dispatcher started")

	// Tick once immediately so a backlog at process start is drained
	// without waiting for the first interval.
	d.tickPoll(ctx)

	for {
		select {
		case <-ctx.Done():
			log.Info().Msg("outbox dispatcher stopping")
			return ctx.Err()
		case <-pollTicker.C:
			d.tickPoll(ctx)
		case <-sweepTicker.C:
			d.tickSweep(ctx)
		}
	}
}

// RunOnce executes a single poll tick (claim, publish, mark) without
// the surrounding ticker loop. Useful for tests and for one-shot CI
// flush jobs.
func (d *Dispatcher) RunOnce(ctx context.Context) (published, retried, failed int, err error) {
	if d == nil {
		return 0, 0, 0, errors.New("outbox: nil dispatcher")
	}
	return d.pollAndPublish(ctx)
}

// Done returns a channel that is closed when Run has fully exited.
// Lets the composition root wait on graceful shutdown.
func (d *Dispatcher) Done() <-chan struct{} {
	if d == nil {
		ch := make(chan struct{})
		close(ch)
		return ch
	}
	return d.stopped
}

func (d *Dispatcher) tickPoll(ctx context.Context) {
	pub, ret, fail, err := d.pollAndPublish(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("outbox: poll failed")
		return
	}
	if pub+ret+fail > 0 {
		log.Debug().
			Int("published", pub).
			Int("retried", ret).
			Int("failed", fail).
			Msg("outbox: tick complete")
	}
}

func (d *Dispatcher) pollAndPublish(ctx context.Context) (published, retried, failed int, err error) {
	ctx, span := dispatcherTracer().Start(ctx, "outbox.poll",
		oteltrace.WithSpanKind(oteltrace.SpanKindInternal),
		oteltrace.WithAttributes(attribute.Int("batch_size", d.cfg.BatchSize)))
	defer span.End()

	rows, err := d.claim(ctx)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "claim")
		return 0, 0, 0, err
	}
	span.SetAttributes(attribute.Int("claimed", len(rows)))
	if len(rows) == 0 {
		return 0, 0, 0, nil
	}
	for _, row := range rows {
		if cerr := ctx.Err(); cerr != nil {
			return published, retried, failed, cerr
		}
		if perr := d.publishOne(ctx, row); perr != nil {
			if isTerminal(row, d.cfg.MaxAttempts) {
				_ = d.markFailed(ctx, row.ID, perr)
				failed++
			} else {
				_ = d.markRetry(ctx, row, perr)
				retried++
			}
			continue
		}
		_ = d.markPublished(ctx, row.ID)
		published++
	}
	span.SetAttributes(
		attribute.Int("published", published),
		attribute.Int("retried", retried),
		attribute.Int("failed", failed),
	)
	return published, retried, failed, nil
}

func (d *Dispatcher) tickSweep(ctx context.Context) {
	ctx, span := dispatcherTracer().Start(ctx, "outbox.sweep")
	defer span.End()
	const query = `
UPDATE events_outbox
   SET status = 'pending', lease_until = NULL, lease_holder = NULL
 WHERE status = 'in_flight' AND lease_until < NOW()
RETURNING id`
	rows, err := d.store.pool.Query(ctx, query)
	if err != nil {
		span.RecordError(err)
		log.Warn().Err(err).Msg("outbox: stale-lease sweep failed")
		return
	}
	defer rows.Close()
	var reaped int
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			reaped++
			log.Warn().Int64("id", id).Msg("outbox: reaped stale lease")
		}
	}
	span.SetAttributes(attribute.Int("reaped", reaped))
}

// claim atomically transitions ≤BatchSize 'pending' rows to
// 'in_flight' with a lease. Uses FOR UPDATE SKIP LOCKED so multiple
// dispatchers do not contend on the same rows.
func (d *Dispatcher) claim(ctx context.Context) ([]Row, error) {
	const query = `
WITH due AS (
    SELECT id FROM events_outbox
     WHERE status = 'pending' AND next_attempt_at <= NOW()
     ORDER BY next_attempt_at, id
     LIMIT $1
     FOR UPDATE SKIP LOCKED
)
UPDATE events_outbox o
   SET status = 'in_flight',
       lease_until = NOW() + ($2::bigint || ' milliseconds')::interval,
       lease_holder = $3
  FROM due
 WHERE o.id = due.id
RETURNING o.id, o.event_type, COALESCE(o.vehicle_id, 0),
          COALESCE(o.vin, ''), o.payload, COALESCE(o.headers, '{}'::jsonb),
          o.attempts, COALESCE(o.trace_id, ''), o.created_at`

	rows, err := d.store.pool.Query(ctx, query,
		d.cfg.BatchSize, d.cfg.LeaseDuration.Milliseconds(), d.hostname)
	if err != nil {
		return nil, fmt.Errorf("outbox: claim query: %w", err)
	}
	defer rows.Close()
	var out []Row
	for rows.Next() {
		var r Row
		if err := rows.Scan(&r.ID, &r.EventType, &r.VehicleID, &r.VIN,
			&r.Payload, &r.Headers, &r.Attempts, &r.TraceID, &r.CreatedAt); err != nil {
			return nil, fmt.Errorf("outbox: claim scan: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (d *Dispatcher) publishOne(ctx context.Context, row Row) error {
	ctx, span := dispatcherTracer().Start(ctx, "outbox.publish",
		oteltrace.WithAttributes(
			attribute.Int64("outbox.id", row.ID),
			attribute.String("outbox.event_type", row.EventType),
			attribute.Int("outbox.attempt", row.Attempts+1),
		))
	defer span.End()
	if err := d.publisher.PublishOutbox(ctx, row); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "publish")
		return err
	}
	return nil
}

func (d *Dispatcher) markPublished(ctx context.Context, id int64) error {
	const query = `
UPDATE events_outbox
   SET status = 'published', published_at = NOW(),
       lease_until = NULL, lease_holder = NULL, last_error = NULL
 WHERE id = $1`
	_, err := d.store.pool.Exec(ctx, query, id)
	if err != nil {
		log.Warn().Err(err).Int64("id", id).Msg("outbox: mark published failed")
	}
	return err
}

func (d *Dispatcher) markRetry(ctx context.Context, row Row, cause error) error {
	delay := backoff(row.Attempts, d.cfg.BackoffBase, d.cfg.BackoffMax)
	const query = `
UPDATE events_outbox
   SET status = 'pending', attempts = attempts + 1,
       next_attempt_at = NOW() + ($2::bigint || ' milliseconds')::interval,
       lease_until = NULL, lease_holder = NULL,
       last_error = $3
 WHERE id = $1`
	_, err := d.store.pool.Exec(ctx, query, row.ID, delay.Milliseconds(), truncateError(cause))
	if err != nil {
		log.Warn().Err(err).Int64("id", row.ID).Msg("outbox: mark retry failed")
	}
	return err
}

func (d *Dispatcher) markFailed(ctx context.Context, id int64, cause error) error {
	const query = `
UPDATE events_outbox
   SET status = 'failed', attempts = attempts + 1,
       lease_until = NULL, lease_holder = NULL,
       last_error = $2
 WHERE id = $1`
	_, err := d.store.pool.Exec(ctx, query, id, truncateError(cause))
	if err != nil {
		log.Warn().Err(err).Int64("id", id).Msg("outbox: mark failed failed")
	}
	return err
}

// isTerminal returns true when row.Attempts is already at or above
// MaxAttempts-1; this attempt was the last.
func isTerminal(row Row, maxAttempts int) bool {
	return row.Attempts+1 >= maxAttempts
}

// Backoff returns an exponentially-increasing delay capped by max.
// Doubling from base: base, 2*base, 4*base, ... up to max. Exported
// so tests and operator tooling can predict next_attempt_at.
func Backoff(attemptsSoFar int, base, max time.Duration) time.Duration {
	return backoff(attemptsSoFar, base, max)
}

func backoff(attemptsSoFar int, base, max time.Duration) time.Duration {
	if attemptsSoFar < 0 {
		attemptsSoFar = 0
	}
	if attemptsSoFar > 30 {
		attemptsSoFar = 30
	}
	mult := math.Pow(2, float64(attemptsSoFar))
	dur := time.Duration(float64(base) * mult)
	if dur > max || dur < 0 {
		return max
	}
	return dur
}

// truncateError clips the error string so a freak 100KB error from
// pgx (e.g., the full SQL echoed back) does not blow up the
// last_error column. 1024 chars is plenty for forensics.
func truncateError(err error) string {
	if err == nil {
		return ""
	}
	s := err.Error()
	const max = 1024
	if len(s) > max {
		return s[:max] + "...[truncated]"
	}
	return s
}
