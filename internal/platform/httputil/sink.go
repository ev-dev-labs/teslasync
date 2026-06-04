package httputil

import (
	"net/url"
	"strings"
)

// MaxOutboundBodyBytes caps the per-body capture (request and response) for
// the outbound api_call_logs sink at 10 KB. Mirrors the inbound middleware's
// MaxAPILogBodyBytes so a single downstream parser can decode entries from
// either direction with the same length budget.
const MaxOutboundBodyBytes = 10 * 1024

// OutboundTruncationMarker is appended to bodies that exceeded
// MaxOutboundBodyBytes. The marker text is identical to the inbound
// middleware's truncationMarker so consumers can detect truncation
// regardless of direction.
const OutboundTruncationMarker = "... [truncated]"

// APICallSink is the outbound persistence port consumed by LoggedTransport.
//
// Implementations MUST be non-blocking: LoggedTransport never blocks the
// round-trip on a sink call. The production binding (api.APICallSinkAdapter)
// drops on full queue and is wrapped here in a recover() guard so a
// panicking sink cannot break HTTP traffic for callers.
//
// CaptureBodies is read once per round-trip and controls whether the
// transport tees the request and response bodies into the APICallRecord.
// Operator default is false; opt in for diagnostic windows only.
type APICallSink interface {
	Enqueue(record APICallRecord)
	CaptureBodies() bool
}

// APICallRecord is the wire-format struct passed from LoggedTransport to
// APICallSink. Defined locally in httputil so the package never imports
// internal/database or internal/models. The api package adapter
// (APICallSinkAdapter) converts each record into a *teslamodel.APICallLog
// before handing it to the existing async writer.
//
// Fields:
//   - Service: ClientConfig.Name -> LoggedTransport.Name -> Service tag.
//   - Method: HTTP request method (GET, POST, ...).
//   - URL: redacted full URL (scheme://host[:port]/path?redacted-query).
//   - StatusCode: HTTP status; 0 on network error / pre-response failure.
//   - DurationMs: end-to-end round-trip duration in milliseconds.
//   - ErrorMessage: non-empty when the round-trip failed before a response
//     was received (e.g. connection refused, DNS NXDOMAIN, TLS handshake).
//   - RequestBody, ResponseBody: captured only when CaptureBodies() is true,
//     truncated to MaxOutboundBodyBytes with OutboundTruncationMarker
//     appended on overflow.
type APICallRecord struct {
	Service      string
	Method       string
	URL          string
	StatusCode   int
	DurationMs   int
	ErrorMessage string
	RequestBody  []byte
	ResponseBody []byte
}

// RedactURL returns the request URL with sensitive query parameter values
// replaced by "REDACTED". Reuses the same key set as sanitizeURL — the
// (?i)key|token|secret|password regex superset shared with the inbound
// middleware so inbound and outbound persisted endpoints match.
//
// Returns "" for a nil URL. Does not mutate the input *url.URL.
func RedactURL(u *url.URL) string {
	if u == nil {
		return ""
	}
	return sanitizeURL(u)
}

// TruncateBody returns a body suitable for storage in api_call_logs. When
// len(b) is within max it is returned as-is (no allocation). When len(b)
// exceeds max the first max bytes are kept and OutboundTruncationMarker is
// appended so consumers can detect truncation. A non-positive max disables
// truncation and returns b unchanged.
func TruncateBody(b []byte, max int) []byte {
	if max <= 0 || len(b) <= max {
		return b
	}
	out := make([]byte, 0, max+len(OutboundTruncationMarker))
	out = append(out, b[:max]...)
	out = append(out, OutboundTruncationMarker...)
	return out
}

// isSensitiveQueryKey reports whether a query parameter name carries
// secret material (matches (?i)key|token|secret|password). Implemented as
// a manual loop to avoid a regexp dependency on the hot path.
func isSensitiveQueryKey(key string) bool {
	lower := strings.ToLower(key)
	return strings.Contains(lower, "key") ||
		strings.Contains(lower, "token") ||
		strings.Contains(lower, "secret") ||
		strings.Contains(lower, "password")
}
