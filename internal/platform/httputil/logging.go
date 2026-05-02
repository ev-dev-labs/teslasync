package httputil

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/rs/zerolog/log"
)

// LoggedTransport wraps http.RoundTripper and logs every outbound
// request/response via zerolog. When Sink is non-nil it ALSO records each
// round-trip (success or network error) into the api_call_logs hypertable
// through the injected APICallSink.
//
// Sink is nil-safe: a nil sink falls back to today's behaviour (zerolog
// only). The sink call is wrapped in a recover() guard so a panicking sink
// can never break HTTP traffic for the caller.
type LoggedTransport struct {
	Base http.RoundTripper
	Name string // e.g., "tesla-api", "eia-api", "geocoder" — propagates as APICallRecord.Service.
	Sink APICallSink
}

// RoundTrip implements http.RoundTripper with structured logging and
// optional sink-backed persistence. Existing zerolog Debug/Error log lines
// are preserved verbatim; sink calls are purely additive.
func (t *LoggedTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	base := t.Base
	if base == nil {
		base = http.DefaultTransport
	}

	start := time.Now()
	sanitized := sanitizeURL(req.URL)

	// Snapshot the sink's body-capture toggle once per round-trip so the
	// operator can flip it without reconstructing clients.
	captureBodies := false
	if t.Sink != nil {
		captureBodies = safeCaptureBodies(t.Sink)
	}

	// Initialise the record up-front so the deferred Enqueue can still fire
	// on network errors (no response received).
	var record APICallRecord
	if t.Sink != nil {
		record = APICallRecord{
			Service: t.Name,
			Method:  req.Method,
			URL:     sanitized,
		}
	}

	// Capture the request body BEFORE calling the underlying transport
	// (transport will consume the body). We read up to MaxOutboundBodyBytes+1
	// so we can detect truncation by length, then reconstitute req.Body so
	// the transport sends the original bytes intact (MultiReader for the
	// truncated case).
	if captureBodies && req.Body != nil {
		reqBody, reqTruncated, restored, err := captureAndRestoreBody(req.Body, MaxOutboundBodyBytes)
		if err == nil {
			req.Body = restored
			if reqTruncated {
				record.RequestBody = TruncateBody(reqBody, MaxOutboundBodyBytes)
			} else {
				record.RequestBody = reqBody
			}
		}
	}

	log.Debug().
		Str("adapter", t.Name).
		Str("method", req.Method).
		Str("url", sanitized).
		Msg("httputil: outbound request")

	// Deferred sink call: ensures error paths still fire Enqueue. Wrapped
	// in an inner recover() so a panicking sink cannot break HTTP traffic.
	defer func() {
		if t.Sink == nil {
			return
		}
		defer func() {
			if rec := recover(); rec != nil {
				log.Error().
					Str("adapter", t.Name).
					Str("panic", fmt.Sprintf("%v", rec)).
					Msg("httputil: sink panic recovered")
			}
		}()
		record.DurationMs = int(time.Since(start).Milliseconds())
		t.Sink.Enqueue(record)
	}()

	resp, err := base.RoundTrip(req)
	latency := time.Since(start)

	if err != nil {
		log.Error().
			Str("adapter", t.Name).
			Str("method", req.Method).
			Str("url", sanitized).
			Int64("latency_ms", latency.Milliseconds()).
			Err(err).
			Msg("httputil: outbound request failed")
		if t.Sink != nil {
			record.ErrorMessage = err.Error()
		}
		return nil, err
	}

	if t.Sink != nil {
		record.StatusCode = resp.StatusCode
	}

	// Capture the response body via io.LimitReader so it remains readable
	// to the caller. We read up to MaxOutboundBodyBytes+1 to detect
	// truncation, then reconstitute resp.Body — for the truncated case the
	// caller's reads continue to flow from the original body for the
	// remaining bytes.
	if captureBodies && resp.Body != nil {
		respBody, respTruncated, restored, readErr := captureAndRestoreBody(resp.Body, MaxOutboundBodyBytes)
		if readErr != nil {
			log.Warn().
				Err(readErr).
				Str("adapter", t.Name).
				Msg("httputil: response body capture read error")
		} else {
			resp.Body = restored
			if respTruncated {
				record.ResponseBody = TruncateBody(respBody, MaxOutboundBodyBytes)
			} else {
				record.ResponseBody = respBody
			}
		}
	}

	log.Debug().
		Str("adapter", t.Name).
		Str("method", req.Method).
		Str("url", sanitized).
		Int("status", resp.StatusCode).
		Int64("latency_ms", latency.Milliseconds()).
		Int64("content_length", resp.ContentLength).
		Msg("httputil: outbound response")

	return resp, nil
}

// safeCaptureBodies invokes sink.CaptureBodies() under a recover() guard so
// a panicking implementation cannot break the round-trip. A panic is
// treated as "do not capture" (the safe default).
func safeCaptureBodies(sink APICallSink) (capture bool) {
	defer func() {
		if rec := recover(); rec != nil {
			log.Error().
				Str("panic", fmt.Sprintf("%v", rec)).
				Msg("httputil: sink CaptureBodies panic recovered")
			capture = false
		}
	}()
	return sink.CaptureBodies()
}

// captureAndRestoreBody reads up to limit+1 bytes from body via
// io.LimitReader, then returns:
//   - captured: the first up-to-limit bytes that were read (always
//     <= limit+1 in length; truncation is detected by len > limit).
//   - truncated: true when at least one byte beyond limit was buffered.
//   - restored: an io.ReadCloser that, when read, yields the captured
//     prefix followed by the remainder of the original body. Closing
//     restored closes the original body. The caller therefore continues
//     to see the full byte stream.
//   - err: only set on a read error from the original body other than EOF.
func captureAndRestoreBody(body io.ReadCloser, limit int) ([]byte, bool, io.ReadCloser, error) {
	if body == nil || limit <= 0 {
		return nil, false, body, nil
	}
	buf, err := io.ReadAll(io.LimitReader(body, int64(limit)+1))
	if err != nil {
		return nil, false, body, err
	}
	truncated := len(buf) > limit
	if truncated {
		// Caller will read the captured prefix + remaining bytes of the
		// original body. Closing the wrapper closes the original body so
		// the underlying connection is released to the pool.
		restored := &chainReadCloser{
			r: io.MultiReader(bytes.NewReader(buf), body),
			c: body,
		}
		return buf, true, restored, nil
	}
	// Body is fully drained; close the original to release the connection
	// and hand the caller a fresh ReadCloser over the captured bytes.
	_ = body.Close()
	return buf, false, io.NopCloser(bytes.NewReader(buf)), nil
}

// chainReadCloser wraps an io.Reader (typically an io.MultiReader of a
// captured prefix + remaining body) with the Close method of the original
// body. This lets the caller continue to consume bytes that were never
// buffered while still releasing the underlying connection on Close.
type chainReadCloser struct {
	r io.Reader
	c io.Closer
}

func (c *chainReadCloser) Read(p []byte) (int, error) { return c.r.Read(p) }
func (c *chainReadCloser) Close() error               { return c.c.Close() }

// sanitizeURL strips sensitive query parameter values. The key set
// matches the inbound api_call_logs middleware regex
// (?i)key|token|secret|password so inbound and outbound persisted
// endpoints share the same redaction superset.
func sanitizeURL(u *url.URL) string {
	if u == nil {
		return ""
	}
	sanitized := *u
	q := sanitized.Query()
	for key := range q {
		if isSensitiveQueryKey(key) {
			q.Set(key, "REDACTED")
		}
	}
	sanitized.RawQuery = q.Encode()
	return sanitized.String()
}
