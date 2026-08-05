package provider

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sync"
	"sync/atomic"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/cost"
)

// AuditRecord is the wire shape of one ai_call_log row, decoupled from
// the database schema so the provider package does not import database.
//
// Field order is significant — UserSubject + FeatureID come first
// because they are the most-asked-about facets in the usage card.
type AuditRecord struct {
	UserSubject    string    // FORWARD_AUTH_HEADER subject; "" in open mode.
	FeatureID      string    // Registry ID; defence-checked at insert.
	Provider       string    // "ollama" / "openai" / "anthropic" / "mock".
	Model          string    // Vendor model id at request time.
	InputTokens    int       // Prompt tokens. 0 = unknown.
	OutputTokens   int       // Completion tokens. 0 = unknown.
	CostMicroCents int64     // Computed by [cost.Compute] at insert time.
	LatencyMs      int       // Wall clock (FinishedAt - StartedAt) in ms.
	FinishReason   string    // Provider FinishReason or "" on hard error.
	RequestHash    string    // sha256(model || canonical-JSON(messages)).
	RedactedDigest string    // sha256(redacted prompt) — same as request_hash until F8 ships.
	Error          string    // Truncated provider error message; "" on success.
	StartedAt      time.Time // UTC, populated by the decorator pre-call.
	FinishedAt     time.Time // UTC, populated post-call.
}

// AuditSink is the synchronous insert API the database repo
// implements. The decorator never calls it directly — the
// [AsyncAuditWriter] drainer does — but it is exported so tests can
// substitute a slice-recorder.
type AuditSink interface {
	Insert(ctx context.Context, rec *AuditRecord) error
}

// AuditWriter is the non-blocking submit API the decorator uses.
// Production wiring constructs an [AsyncAuditWriter] that satisfies it
// by buffering into a channel + drainer goroutine; tests can supply a
// trivial implementation that appends to a slice under a mutex.
type AuditWriter interface {
	// Submit enqueues rec for asynchronous persistence. The call MUST
	// return promptly (no DB round-trip on the caller goroutine) and
	// MUST NOT block — a full buffer drops the OLDEST queued record
	// rather than back-pressure the request hot path.
	Submit(rec AuditRecord)
}

// auditDropTotal counts records dropped by the async buffer when the
// channel is full. Surfaces the back-pressure signal in /metrics so
// ops can spot a stuck DB writer before the user notices a gap in
// the usage card. Namespace matches the rest of TeslaSync's metrics.
var auditDropTotal = promauto.NewCounter(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "ai_call_log_drop_total",
	Help:      "Audit log records dropped because the async buffer was full. Non-zero indicates the DB writer is lagging.",
})

// AsyncAuditWriter is the production [AuditWriter] implementation. It
// owns a bounded channel + a single drainer goroutine that flushes to
// the supplied [AuditSink] one record at a time. The drainer exits
// when the supplied context is cancelled (typically the app
// background context at graceful shutdown).
//
// Rationale for one goroutine, not a worker pool: audit volume is
// bounded by user-initiated AI calls (≪ 1 RPS in normal use). A pool
// would not improve throughput and would add an interleave hazard
// where two rows from one streaming call land out of order.
type AsyncAuditWriter struct {
	sink     AuditSink
	ch       chan AuditRecord
	stopOnce sync.Once
	stopped  atomic.Bool
}

// NewAsyncAuditWriter starts a drainer goroutine that lives until ctx
// is cancelled. bufSize is the channel capacity; production callers
// pick 1024 — large enough to absorb a burst, small enough that a
// stuck DB writer triggers the drop counter quickly so ops notice.
func NewAsyncAuditWriter(ctx context.Context, sink AuditSink, bufSize int) *AsyncAuditWriter {
	if sink == nil {
		panic("ai/provider: NewAsyncAuditWriter called with nil sink")
	}
	if bufSize <= 0 {
		bufSize = 1024
	}
	w := &AsyncAuditWriter{
		sink: sink,
		ch:   make(chan AuditRecord, bufSize),
	}
	go w.drain(ctx)
	return w
}

