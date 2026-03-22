package api

import (
	"fmt"
	"net/http"
	"runtime/debug"
	"time"

	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog/log"
)

// LoggerMiddleware logs HTTP requests using zerolog.
func LoggerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)

		defer func() {
			duration := time.Since(start)
			status := ww.Status()

			// Add response time header for API consumers
			ww.Header().Set("X-Response-Time", fmt.Sprintf("%dms", duration.Milliseconds()))

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
				Dur("duration", duration).
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
