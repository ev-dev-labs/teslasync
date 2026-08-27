// Package api wires the inbound api_call_logs middleware.
//
// Requests are enqueued non-blockingly and batch-inserted by internal/apilog;
// the HTTP wrapper stays here because it depends on chi and local redaction
// helpers. Optional body capture is capped at 10 KB and recursively redacts
// secret-like headers, query parameters, and JSON keys.
package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"runtime/debug"
	"sync"
	"time"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	"github.com/ev-dev-labs/teslasync/internal/apilog"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog/log"
)

const (
	// MaxAPILogBodyBytes caps the per-body capture (request and response) at
	// 10 KB to keep storage bounded; bodies exceeding this are truncated and
	// a "truncated=true" marker is added.
	MaxAPILogBodyBytes = 10 * 1024

	// DefaultAPILogQueueCapacity is the default buffered channel size for
	// the async writer when not overridden via API_LOG_QUEUE_CAPACITY.
	//
	// Deprecated: use apilog.DefaultQueueCapacity.
	DefaultAPILogQueueCapacity = apilog.DefaultQueueCapacity

	// DefaultAPILogBatchSize is the default number of entries that the
	// async writer accumulates before flushing via pgx.CopyFrom.
	//
	// Deprecated: use apilog.DefaultBatchSize.
	DefaultAPILogBatchSize = apilog.DefaultBatchSize

	// DefaultAPILogFlushInterval is the maximum age of a buffered entry
	// before the async writer flushes regardless of batch size.
	//
	// Deprecated: use apilog.DefaultFlushInterval.
	DefaultAPILogFlushInterval = apilog.DefaultFlushInterval

	// APILogServiceTag is the constant service= value written to
	// api_call_logs.service for every entry persisted by this middleware.
	APILogServiceTag = "teslasync-api"

	// truncationMarker is appended to bodies that exceeded MaxAPILogBodyBytes.
	truncationMarker = "... [truncated]"
)

// redactKeyPattern matches header names, query parameter names and JSON keys
// that may carry credentials or private vehicle/identity data; matching values
// are replaced with REDACTED before optional diagnostic body capture.
var redactKeyPattern = regexp.MustCompile(`(?i)(?:^|[_-])(?:access[_-]?token|access[_-]?key|account[_-]?key|api[_-]?key|auth|authorization|cookie|email|key|keys|latitude|longitude|location|p256dh|password|private[_-]?key|refresh[_-]?token|secret|signing[_-]?key|subject|token|user[_-]?key|vin)(?:$|[_-])`)

// opaqueVehicleManagementPathPattern identifies pricing and state-changing
// payer requests whose undocumented payloads and responses must never be
// captured. An optional trailing slash is covered so a router redirect or 404
// cannot persist a submitted opaque object. The local vehicle id remains
// available to the handler's structured operation/status log.
var opaqueVehicleManagementPathPattern = regexp.MustCompile(
	`^/api/v1/(?:tesla/vehicle-pricing|vehicles/[^/]+/enterprise-payer)/?$`,
)

// APICallLogger is the writer port the middleware depends on.
//
// Deprecated: use apilog.Logger. Will be removed in phase-48.
type APICallLogger = apilog.Logger

// APICallLogBatchInserter is the database port the async writer uses to flush a batch.
//
// Deprecated: use apilog.BatchInserter. Will be removed in phase-48.
type APICallLogBatchInserter = apilog.BatchInserter

// AsyncLoggerOptions tunes the async writer's queue and flush behavior.
//
// Deprecated: use apilog.AsyncOptions. Will be removed in phase-48.
type AsyncLoggerOptions = apilog.AsyncOptions

// NewAsyncAPICallLogger constructs the production async writer.
//
// Deprecated: use apilog.NewAsync. Will be removed in phase-48.
func NewAsyncAPICallLogger(inserter APICallLogBatchInserter, opts AsyncLoggerOptions) APICallLogger {
	return apilog.NewAsync(inserter, opts)
}

// APICallSinkAdapter constructs an httputil.APICallSink backed by the
// supplied logger.
//
// Deprecated: use apilog.SinkAdapter. Will be removed in phase-48.
func APICallSinkAdapter(logger APICallLogger, captureBodies bool) httputil.APICallSink {
	return apilog.SinkAdapter(logger, captureBodies)
}

// Package-level logger registry. main.go calls SetAPICallLogger after
// constructing the async writer; router.go reads the current value when
// installing the middleware on the /api/v1 group.
var (
	apiLoggerMu      sync.RWMutex
	currentAPILogger APICallLogger = apilog.NewNoop()
)

// SetAPICallLogger replaces the package-level logger and returns the previous
// value. Safe to call from main.go on startup and on shutdown for cleanup.
func SetAPICallLogger(l APICallLogger) APICallLogger {
	if l == nil {
		l = apilog.NewNoop()
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
	return opaqueVehicleManagementPathPattern.MatchString(path)
}

// APICallLogMiddleware enqueues one sanitized log entry per non-skipped request.
// It records in a defer so recovered panics are captured as 500s. Body capture
// is operator opt-in, capped, and intended only for diagnostic windows.
func APICallLogMiddleware(logger APICallLogger, captureBodies bool, skip func(path string) bool) func(http.Handler) http.Handler {
	if logger == nil {
		logger = apilog.NewNoop()
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

				entry := &teslamodel.APICallLog{
					Ts:         start.UTC(),
					Service:    APILogServiceTag,
					HTTPMethod: r.Method,
					Endpoint:   sanitizedURL,
					StatusCode: int16(ww.Status()),
					DurationMs: int32(duration.Milliseconds()),
				}
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
// then forwards Close to the underlying Body.
func teeReadCloser(rc io.ReadCloser, w io.Writer) io.ReadCloser {
	return &teeReader{r: io.TeeReader(rc, w), c: rc}
}

type teeReader struct {
	r io.Reader
	c io.Closer
}

func (t *teeReader) Read(p []byte) (int, error) { return t.r.Read(p) }
func (t *teeReader) Close() error               { return t.c.Close() }