// Submit is the non-blocking enqueue. On a full channel it removes the
// OLDEST queued record (so the buffer always represents the most
// recent activity, which is what an operator inspecting the usage
// card cares about) and bumps the drop counter.
func (w *AsyncAuditWriter) Submit(rec AuditRecord) {
	if w == nil || w.stopped.Load() {
		return
	}
	for {
		select {
		case w.ch <- rec:
			return
		default:
			// Channel full. Drop the oldest record and retry. The
			// drop is non-fatal for ops because the failed write
			// surfaces in /metrics; keeping the queue limited
			// guarantees we never balloon under sustained load.
			select {
			case <-w.ch:
				auditDropTotal.Inc()
			default:
				// Drainer raced and emptied the buffer in between
				// our two select arms. Loop and try the send again.
			}
		}
	}
}

// drain reads from the buffered channel and persists each record via
// the sink. A persistence error is logged + counted but never raised
// to the caller — losing an audit row is preferable to losing the
// drainer goroutine and silently breaking every subsequent write.
func (w *AsyncAuditWriter) drain(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			// Best-effort flush of records still in the channel
			// before the goroutine exits. Bounded by buffer size so
			// shutdown can never block forever.
			w.flushRemaining()
			return
		case rec := <-w.ch:
			if err := w.sink.Insert(ctx, &rec); err != nil {
				log.Warn().
					Err(err).
					Str("feature_id", rec.FeatureID).
					Str("provider", rec.Provider).
					Msg("ai_call_log insert failed")
			}
		}
	}
}

// flushRemaining drains the channel non-blocking after ctx cancel.
// Uses a fresh background context so a cancelled drain ctx does not
// abort the final inserts. Bounded by len(ch) so it cannot loop.
func (w *AsyncAuditWriter) flushRemaining() {
	for {
		select {
		case rec := <-w.ch:
			_ = w.sink.Insert(context.Background(), &rec)
		default:
			return
		}
	}
}

// Stop marks the writer as stopped. New Submits are silently dropped
// after Stop returns. The drainer goroutine exits when its parent ctx
// is cancelled — Stop is exposed only so tests can deterministically
// reject post-test submits.
func (w *AsyncAuditWriter) Stop() {
	w.stopOnce.Do(func() {
		w.stopped.Store(true)
	})
}

// Context keys for passing the request principal + feature ID through
// to the audit decorator. Concrete unique types so a key collision
// between packages is impossible (Go's recommended pattern).
type ctxKey int

const (
	ctxKeyUserSubject ctxKey = iota + 1
	ctxKeyFeatureID
)

// WithSubject returns a derived context carrying subject, used by the
// audit decorator to populate AuditRecord.UserSubject. The handler
// passes the empty string in open mode; the decorator stores ” which
// the usage queries treat as "system / open mode" rows.
func WithSubject(ctx context.Context, subject string) context.Context {
	return context.WithValue(ctx, ctxKeyUserSubject, subject)
}

// WithFeatureID returns a derived context carrying featureID, used by
// the audit decorator to populate AuditRecord.FeatureID. The handler
// MUST set this before calling Provider.{Chat,Stream,Embed} so the
// audit row can attribute the call to the right toggle in the usage
// card.
func WithFeatureID(ctx context.Context, featureID string) context.Context {
	return context.WithValue(ctx, ctxKeyFeatureID, featureID)
}

// SubjectFromContext is the symmetric reader of WithSubject. Returns
// "" when the key is absent so the decorator can record open-mode
// calls without special-casing.
func SubjectFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(ctxKeyUserSubject).(string); ok {
		return v
	}
	return ""
}

// FeatureIDFromContext is the symmetric reader of WithFeatureID.
// Returns "" if the key is absent — the decorator treats that as a
// programming error and records the row with feature_id="" so the
// drift is visible in the usage card rather than silently swallowed.
func FeatureIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(ctxKeyFeatureID).(string); ok {
		return v
	}
	return ""
}

