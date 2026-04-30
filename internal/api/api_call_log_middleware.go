// Package api: APICallLog inbound middleware.
//
// This middleware persists every inbound HTTP request that flows through it
// to the api_call_logs hypertable with service="teslasync-api". The recorder
// is invoked from a defer registered before next.ServeHTTP, so panic→500
// responses (converted by RecoveryMiddleware upstream) are still recorded
// with status_code=500.
//
// The middleware is non-blocking: enqueues are bounded by a buffered channel
// and a worker goroutine batch-inserts via pgx.CopyFrom. On queue full the
// entry is dropped, a Prometheus counter (api_call_log_drops_total) is
// incremented, and a single zerolog Warn line is emitted (no error returned
// to the caller, no synchronous DB write on the request goroutine).
//
// Bodies are captured up to 10 KB each (request and response) only when the
// captureBodies flag is true; default is false (operator opt-in).
//
// Redaction: query params and header names matching (?i)token|key|secret|
// password|cookie are replaced with "REDACTED". JSON bodies have matching
// keys replaced recursively. Authorization and Cookie headers are always
// redacted.
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"runtime/debug"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/rs/zerolog/log"
)

const (
	// MaxAPILogBodyBytes caps the per-body capture (request and response) at
	// 10 KB to keep storage bounded; bodies exceeding this are truncated and
	// a "truncated=true" marker is added.
	MaxAPILogBodyBytes = 10 * 1024

	// DefaultAPILogQueueCapacity is the default buffered channel size for
	// the async writer when not overridden via API_LOG_QUEUE_CAPACITY.
	DefaultAPILogQueueCapacity = 4096

	// DefaultAPILogBatchSize is the default number of entries that the
	// async writer accumulates before flushing via pgx.CopyFrom.
	DefaultAPILogBatchSize = 100

	// DefaultAPILogFlushInterval is the maximum age of a buffered entry
	// before the async writer flushes regardless of batch size.
	DefaultAPILogFlushInterval = 1 * time.Second

	// APILogServiceTag is the constant service= value written to
	// api_call_logs.service for every entry persisted by this middleware.
	APILogServiceTag = "teslasync-api"

	// truncationMarker is appended to bodies that exceeded MaxAPILogBodyBytes.
	truncationMarker = "... [truncated]"
)

// apiCallLogDropsCounter counts entries dropped by the async writer because
// the buffered channel was full at Enqueue time. This is the contract metric
// referenced by the Prompt 09 test matrix (T07, T13).
var apiCallLogDropsCounter = promauto.NewCounter(prometheus.CounterOpts{
	Name: "api_call_log_drops_total",
	Help: "Total api_call_log entries dropped due to async writer queue full.",
})

// redactKeyPattern matches header names, query parameter names and JSON keys
// that may carry secret material; matching values are replaced with REDACTED.
var redactKeyPattern = regexp.MustCompile(`(?i)token|key|secret|password|cookie`)

// APICallLogger is the writer port the middleware depends on. Implementations
// MUST make Enqueue non-blocking (drop-on-full) and Shutdown drain-with-deadline.
type APICallLogger interface {
	// Enqueue adds an entry for asynchronous persistence. MUST NOT block the
	// caller; on queue full the entry is dropped and the drop counter is
	// incremented. After Shutdown returns, Enqueue is a silent no-op (still
	// counts as a drop).
	Enqueue(*models.APICallLog)

	// Shutdown closes the input channel, drains pending entries to the
	// underlying inserter (subject to ctx deadline), and from then on
	// Enqueue silently drops. Safe to call concurrently with in-flight
	// Enqueues from request goroutines (those will drop, not panic).
	Shutdown(ctx context.Context) error
}

// APICallLogBatchInserter is the database port the async writer uses to
// flush a batch of entries. Production wiring uses
// (*database.APICallLogRepo).CreateBatch which is implemented via
// pgx.CopyFrom for low-overhead insertion.
type APICallLogBatchInserter interface {
	CreateBatch(ctx context.Context, batch []*models.APICallLog) error
}

// AsyncLoggerOptions tunes the async writer's queue and flush behavior. Zero
// values fall back to the Default* constants; a zero FlushInterval also falls
// back. Pass an explicit value via main.go from cfg.APILogs.* to override.
type AsyncLoggerOptions struct {
	QueueCapacity int
	BatchSize     int
	FlushInterval time.Duration
}

