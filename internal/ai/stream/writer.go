package stream

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

// Event type discriminators emitted on the SSE wire. Keep these
// constants in lockstep with the AiStreamEvent union in
// web/src/hooks/useAiStream.ts — the contract test
// (tools/aistream-contract) verifies both sides reference every
// constant by literal.
const (
	EventDelta          = "delta"
	EventToolCall       = "tool_call"
	EventToolResult     = "tool_result"
	EventConfirmRequest = "confirm_request"
	EventDone           = "done"
	EventError          = "error"
)

// channelCapacity is the bounded back-pressure channel size between
// the producer (dispatcher) and the consumer (HTTP pump). 64 frames
// covers a typical 4 KB LLM response (one frame per token, ~1 frame
// per ms on a fast local model) with headroom for tool-call bursts.
// A network stall lasting longer than ~64ms before stallTimeout
// fires is what triggers the explicit stall failure mode. R4: do
// NOT raise this without re-evaluating the trade-off — a deeper
// buffer hides upstream stalls instead of surfacing them.
const channelCapacity = 64

// defaultStallTimeout is the per-Send wait limit before the Writer
// declares the consumer stuck and tears the stream down. 5s matches
// the prompt's design and is a balance between accommodating a slow
// 4G client (~2s round-trip on a chunky frame) and surfacing a
// genuine wedge before the SPA hits its own timeout.
const defaultStallTimeout = 5 * time.Second

// Sentinel errors. Use errors.Is for inspection — decorators may wrap
// either with %w.
var (
	// ErrNotFlushable is returned by [New] when the supplied
	// http.ResponseWriter does not implement http.Flusher. SSE
	// without a flusher would buffer the entire stream until the
	// handler returned, defeating the point.
	ErrNotFlushable = errors.New("stream: ResponseWriter does not implement http.Flusher")

	// ErrWriterClosed is returned by Send/Write* methods after the
	// Writer has been closed (either by [Close], [WriteDone], or an
	// internal stall teardown). Callers should treat it as a no-op
	// signal — the stream is gone and the response has been (or is
	// being) terminated.
	ErrWriterClosed = errors.New("stream: writer is closed")

	// ErrStallTimeout is returned by Send when the consumer has not
	// drained a frame within the stall timeout. The Writer also
	// cancels the upstream context and emits a terminal error frame
	// best-effort. Callers should NOT continue using the Writer.
	ErrStallTimeout = errors.New("stream: consumer stalled past timeout")

	// ErrConsumerFailed is set on the Writer's drain error when the
	// HTTP transport rejected a write (typically the client closed
	// the connection). Returned to the producer on subsequent Send
	// calls so the dispatcher knows to unwind. Wrapped with %w
	// preserving the underlying transport error for diagnostics.
	ErrConsumerFailed = errors.New("stream: HTTP write failed")
)

// frame is the internal representation of one SSE event before
// serialisation. Type is the SSE `event:` line; Payload is what gets
// JSON-marshalled into the `data:` line.
type frame struct {
	Type    string
	Payload any
}

// Option tunes a [Writer] at construction time. Defined as a typed
// function so the public surface is small and forwards-compatible.
type Option func(*Writer)

// WithStallTimeout overrides the default 5s per-Send stall limit.
// A non-positive value is ignored (default applies).
func WithStallTimeout(d time.Duration) Option {
	return func(w *Writer) {
		if d > 0 {
			w.stallTimeout = d
		}
	}
}

// WithFeatureID labels the Prometheus metrics emitted by this Writer
// with the AI feature ID that owns the stream. Required for ops to
// distinguish chatbot stalls from digest narration stalls in the
// /metrics scrape.
func WithFeatureID(id string) Option {
	return func(w *Writer) {
		if id != "" {
			w.featureID = id
		}
	}
}

