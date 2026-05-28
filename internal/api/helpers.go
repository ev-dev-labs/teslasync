package api

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// globalErrorTracker is set during router initialization.
var globalErrorTracker *ErrorTracker

// writeJSON is a transitional wrapper around httpx.WriteJSON kept for
// the duration of the internal/api -> internal/api/<resource>/
// subpackage migration (Phase R2). New handlers — and handlers being
// moved into resource subpackages — MUST call httpx.WriteJSON
// directly. Deletion of this wrapper is gated on internal/api/
// reaching its irreducible drained shape at end of Phase R2.
func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	httpx.WriteJSON(w, status, data)
}

// httpStatusCode is a transitional wrapper around httpx.HTTPStatusCode.
// New code MUST call httpx.HTTPStatusCode directly. See writeJSON for
// the broader transitional plan.
func httpStatusCode(status int) string {
	return httpx.HTTPStatusCode(status)
}

// writeError is a transitional wrapper around httpx.WriteError. See
// writeJSON for the broader transitional plan.
func writeError(w http.ResponseWriter, status int, msg string) {
	httpx.WriteError(w, status, msg)
}

// writeErrorCode is a transitional wrapper around httpx.WriteErrorCode.
// See writeJSON for the broader transitional plan.
func writeErrorCode(w http.ResponseWriter, status int, msg, code string) {
	httpx.WriteErrorCode(w, status, msg, code)
}

// writeTeslaTokenExpired is a transitional wrapper around
// httpx.WriteTeslaTokenExpired. See writeJSON for the broader
// transitional plan.
func writeTeslaTokenExpired(w http.ResponseWriter) {
	httpx.WriteTeslaTokenExpired(w)
}

// writeAppError writes a structured error response using the centralized error catalog
// and automatically records the error in the global error tracker and Prometheus.
//
// Stays in the parent internal/api package for R2.0a because AppError,
// APIErrors (Prometheus metric), and the ErrorTracker are all
// parent-bound. A dedicated future carve is expected to land the
// AppError catalog at internal/api/apierr.
func writeAppError(w http.ResponseWriter, r *http.Request, appErr *AppError) {
	httpx.WriteJSON(w, appErr.Status, map[string]string{
		"error":    appErr.Message,
		"code":     appErr.Code,
		"category": appErr.Category,
	})
	APIErrors.WithLabelValues(appErr.Code, appErr.Category).Inc()
	if globalErrorTracker != nil {
		reqID := chimw.GetReqID(r.Context())
		globalErrorTracker.Track(appErr.Code, appErr.Category, appErr.Message, r.URL.Path, r.Method, reqID, appErr.Status)
	}
}

// Pagination helper extracts limit/offset from query params.
func pagination(r *http.Request) (limit, offset int) {
	limit = 50
	offset = 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if l, err := strconv.Atoi(v); err == nil && l > 0 && l <= 1000 {
			limit = l
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if o, err := strconv.Atoi(v); err == nil && o >= 0 {
			offset = o
		}
	}
	return
}

// urlParamInt64 extracts an int64 URL parameter.
func urlParamInt64(r *http.Request, key string) (int64, error) {
	return strconv.ParseInt(chi.URLParam(r, key), 10, 64)
}

// parseDateRange extracts optional start/end date query params.
//
// Two formats are accepted, in this order of precedence per parameter:
//
//  1. RFC 3339 instants (e.g. "2026-05-13T07:00:00Z") — used verbatim
//     for `start`. For `end`, the FE convention is to send the next
//     local midnight (i.e. an EXCLUSIVE upper bound) so the window
//     spans `[start, end)` in calendar-day terms. Existing handlers
//     filter with `ts BETWEEN $2 AND $3` (inclusive); to keep that
//     contract working we subtract 1 microsecond from the RFC 3339
//     end so the boundary instant itself is excluded. Net effect:
//     callers get correct `[start, next_local_midnight)` semantics
//     regardless of which SQL operator they use. This is the form
//     the React `useRangeState` hook produces via its
//     `startInstant` / `endInstantExclusive` outputs and is the
//     recommended shape for all new UI surfaces.
//
//  2. Date-only "YYYY-MM-DD" — backward-compatible legacy form. Parsed
//     as UTC midnight (start) / UTC end-of-day (end, inclusive).
//     Suitable for fixed-window reports and audit endpoints that
//     don't care about timezone. New UI surfaces should switch to
//     RFC 3339 instants — the legacy form silently dropped today's
//     local rows for any user east or west of UTC (e.g. a PST user's
//     evening drives recorded at next-day UTC).
func parseDateRange(r *http.Request) (startTime, endTime time.Time) {
	if s := r.URL.Query().Get("start"); s != "" {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			startTime = t
		} else if t, err := time.Parse("2006-01-02", s); err == nil {
			startTime = t
		}
	}
	if s := r.URL.Query().Get("end"); s != "" {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			endTime = t.Add(-time.Microsecond) // exclusive → inclusive for BETWEEN
		} else if t, err := time.Parse("2006-01-02", s); err == nil {
			endTime = t.Add(24*time.Hour - time.Second) // end of day (UTC)
		}
	}
	return
}

// nullableTime returns t when use is true, otherwise an interface-typed nil
// suitable for passing to pgx.Query. Combined with `$N::timestamptz IS NULL`
// SQL guards this lets a single prepared statement express
// "scope by [start, end] when supplied; full-history when not".
func nullableTime(use bool, t time.Time) interface{} {
	if !use {
		return nil
	}
	return t
}

// EstimateBatteryCapacityWh returns the best-effort battery capacity in Wh
// and a source string indicating how the estimate was derived.
// Uses VIN position 8 decode first, falls back to model name, then 75000 Wh default.
// This is an ESTIMATE — Tesla does not expose exact usable capacity via API.
func EstimateBatteryCapacityWh(vin string, model string) (float64, string) {
	// VIN position 8 (0-indexed 7) for Tesla encodes drivetrain/battery:
	//   E/F = Standard Range (~55-60 kWh usable)
	//   K/L/M = Long Range (~75-82 kWh usable)
	//   S/A = Model S/X Long Range / Plaid (~100 kWh usable)
	//   P = Performance (~100 kWh usable)
	if len(vin) >= 8 {
		switch vin[7] {
		case 'E', 'F':
			return 60000.0, "vin_estimate"
		case 'K', 'L', 'M':
			return 75000.0, "vin_estimate"
		case 'S', 'A':
			return 100000.0, "vin_estimate"
		case 'P':
			return 100000.0, "vin_estimate"
		}
	}
	// Fallback: model name heuristic
	m := strings.ToLower(model)
	if strings.Contains(m, "model s") || strings.Contains(m, "model x") {
		return 100000.0, "model_estimate"
	}
	return 75000.0, "default"
}

// lookupVehicleCapacityWh fetches VIN and model for a vehicle ID and estimates
// battery capacity. Falls back to 75000 Wh / "default" on any lookup error.
func lookupVehicleCapacityWh(ctx context.Context, db *database.DB, vehicleID int64) (float64, string) {
	var vin string
	var model *string
	err := db.Pool.QueryRow(ctx,
		`SELECT vin, model FROM vehicles WHERE id = $1`, vehicleID,
	).Scan(&vin, &model)
	if err != nil {
		return 75000.0, "default"
	}
	m := ""
	if model != nil {
		m = *model
	}
	return EstimateBatteryCapacityWh(vin, m)
}