// asyncAPICallLogger is the production implementation of APICallLogger. It
// owns a buffered channel, a worker goroutine and a small in-memory batch.
// Drops are counted in apiCallLogDropsCounter; the worker stops when both
// the channel is closed and drained.
type asyncAPICallLogger struct {
	ch        chan *models.APICallLog
	inserter  APICallLogBatchInserter
	batchSize int
	flushEvry time.Duration
	done      chan struct{}
	closed    atomic.Bool
	closeOnce sync.Once

	// dropWarnRate limits the volume of "queue full" warn logs to one per
	// second so a sustained burst doesn't flood the log.
	lastWarnNs atomic.Int64
}

// NewAsyncAPICallLogger constructs the production async writer. The worker
// goroutine starts immediately; call Shutdown on graceful termination to
// drain pending entries.
func NewAsyncAPICallLogger(inserter APICallLogBatchInserter, opts AsyncLoggerOptions) APICallLogger {
	if inserter == nil {
		// Without an inserter the entries would have nowhere to go; fail
		// closed (no-op logger) rather than buffering forever.
		return &nullAPICallLogger{}
	}

	cap := opts.QueueCapacity
	if cap <= 0 {
		cap = DefaultAPILogQueueCapacity
	}
	bs := opts.BatchSize
	if bs <= 0 {
		bs = DefaultAPILogBatchSize
	}
	fi := opts.FlushInterval
	if fi <= 0 {
		fi = DefaultAPILogFlushInterval
	}

	a := &asyncAPICallLogger{
		ch:        make(chan *models.APICallLog, cap),
		inserter:  inserter,
		batchSize: bs,
		flushEvry: fi,
		done:      make(chan struct{}),
	}
	go a.run()
	return a
}

func (a *asyncAPICallLogger) Enqueue(entry *models.APICallLog) {
	if entry == nil {
		return
	}
	if a.closed.Load() {
		apiCallLogDropsCounter.Inc()
		return
	}
	// Non-blocking: select { case a.ch <- entry: default: drop+counter }
	select {
	case a.ch <- entry:
		// queued
	default:
		apiCallLogDropsCounter.Inc()
		a.warnDrop("api_call_log queue full")
	}
}