// Writer is the SSE writer. One Writer corresponds to exactly one
// in-flight HTTP response. It is constructed by an AI handler with
// [New], handed to the dispatcher as a [dispatch.StreamWriter], and
// torn down by [Close] (or implicitly by [WriteDone]) when the
// handler returns.
//
// All Send/Write* methods are safe for concurrent use, but the F4
// dispatcher contract is single-producer (one goroutine drives the
// chat loop). Multiple producers would interleave frames and
// require frame-level ordering guarantees we don't make.
type Writer struct {
	httpW        http.ResponseWriter
	flusher      http.Flusher
	ch           chan frame
	closeOnce    sync.Once
	closedCh     chan struct{}
	consumerDone chan struct{}
	cancel       context.CancelFunc

	stallTimeout time.Duration
	featureID    string
	startedAt    time.Time

	closed   atomic.Bool
	drainErr atomic.Value // error: set when the consumer hits a transport failure

	// lastToolCallID tracks the most-recently announced tool call so
	// WriteToolResult/WriteToolError can re-attach the originating
	// id to the SSE event (the dispatch.StreamWriter interface omits
	// the id from the result/error calls; the dispatcher contract
	// guarantees serial WriteToolCall → WriteToolResult/Error pairs).
	mu             sync.Mutex
	lastToolCallID string
}

// New constructs a Writer over httpW and starts the consumer
// goroutine. The returned context is a child of ctx that the Writer
// will cancel on stall — the handler should pass this child context
// into the dispatcher / provider so a stalled consumer interrupts the
// upstream call promptly.
//
// SSE response headers are written before New returns. After New
// returns successfully the handler MUST NOT call w.Header() / w.Write
// directly; everything goes through the Writer.
//
// On any setup failure (non-flushable ResponseWriter) New returns the
// original ctx unchanged and ErrNotFlushable. The handler should
// respond with 500 and abort.
func New(ctx context.Context, httpW http.ResponseWriter, opts ...Option) (*Writer, context.Context, error) {
	flusher, ok := httpW.(http.Flusher)
	if !ok {
		return nil, ctx, ErrNotFlushable
	}

	// SSE headers. Cache-Control prevents intermediaries from
	// buffering, X-Accel-Buffering disables nginx proxy buffering
	// (TeslaSync's prod ingress).
	h := httpW.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache, no-transform")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	httpW.WriteHeader(http.StatusOK)
	flusher.Flush()

	cctx, cancel := context.WithCancel(ctx)
	w := &Writer{
		httpW:        httpW,
		flusher:      flusher,
		ch:           make(chan frame, channelCapacity),
		closedCh:     make(chan struct{}),
		consumerDone: make(chan struct{}),
		cancel:       cancel,
		stallTimeout: defaultStallTimeout,
		featureID:    "unknown",
		startedAt:    time.Now(),
	}
	for _, o := range opts {
		o(w)
	}

	streamOpenTotal.WithLabelValues(w.featureID).Inc()
	go w.consume()
	return w, cctx, nil
}

// Send is the lowest-level entry point. Public so adapters or tests
// that need a custom event type can use it; production code should
// prefer the typed Write* helpers.
//
// Send BLOCKS the caller until either the consumer drains a slot, the
// Writer is closed (returns [ErrWriterClosed]), or the stall timeout
// elapses (returns [ErrStallTimeout] and tears the stream down).
func (w *Writer) Send(eventType string, payload any) error {
	if w.closed.Load() {
		return ErrWriterClosed
	}
	if dErr := w.drainErrLoad(); dErr != nil {
		return dErr
	}
	timer := time.NewTimer(w.stallTimeout)
	defer timer.Stop()
	select {
	case w.ch <- frame{Type: eventType, Payload: payload}:
		streamChunkTotal.WithLabelValues(w.featureID, eventType).Inc()
		return nil
	case <-w.closedCh:
		return ErrWriterClosed
	case <-timer.C:
		streamStallTotal.WithLabelValues(w.featureID).Inc()
		// Cancel upstream so the provider/dispatcher unwinds.
		w.cancel()
		// Best-effort terminal error frame. Non-blocking send so a
		// fully-jammed consumer cannot wedge the stall path itself.
		select {
		case w.ch <- frame{Type: EventError, Payload: errorPayload{Message: "stream_stalled"}}:
		default:
		}
		w.shutdown()
		return ErrStallTimeout
	}
}