// errorMaxBytes caps the stored error message so a chatty upstream
// cannot inflate the row size. 4 KiB is enough for a stack trace tail
// + the wrapped vendor error code.
const errorMaxBytes = 4096

// WithAudit returns the audit decorator. Wraps every Chat / Stream /
// Embed in timing + tokenisation + cost calculation, then submits one
// AuditRecord asynchronously via writer. The hot path is never
// blocked on the database.
//
// nil writer is allowed (acts as a passthrough) so tests + the
// off-mode wiring can disable auditing without a code branch at the
// call site.
func WithAudit(writer AuditWriter) Decorator {
	return func(p Provider) Provider {
		if writer == nil {
			return p
		}
		return &auditedProvider{inner: p, name: p.Name(), writer: writer}
	}
}

type auditedProvider struct {
	inner  Provider
	name   string
	writer AuditWriter
}

func (a *auditedProvider) Name() string               { return a.inner.Name() }
func (a *auditedProvider) Capabilities() Capabilities { return a.inner.Capabilities() }

func (a *auditedProvider) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	started := time.Now().UTC()
	resp, err := a.inner.Chat(ctx, req)
	finished := time.Now().UTC()

	rec := a.baseRecord(ctx, req, started, finished)
	if err != nil {
		rec.Error = truncateError(err.Error())
		a.writer.Submit(rec)
		return nil, err
	}
	rec.InputTokens = resp.InputTokens
	rec.OutputTokens = resp.OutputTokens
	rec.FinishReason = resp.FinishReason
	rec.CostMicroCents = cost.Compute(a.name, req.Model, resp.InputTokens, resp.OutputTokens)
	a.writer.Submit(rec)
	return resp, nil
}

func (a *auditedProvider) Stream(ctx context.Context, req ChatRequest) (<-chan Chunk, error) {
	started := time.Now().UTC()
	src, err := a.inner.Stream(ctx, req)
	if err != nil {
		// Synchronous failure (adapter could not even open the
		// stream). Record it as a zero-token call with the error.
		rec := a.baseRecord(ctx, req, started, time.Now().UTC())
		rec.Error = truncateError(err.Error())
		a.writer.Submit(rec)
		return nil, err
	}
	out := make(chan Chunk, cap(src))
	go a.relayAndAudit(ctx, req, started, src, out)
	return out, nil
}

// relayAndAudit forwards chunks unchanged and submits one audit row
// after the stream terminates (closes or errors). Provider-supplied terminal
// usage wins; when unavailable, output usage falls back to the sum of delta
// lengths in runes.
func (a *auditedProvider) relayAndAudit(
	ctx context.Context,
	req ChatRequest,
	started time.Time,
	src <-chan Chunk,
	out chan<- Chunk,
) {
	defer close(out)
	var (
		runeCount    int
		inputTokens  int
		outputTokens int
		finishReason string
		streamErr    error
	)
	submit := func(err error) {
		rec := a.baseRecord(ctx, req, started, time.Now().UTC())
		rec.InputTokens = inputTokens
		if outputTokens > 0 {
			rec.OutputTokens = outputTokens
		} else {
			rec.OutputTokens = runeCount
		}
		rec.FinishReason = finishReason
		rec.CostMicroCents = cost.Compute(a.name, req.Model, rec.InputTokens, rec.OutputTokens)
		if err != nil {
			rec.Error = truncateError(err.Error())
		}
		a.writer.Submit(rec)
	}
	for {
		select {
		case <-ctx.Done():
			streamErr = ctx.Err()
			submit(streamErr)
			return
		case c, ok := <-src:
			if !ok {
				submit(streamErr)
				return
			}
			if c.Delta != "" {
				runeCount += len([]rune(c.Delta))
			}
			if c.Err != nil {
				streamErr = c.Err
			}
			select {
			case out <- c:
			case <-ctx.Done():
				streamErr = ctx.Err()
				submit(streamErr)
				return
			}
			if c.Done || c.Err != nil {
				if c.Done {
					finishReason = c.FinishReason
					if finishReason == "" {
						finishReason = FinishStop
					}
					inputTokens = c.InputTokens
					outputTokens = c.OutputTokens
				}
				submit(streamErr)
				return
			}
		}
	}
}

