package middleware

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/felixge/httpsnoop"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog/log"

	// Grandfathered alongside query_budget.go: the HTTP debug adapter consumes
	// the shared pgx tracer's per-request measurements.
	"github.com/ev-dev-labs/teslasync/internal/database" //nolint:depguard
)

const (
	// Canonical casing avoids normalizing the key on every disabled request.
	PerformanceDebugRequestHeader = "X-Teslasync-Perf-Debug"
	PerformanceDebugTrailer       = "X-TeslaSync-Perf"
)

// RequestPerformance is emitted only for requests that explicitly send
// X-TeslaSync-Perf-Debug: 1. The response body and status are untouched.
type RequestPerformance struct {
	TotalRequestMS      float64                     `json:"total_request_ms"`
	QueryTimeMS         float64                     `json:"query_time_ms"`
	QueryCount          int                         `json:"query_count"`
	RowsReturned        int64                       `json:"rows_returned"`
	RowsScannedEstimate *int64                      `json:"rows_scanned_estimate"`
	PayloadKB           float64                     `json:"payload_kb"`
	Queries             []database.QueryPerformance `json:"queries"`
}

// PerformanceDebug attaches detailed pgx timing only to explicitly opted-in
// requests. Results are returned as an HTTP trailer because query totals are
// known only after the handler has completed.
func PerformanceDebug(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(PerformanceDebugRequestHeader) != "1" {
			next.ServeHTTP(w, r)
			return
		}

		startedAt := time.Now()
		ctx := database.AttachQueryPerformanceCollector(r.Context())
		r = r.WithContext(ctx)
		if r.Method != http.MethodHead {
			w.Header().Add("Trailer", PerformanceDebugTrailer)
		}
		ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)

		next.ServeHTTP(httpsnoop.Wrap(ww, httpsnoop.Hooks{
			WriteHeader: func(writeHeader httpsnoop.WriteHeaderFunc) httpsnoop.WriteHeaderFunc {
				return func(status int) {
					// Bodyless responses cannot carry trailers through HTTP proxies.
					if r.Method == http.MethodHead || status == http.StatusNoContent || status == http.StatusNotModified {
						ww.Header().Del("Trailer")
					}
					writeHeader(status)
				}
			},
		}), r)

		dbMetrics := database.QueryPerformanceMetrics(ctx)
		measurement := RequestPerformance{
			TotalRequestMS:      float64(time.Since(startedAt).Microseconds()) / 1000,
			QueryTimeMS:         dbMetrics.QueryTimeMS,
			QueryCount:          dbMetrics.QueryCount,
			RowsReturned:        dbMetrics.RowsReturned,
			RowsScannedEstimate: dbMetrics.RowsScannedEstimate,
			PayloadKB:           float64(ww.BytesWritten()) / 1024,
			Queries:             dbMetrics.Queries,
		}
		payload, err := json.Marshal(measurement)
		if err != nil {
			return
		}
		if r.Method != http.MethodHead && ww.Status() != http.StatusNoContent && ww.Status() != http.StatusNotModified {
			ww.Header().Set(PerformanceDebugTrailer, string(payload))
		}

		route := r.URL.Path
		if routeContext := chi.RouteContext(r.Context()); routeContext != nil {
			if pattern := routeContext.RoutePattern(); pattern != "" {
				route = pattern
			}
		}
		log.Debug().
			Str("method", r.Method).
			Str("route", route).
			Float64("total_request_ms", measurement.TotalRequestMS).
			Float64("query_time_ms", measurement.QueryTimeMS).
			Int("query_count", measurement.QueryCount).
			Int64("rows_returned", measurement.RowsReturned).
			Float64("payload_kb", measurement.PayloadKB).
			Interface("queries", measurement.Queries).
			Msg("debug request performance")
	})
}