// WriteDelta forwards a token-by-token text fragment. Empty strings
// are silently dropped (matching the dispatcher's contract).
//
// Implements [dispatch.StreamWriter].
func (w *Writer) WriteDelta(s string) error {
	if s == "" {
		return nil
	}
	return w.Send(EventDelta, deltaPayload{Text: s})
}

// WriteToolCall announces a model-proposed tool call. Records the
// call ID so a subsequent WriteToolResult/WriteToolError can attach
// it to the result frame.
//
// Implements [dispatch.StreamWriter].
func (w *Writer) WriteToolCall(call provider.ToolCall) error {
	w.mu.Lock()
	w.lastToolCallID = call.ID
	w.mu.Unlock()
	return w.Send(EventToolCall, toolCallPayload{
		ID:        call.ID,
		Name:      call.Name,
		Arguments: rawOrEmpty(call.Arguments),
	})
}

// WriteToolResult announces a successful tool execution. The result
// is the JSON-serialised return value of tools.Tool.Execute.
//
// Implements [dispatch.StreamWriter].
func (w *Writer) WriteToolResult(name string, result json.RawMessage) error {
	id := w.consumeLastToolCallID()
	return w.Send(EventToolResult, toolResultPayload{
		ID:   id,
		Name: name,
		OK:   true,
		Data: rawOrEmpty(result),
	})
}

// WriteToolError announces a failed tool validation or execution.
// Emitted on the wire as a tool_result event with ok=false and the
// truncated error message (LLMs and SPA both consume the same
// shape so the dispatcher's error → tool message contract stays
// uniform).
//
// Implements [dispatch.StreamWriter].
func (w *Writer) WriteToolError(name string, err error) error {
	id := w.consumeLastToolCallID()
	msg := ""
	if err != nil {
		msg = err.Error()
	}
	return w.Send(EventToolResult, toolResultPayload{
		ID:    id,
		Name:  name,
		OK:    false,
		Error: msg,
	})
}

// WriteConfirmRequest pauses the stream for a user mutating-tool
// confirmation. The continuationID is the persistent key the SPA
// will POST back to /ai/_internal/continue to resume. NOT part of
// the dispatch.StreamWriter interface — the dispatcher's confirm
// round-trip lives in the handler layer (slice U1+).
func (w *Writer) WriteConfirmRequest(continuationID, toolName string, args json.RawMessage, summary string) error {
	return w.Send(EventConfirmRequest, confirmRequestPayload{
		ContinuationID: continuationID,
		Tool:           toolName,
		Args:           rawOrEmpty(args),
		Summary:        summary,
	})
}

// WriteDone emits the terminal `done` event with the supplied finish
// reason and usage. Always closes the Writer afterwards (idempotent
// with [Close]).
//
// Idempotency: after the Writer has already been closed (typically
// because [WriteError] or [WriteLimitError] fired earlier in the
// dispatcher pipeline) calling WriteDoneFull is a no-op that returns
// nil. This lets the dispatcher's `defer w.WriteDone()` coexist with
// an early limit-error short-circuit without overwriting the real
// return error with [ErrWriterClosed].
//
// To match [dispatch.StreamWriter], the no-arg form is exposed via
// the [WriteDone] method below; this Done-with-args form is the one
// production handlers should call directly.
func (w *Writer) WriteDoneFull(finishReason string, usageIn, usageOut int) error {
	if w.closed.Load() {
		return nil // idempotent — see method doc.
	}
	err := w.Send(EventDone, donePayload{
		FinishReason: finishReason,
		Usage:        usageStats{In: usageIn, Out: usageOut},
	})
	w.shutdown()
	return err
}

