package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"runtime/debug"
	"time"

	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog/log"
)

type contextKey string

const correlationIDKey contextKey = "correlation_id"

// generateCorrelationID creates a random hex string for request tracing.
func generateCorrelationID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

// CorrelationID middleware injects or propagates a correlation ID header for
// structured request tracing across services.
func CorrelationID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Correlation-ID")
		if id == "" {
			id = generateCorrelationID()
		}
		w.Header().Set("X-Correlation-ID", id)
		ctx := context.WithValue(r.Context(), correlationIDKey, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// LoggerMiddleware logs HTTP requests using zerolog.
func LoggerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)

		defer func() {
			status := ww.Status()
			logger := log.Info()
			if status >= 500 {
				logger = log.Error()
			} else if status >= 400 {
				logger = log.Warn()
			}
			logger.
				Str("method", r.Method).
				Str("path", r.URL.Path).
				Int("status", status).
				Int("bytes", ww.BytesWritten()).
				Dur("duration", time.Since(start)).
				Str("ip", r.RemoteAddr).
				Str("request_id", chimw.GetReqID(r.Context())).
				Msg("http request")
		}()

		next.ServeHTTP(ww, r)
	})
}

// RecoveryMiddleware catches panics in HTTP handlers and returns a 500 response
// with structured error logging including stack traces.
func RecoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				stack := string(debug.Stack())
				log.Error().
					Str("method", r.Method).
					Str("path", r.URL.Path).
					Str("request_id", chimw.GetReqID(r.Context())).
					Str("stack", stack).
					Str("panic", fmt.Sprintf("%v", rec)).
					Msg("panic recovered in HTTP handler")

				writeError(w, http.StatusInternalServerError, "internal server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}