func (a *asyncAPICallLogger) warnDrop(reason string) {
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

func (a *asyncAPICallLogger) Shutdown(ctx context.Context) error {
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

func (a *asyncAPICallLogger) run() {
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
		// Reset slice but keep underlying array to avoid reallocs.
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

// nullAPICallLogger is the disabled-mode logger. Used when API_LOGS_INBOUND_ENABLED=false
// or when the inserter is nil. All operations are silent no-ops.
type nullAPICallLogger struct{}

func (n *nullAPICallLogger) Enqueue(*models.APICallLog)     {}
func (n *nullAPICallLogger) Shutdown(context.Context) error { return nil }

// Package-level logger registry. main.go calls SetAPICallLogger after
// constructing the async writer; router.go reads the current value when
// installing the middleware on the /api/v1 group.
var (
	apiLoggerMu      sync.RWMutex
	currentAPILogger APICallLogger = &nullAPICallLogger{}
)

// SetAPICallLogger replaces the package-level logger and returns the previous
// value. Safe to call from main.go on startup and on shutdown for cleanup.
func SetAPICallLogger(l APICallLogger) APICallLogger {
	if l == nil {
		l = &nullAPICallLogger{}
	}
	apiLoggerMu.Lock()
	defer apiLoggerMu.Unlock()
	prev := currentAPILogger
	currentAPILogger = l
	return prev
}

// GetAPICallLogger returns the current package-level logger. Used by
// router.go when wiring the middleware.
func GetAPICallLogger() APICallLogger {
	apiLoggerMu.RLock()
	defer apiLoggerMu.RUnlock()
	return currentAPILogger
}

// DefaultAPILogSkip is the default skip predicate used when the router does
// not pass an explicit one. It excludes paths that would either create a
// feedback loop (admin api-logs UI) or are too high-frequency / streaming
// to log without producing noise.
func DefaultAPILogSkip(path string) bool {
	switch path {
	case "/healthz", "/readyz", "/metrics":
		return true
	case "/api/v1/admin/api-logs", "/api/v1/admin/api-logs/stats",
		"/api/v1/api-logs", "/api/v1/api-logs/stats",
		"/api/v1/events", "/api/v1/sse-token",
		"/api/v1/system/status":
		return true
	}
	return false
}

// APICallLogMiddleware wraps an http.Handler and enqueues an APICallLog entry
// for every request that does not match the skip predicate. The recorder is
// scheduled in a defer registered before next.ServeHTTP, so even handlers
// that panic and are converted to a 500 by an upstream RecoveryMiddleware
// are still recorded.
//
// captureBodies controls whether the request and response payloads are
// stored on the entry (truncated to MaxAPILogBodyBytes and JSON-key
// redacted). Operator default is false; enable only for diagnostic windows.
//
// skip is the per-path predicate; pass nil to use DefaultAPILogSkip.
func APICallLogMiddleware(logger APICallLogger, captureBodies bool, skip func(path string) bool) func(http.Handler) http.Handler {
	if logger == nil {
		logger = &nullAPICallLogger{}
	}
	if skip == nil {
		skip = DefaultAPILogSkip
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if skip(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}

			start := time.Now()
			ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)

			// Optional body capture. Request body is wrapped with a tee
			// reader so the handler still sees the full body; response
			// body is teed via chi's Tee helper into a capped buffer.
			var (
				reqBuf  *cappedBuffer
				respBuf *cappedBuffer
			)
			if captureBodies && r.Body != nil {
				reqBuf = newCappedBuffer(MaxAPILogBodyBytes)
				r.Body = teeReadCloser(r.Body, reqBuf)
			}
			if captureBodies {
				respBuf = newCappedBuffer(MaxAPILogBodyBytes)
				ww.Tee(respBuf)
			}

			defer func() {
				// Two recoveries are at play here:
				//   1. A handler panic. We convert it to 500 ourselves so
				//      the recorded entry shows status=500 (RecoveryMiddleware
				//      one layer up will see no panic and act as no-op).
				//   2. A recorder-internal panic. Guarded by an inner
				//      defer/recover so a recorder bug never takes down
				//      the request goroutine.
				if rec := recover(); rec != nil {
					stack := string(debug.Stack())
					log.Error().
						Str("method", r.Method).
						Str("path", r.URL.Path).
						Str("stack", stack).
						Str("panic", fmt.Sprintf("%v", rec)).
						Msg("panic recovered in APICallLogMiddleware")
					if ww.Status() == 0 {
						writeError(ww, http.StatusInternalServerError, "internal server error")
					}
				}

				defer func() {
					if rec := recover(); rec != nil {
						log.Error().Str("panic", fmt.Sprintf("%v", rec)).Msg("api_call_log recorder panic recovered")
					}
				}()

				duration := time.Since(start)
				sanitizedURL, _ := redactURLAndHeaders(r)

				entry := &models.APICallLog{
					Ts:         start.UTC(),
					Service:    APILogServiceTag,
					HTTPMethod: r.Method,
					Endpoint:   sanitizedURL,
					StatusCode: int16(ww.Status()),
					DurationMs: int32(duration.Milliseconds()),
				}
				// Defensive: status 0 means handler never wrote anything;
				// chi treats that as 200 by default. Mirror that.
				if entry.StatusCode == 0 {
					entry.StatusCode = http.StatusOK
				}

				if captureBodies {
					if reqBuf != nil && reqBuf.Len() > 0 {
						body := redactBodyBytes(reqBuf.Bytes(), reqBuf.truncated, contentType(r.Header.Get("Content-Type")))
						entry.RequestBody = &body
					}
					if respBuf != nil && respBuf.Len() > 0 {
						body := redactBodyBytes(respBuf.Bytes(), respBuf.truncated, contentType(ww.Header().Get("Content-Type")))
						entry.ResponseBody = &body
					}
				}

				logger.Enqueue(entry)
			}()

			next.ServeHTTP(ww, r)
		})
	}
}