// WriteDone emits a terminal done event with no usage info. Provided
// to satisfy [dispatch.StreamWriter] — production handlers should
// prefer [WriteDoneFull] so the SPA can render token counts in the
// usage card.
//
// Implements [dispatch.StreamWriter].
func (w *Writer) WriteDone() error {
	return w.WriteDoneFull("stop", 0, 0)
}

// WriteError emits a terminal error event. The Writer is closed
// afterwards so subsequent Sends return ErrWriterClosed.
func (w *Writer) WriteError(err error) error {
	if w.closed.Load() {
		return ErrWriterClosed
	}
	msg := "internal error"
	if err != nil {
		msg = err.Error()
	}
	sendErr := w.Send(EventError, errorPayload{Message: msg})
	w.shutdown()
	return sendErr
}

// LimitDecisionPayload is the SSE-wire shape of a [limit.Decision].
// Defined as a public type (not the limit.Decision itself) so the
// stream package does not import internal/ai/limit — the dispatcher
// translates limit.Decision into this shape at the call boundary.
//
// Field names are SSE-wire stable; the TS hook AiStreamEvent union
// in web/src/hooks/useAiStream.ts mirrors them and the contract test
// at tools/aistream-contract enforces the mirror.
type LimitDecisionPayload struct {
	// Reason is the stable lowercase token from limit.Decision.
	// See [limit.Decision] for the closed value set.
	Reason string `json:"reason"`

	// RetryAfterS is the number of seconds the client should wait
	// before retrying the same call. 0 means "do not auto-retry".
	RetryAfterS int `json:"retry_after_s,omitempty"`

	// BannerLevel is the recommended frontend banner urgency:
	// "" (none), "warn" (amber), "critical" (red).
	BannerLevel string `json:"banner_level,omitempty"`

	// BaselineAvailable is true when the user can fall back to a
	// non-AI baseline for this feature. The frontend banner shows
	// a "Use baseline" button only when this is true.
	BaselineAvailable bool `json:"baseline_available"`
}

// WriteLimitError emits a terminal `error` SSE event whose payload
// carries the structured rate-limiter / cost-cap [limit.Decision]
// fields in addition to a human-readable message. This is the
// primary surface the dispatcher uses when the provider chain
// returns a [*limit.LimitError] (R8 mitigation):
//
//   - The frontend's useAiStream parses the structured fields and
//     surfaces them via the AiLimitBanner component.
//   - The Writer is closed after Send so subsequent calls (including
//     a deferred [WriteDone]) are no-ops returning nil — see
//     [WriteDoneFull] for the idempotency contract.
//
// payload.BaselineAvailable=true is the F9 default — exhaustion of
// AI MUST NOT break the app per ADR-015 §I3. Strategies for which
// no baseline exists override this at the decorator wiring layer.
func (w *Writer) WriteLimitError(message string, payload LimitDecisionPayload) error {
	if w.closed.Load() {
		return ErrWriterClosed
	}
	if message == "" {
		if payload.Reason != "" {
			message = "ai limit hit: " + payload.Reason
		} else {
			message = "ai limit hit"
		}
	}
	sendErr := w.Send(EventError, limitErrorPayload{
		Message:           message,
		Reason:            payload.Reason,
		RetryAfterS:       payload.RetryAfterS,
		BannerLevel:       payload.BannerLevel,
		BaselineAvailable: payload.BaselineAvailable,
	})
	w.shutdown()
	return sendErr
}