func (a *auditedProvider) Embed(ctx context.Context, req EmbedRequest) (*EmbedResponse, error) {
	started := time.Now().UTC()
	resp, err := a.inner.Embed(ctx, req)
	finished := time.Now().UTC()

	rec := AuditRecord{
		UserSubject:    SubjectFromContext(ctx),
		FeatureID:      FeatureIDFromContext(ctx),
		Provider:       a.name,
		Model:          req.Model,
		StartedAt:      started,
		FinishedAt:     finished,
		LatencyMs:      int(finished.Sub(started).Milliseconds()),
		RequestHash:    embedRequestHash(req),
		RedactedDigest: embedRequestHash(req),
	}
	if err != nil {
		rec.Error = truncateError(err.Error())
		a.writer.Submit(rec)
		return nil, err
	}
	rec.InputTokens = resp.InputTokens
	rec.CostMicroCents = cost.Compute(a.name, req.Model, resp.InputTokens, 0)
	a.writer.Submit(rec)
	return resp, nil
}

// baseRecord populates the shared subset of AuditRecord every code
// path in this decorator needs. Token counts + finish reason + cost
// are filled in by the caller after the result is known.
func (a *auditedProvider) baseRecord(ctx context.Context, req ChatRequest, started, finished time.Time) AuditRecord {
	hash := chatRequestHash(req)
	return AuditRecord{
		UserSubject:    SubjectFromContext(ctx),
		FeatureID:      FeatureIDFromContext(ctx),
		Provider:       a.name,
		Model:          req.Model,
		StartedAt:      started,
		FinishedAt:     finished,
		LatencyMs:      int(finished.Sub(started).Milliseconds()),
		RequestHash:    hash,
		RedactedDigest: hash, // Redaction may diverge from the raw request hash.
	}
}

// chatRequestHash is sha256(model || canonical-JSON(messages)). The
// JSON marshaller produces stable key ordering inside a struct value,
// which is what we need: two semantically identical requests produce
// the same hash, letting ops spot retry storms in the usage card.
//
// We deliberately do NOT hash Tools / Temperature / MaxTokens —
// retries by definition come from the same handler with the same
// request shape, so message content is the discriminator that matters.
func chatRequestHash(req ChatRequest) string {
	h := sha256.New()
	h.Write([]byte(req.Model))
	h.Write([]byte{0})
	if buf, err := json.Marshal(req.Messages); err == nil {
		h.Write(buf)
	}
	return hex.EncodeToString(h.Sum(nil))
}

// embedRequestHash is sha256(model || canonical-JSON(input)). Same
// rationale as chatRequestHash: stable across retries of the same
// embedding batch.
func embedRequestHash(req EmbedRequest) string {
	h := sha256.New()
	h.Write([]byte(req.Model))
	h.Write([]byte{0})
	if buf, err := json.Marshal(req.Input); err == nil {
		h.Write(buf)
	}
	return hex.EncodeToString(h.Sum(nil))
}

// truncateError trims s to errorMaxBytes runes (not bytes) so a
// multi-byte UTF-8 character at the boundary is not split. We use
// the rune slice rather than utf8.RuneCountInString + index math
// because the tail length is bounded (≤ 4 KiB) and the allocation is
// small.
func truncateError(s string) string {
	if s == "" {
		return ""
	}
	if len(s) <= errorMaxBytes {
		return s
	}
	runes := []rune(s)
	if len(runes) <= errorMaxBytes {
		return s
	}
	return string(runes[:errorMaxBytes])
}
