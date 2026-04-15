package httputil

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

// LoggedTransport wraps http.RoundTripper and logs every outbound request/response.
type LoggedTransport struct {
	Base http.RoundTripper
	Name string // e.g., "tesla-api", "eia-api", "geocoder"
}

// RoundTrip implements http.RoundTripper with structured logging.
func (t *LoggedTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	base := t.Base
	if base == nil {
		base = http.DefaultTransport
	}

	start := time.Now()
	sanitized := sanitizeURL(req.URL)

	log.Debug().
		Str("adapter", t.Name).
		Str("method", req.Method).
		Str("url", sanitized).
		Msg("httputil: outbound request")

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
		return nil, err
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

// sanitizeURL strips sensitive query parameters and Authorization header details.
func sanitizeURL(u *url.URL) string {
	sanitized := *u
	q := sanitized.Query()
	for key := range q {
		lower := strings.ToLower(key)
		if strings.Contains(lower, "key") || strings.Contains(lower, "token") || strings.Contains(lower, "secret") {
			q.Set(key, "REDACTED")
		}
	}
	sanitized.RawQuery = q.Encode()
	return sanitized.String()
}