// EmitLimitError satisfies the dispatch.LimitErrorEmitter optional
// interface so the dispatcher can dispatch a structured limit-error
// SSE frame without importing the stream package's payload type.
// The five-scalar signature matches dispatch.LimitErrorEmitter
// verbatim — Go's structural interface check pairs them at runtime.
//
// Implementation is the thin adapter to [WriteLimitError]; the
// payload struct is constructed inline so the SSE wire shape stays
// owned by the stream package.
func (w *Writer) EmitLimitError(message, reason string, retryAfterS int, bannerLevel string, baselineAvailable bool) error {
	return w.WriteLimitError(message, LimitDecisionPayload{
		Reason:            reason,
		RetryAfterS:       retryAfterS,
		BannerLevel:       bannerLevel,
		BaselineAvailable: baselineAvailable,
	})
}

// Close tears the stream down: stops accepting new sends, drains the
// consumer, cancels the upstream context, and unregisters the
// duration metric. Safe to call multiple times. Always safe to defer.
//
// Returns the underlying drain error (the transport failure that
// caused a consumer goroutine exit) or nil on a clean shutdown.
func (w *Writer) Close() error {
	w.shutdown()
	return w.drainErrLoad()
}

// Wait blocks until the consumer goroutine has fully drained the
// channel and exited. Useful in tests and in production handlers
// that need to know the response body has been fully written before
// returning. Combined with [Close] this gives a deterministic
// teardown.
func (w *Writer) Wait() {
	<-w.consumerDone
}

// FeatureID returns the label this Writer's metrics carry. Exposed
// for tests.
func (w *Writer) FeatureID() string { return w.featureID }

// shutdown performs the idempotent close: marks the Writer closed,
// closes the producer channel (signalling the consumer to drain
// remaining frames and exit), and cancels the upstream context so
// any in-flight provider call unwinds promptly.
func (w *Writer) shutdown() {
	w.closeOnce.Do(func() {
		w.closed.Store(true)
		close(w.closedCh)
		close(w.ch)
		w.cancel()
		// Record stream duration once at shutdown.
		streamDurationSeconds.WithLabelValues(w.featureID).Observe(time.Since(w.startedAt).Seconds())
	})
}

// consume is the consumer goroutine. It owns the http.ResponseWriter
// + Flusher exclusively — no other goroutine writes to either after
// New returns.
func (w *Writer) consume() {
	defer close(w.consumerDone)
	for fr := range w.ch {
		if err := w.writeFrame(fr); err != nil {
			// Record the error so the next Send returns it. The
			// producer cannot read the response writer's failure
			// state any other way (Go's net/http hides write errors
			// behind a "client gone" abstraction in some
			// implementations).
			w.drainErr.Store(struct{ err error }{err: fmt.Errorf("%w: %v", ErrConsumerFailed, err)})
			// Drain remaining frames without writing so the
			// producer's next Send observes the closed channel
			// (after shutdown) or the drain error.
			w.drainAfterFailure()
			return
		}
		w.flusher.Flush()
	}
}

// drainAfterFailure pulls remaining frames off the channel without
// attempting to write them. Called after the HTTP transport has
// rejected a write — continuing to call Write on a broken connection
// is allowed by net/http but produces no useful effect.
func (w *Writer) drainAfterFailure() {
	for range w.ch {
		// drop
	}
	streamCancelTotal.WithLabelValues(w.featureID).Inc()
}

// writeFrame serialises one frame to the SSE wire. Format:
//
//	event: <type>\n
//	data: <json>\n
//	\n
//
// The trailing blank line is significant — it's the SSE event
// terminator. Some intermediaries swallow events without it.
func (w *Writer) writeFrame(fr frame) error {
	body, err := json.Marshal(fr.Payload)
	if err != nil {
		// Unexpected: payloads are typed structs marshallable by
		// definition. Substitute a marshal-error frame so the SPA
		// sees something rather than a silent gap.
		body, _ = json.Marshal(errorPayload{Message: "internal: payload marshal failed"})
		fr.Type = EventError
	}
	if _, err := fmt.Fprintf(w.httpW, "event: %s\ndata: %s\n\n", fr.Type, body); err != nil {
		return err
	}
	return nil
}