// redactURLAndHeaders parses the request URL and headers, replacing query
// parameter values whose names match redactKeyPattern with REDACTED, and
// always redacting Authorization and Cookie header values. Returns the
// rewritten URL (path?query) and a sanitized header map. The original
// request is not mutated.
func redactURLAndHeaders(req *http.Request) (string, map[string]string) {
	u := *req.URL
	q := u.Query()
	for k := range q {
		if redactKeyPattern.MatchString(k) {
			q[k] = []string{"REDACTED"}
		}
	}
	u.RawQuery = q.Encode()
	sanitizedURL := u.RequestURI()

	headers := make(map[string]string, len(req.Header))
	for k, v := range req.Header {
		switch {
		case k == "Authorization", k == "Cookie", redactKeyPattern.MatchString(k):
			headers[k] = "REDACTED"
		case len(v) > 0:
			headers[k] = v[0]
		}
	}
	return sanitizedURL, headers
}

// contentType returns the bare media type without parameters.
func contentType(h string) string {
	if h == "" {
		return ""
	}
	if i := indexByte(h, ';'); i >= 0 {
		return trimSpace(h[:i])
	}
	return trimSpace(h)
}

func indexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}

func trimSpace(s string) string {
	start := 0
	for start < len(s) && (s[start] == ' ' || s[start] == '\t') {
		start++
	}
	end := len(s)
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t') {
		end--
	}
	return s[start:end]
}

// redactBodyBytes returns a redacted, possibly truncated string view of a
// captured body. JSON bodies have keys matching redactKeyPattern replaced
// with "REDACTED" recursively; non-JSON bodies are returned as-is. When the
// underlying capture truncated the source, the truncation marker is
// appended.
func redactBodyBytes(b []byte, truncated bool, ct string) string {
	out := b
	// Detect JSON either by content-type or by leading byte.
	isJSON := ct == "application/json" || ct == "text/json" ||
		(len(b) > 0 && (b[0] == '{' || b[0] == '['))
	if isJSON {
		if redacted, ok := redactJSONBody(b); ok {
			out = redacted
		}
	}
	s := string(out)
	if truncated {
		s += truncationMarker
	}
	return s
}

// redactJSONBody walks the JSON document and replaces every value whose key
// matches redactKeyPattern with "REDACTED", recursively into nested objects
// and arrays of objects. Returns (redacted, true) on success; (nil, false)
// if the input is not parseable JSON (caller should fall back to raw bytes).
func redactJSONBody(b []byte) ([]byte, bool) {
	var v any
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	if err := dec.Decode(&v); err != nil {
		return nil, false
	}
	redacted := redactValue(v)
	out, err := json.Marshal(redacted)
	if err != nil {
		return nil, false
	}
	return out, true
}

func redactValue(v any) any {
	switch val := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(val))
		for k, vv := range val {
			if redactKeyPattern.MatchString(k) {
				out[k] = "REDACTED"
				continue
			}
			out[k] = redactValue(vv)
		}
		return out
	case []any:
		out := make([]any, len(val))
		for i, vv := range val {
			out[i] = redactValue(vv)
		}
		return out
	default:
		return v
	}
}

// cappedBuffer is an io.Writer that accepts up to cap bytes and silently
// discards the rest. The truncated flag is set when at least one byte was
// dropped.
type cappedBuffer struct {
	buf       bytes.Buffer
	cap       int
	truncated bool
}

func newCappedBuffer(cap int) *cappedBuffer { return &cappedBuffer{cap: cap} }

func (c *cappedBuffer) Write(p []byte) (int, error) {
	if c == nil {
		return len(p), nil
	}
	remaining := c.cap - c.buf.Len()
	if remaining <= 0 {
		c.truncated = true
		return len(p), nil
	}
	if len(p) > remaining {
		c.buf.Write(p[:remaining])
		c.truncated = true
		return len(p), nil
	}
	return c.buf.Write(p)
}

func (c *cappedBuffer) Len() int      { return c.buf.Len() }
func (c *cappedBuffer) Bytes() []byte { return c.buf.Bytes() }

// teeReadCloser wraps a request Body so reads are mirrored into w (capped),
// then forwards Close to the underlying Body. The handler still sees the
// full body; w receives at most cappedBuffer.cap bytes.
func teeReadCloser(rc io.ReadCloser, w io.Writer) io.ReadCloser {
	return &teeReader{r: io.TeeReader(rc, w), c: rc}
}

type teeReader struct {
	r io.Reader
	c io.Closer
}

func (t *teeReader) Read(p []byte) (int, error) { return t.r.Read(p) }
func (t *teeReader) Close() error               { return t.c.Close() }