func (w *Writer) consumeLastToolCallID() string {
	w.mu.Lock()
	id := w.lastToolCallID
	w.lastToolCallID = ""
	w.mu.Unlock()
	return id
}

func (w *Writer) drainErrLoad() error {
	v := w.drainErr.Load()
	if v == nil {
		return nil
	}
	if e, ok := v.(struct{ err error }); ok {
		return e.err
	}
	return nil
}

// rawOrEmpty returns r if non-nil, else a literal `null` payload.
// Avoids emitting `"arguments":` (no value) which is invalid JSON.
func rawOrEmpty(r json.RawMessage) json.RawMessage {
	if len(r) == 0 {
		return json.RawMessage("null")
	}
	return r
}

// --- typed event payloads ---
// Every payload is a small struct with `json` tags. The TS hook
// mirrors these field names; tools/aistream-contract enforces the
// mirror.

type deltaPayload struct {
	Text string `json:"text"`
}

type toolCallPayload struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

type toolResultPayload struct {
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	OK    bool            `json:"ok"`
	Data  json.RawMessage `json:"data,omitempty"`
	Error string          `json:"error,omitempty"`
}

type confirmRequestPayload struct {
	ContinuationID string          `json:"continuation_id"`
	Tool           string          `json:"tool"`
	Args           json.RawMessage `json:"args"`
	Summary        string          `json:"summary"`
}

type usageStats struct {
	In  int `json:"in"`
	Out int `json:"out"`
}

type donePayload struct {
	FinishReason string     `json:"finish_reason"`
	Usage        usageStats `json:"usage"`
}

type errorPayload struct {
	Message string `json:"message"`
}

// limitErrorPayload extends errorPayload with the structured fields
// pulled from a [limit.Decision] so the SPA's AiLimitBanner can
// render the right banner level + countdown without parsing the
// human-readable message. The Reason taxonomy is defined on
// [limit.Decision]; new reasons require a parallel update to the
// frontend i18n table.
type limitErrorPayload struct {
	Message           string `json:"message"`
	Reason            string `json:"reason,omitempty"`
	RetryAfterS       int    `json:"retry_after_s,omitempty"`
	BannerLevel       string `json:"banner_level,omitempty"`
	BaselineAvailable bool   `json:"baseline_available"`
}

// --- Prometheus metrics ---
//
// All metrics are labelled by feature_id so ops can attribute a stall
// or a cancel back to the AI feature that caused it. Cardinality is
// bounded by the registry (~40 features in Phase-50). NO drop counter
// — drops are forbidden by R4; if the system needs to drop frames
// the answer is to fail the stream loudly via stall.

var streamOpenTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "ai_stream_open_total",
	Help:      "AI SSE streams opened, by feature_id. Increments on stream.New.",
}, []string{"feature_id"})

var streamChunkTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "ai_stream_chunk_total",
	Help:      "Frames sent on AI SSE streams, by feature_id and event type.",
}, []string{"feature_id", "event"})

var streamStallTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "ai_stream_stall_total",
	Help:      "AI SSE Send calls that exceeded the consumer stall timeout, by feature_id. Non-zero indicates back-pressure beyond what the bounded channel can absorb.",
}, []string{"feature_id"})

var streamCancelTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "ai_stream_cancel_total",
	Help:      "AI SSE streams aborted by HTTP transport failure (typically client disconnect), by feature_id.",
}, []string{"feature_id"})

var streamDurationSeconds = promauto.NewHistogramVec(prometheus.HistogramOpts{
	Namespace: "teslasync",
	Name:      "ai_stream_duration_seconds",
	Help:      "Wall-clock duration of an AI SSE stream from New to shutdown, by feature_id.",
	Buckets:   []float64{0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120},
}, []string{"feature_id"})
