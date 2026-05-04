package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// globalErrorTracker is set during router initialization.
var globalErrorTracker *ErrorTracker

// JSON helper to write JSON responses.
func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if data != nil {
		_ = json.NewEncoder(w).Encode(data)
	}
}

// httpStatusCode maps HTTP status codes to machine-readable error codes.
func httpStatusCode(status int) string {
	switch status {
	case http.StatusBadRequest:
		return "BAD_REQUEST"
	case http.StatusUnauthorized:
		return "UNAUTHORIZED"
	case http.StatusForbidden:
		return "FORBIDDEN"
	case http.StatusNotFound:
		return "NOT_FOUND"
	case http.StatusMethodNotAllowed:
		return "METHOD_NOT_ALLOWED"
	case http.StatusConflict:
		return "CONFLICT"
	case http.StatusUnprocessableEntity:
		return "UNPROCESSABLE_ENTITY"
	case http.StatusTooManyRequests:
		return "RATE_LIMITED"
	case http.StatusInternalServerError:
		return "INTERNAL_ERROR"
	case http.StatusServiceUnavailable:
		return "SERVICE_UNAVAILABLE"
	case http.StatusGatewayTimeout:
		return "GATEWAY_TIMEOUT"
	default:
		return "ERROR"
	}
}

// Error helper to write JSON error responses with a consistent structure.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{
		"error": msg,
		"code":  httpStatusCode(status),
	})
}

// writeErrorCode writes a JSON error response with a custom error code.
func writeErrorCode(w http.ResponseWriter, status int, msg, code string) {
	writeJSON(w, status, map[string]string{
		"error": msg,
		"code":  code,
	})
}

// writeTeslaTokenExpired writes the canonical 401 response that the
// frontend translates into a {@link TeslaAuthExpiredError} and surfaces
// via the <TeslaReauthBanner> recovery UI (Phase-45 / Prompt 30).
//
// Use this from any handler whose underlying call returned
// {@link tesla.ErrUnauthorized} — i.e. the user's third-party Tesla
// refresh token has expired and the backend can no longer act on their
// behalf without a fresh OAuth grant.
func writeTeslaTokenExpired(w http.ResponseWriter) {
	writeErrorCode(w, http.StatusUnauthorized, "Tesla account disconnected", ErrCodeTeslaTokenExpired)
}

// writeAppError writes a structured error response using the centralized error catalog
// and automatically records the error in the global error tracker and Prometheus.
func writeAppError(w http.ResponseWriter, r *http.Request, appErr *AppError) {
	writeJSON(w, appErr.Status, map[string]string{
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

// parseDateRange extracts optional start/end date query params (format: 2006-01-02).
// End date is set to end of day (23:59:59) to include the full day.
func parseDateRange(r *http.Request) (startTime, endTime time.Time) {
	if s := r.URL.Query().Get("start"); s != "" {
		if t, err := time.Parse("2006-01-02", s); err == nil {
			startTime = t
		}
	}
	if s := r.URL.Query().Get("end"); s != "" {
		if t, err := time.Parse("2006-01-02", s); err == nil {
			endTime = t.Add(24*time.Hour - time.Second) // end of day
		}
	}
	return
}

// EstimateBatteryCapacityKWh returns the best-effort battery capacity in kWh
// and a source string indicating how the estimate was derived.
// Uses VIN position 8 decode first, falls back to model name, then 75 kWh default.
// This is an ESTIMATE — Tesla does not expose exact usable capacity via API.
func EstimateBatteryCapacityKWh(vin string, model string) (float64, string) {
	// VIN position 8 (0-indexed 7) for Tesla encodes drivetrain/battery:
	//   E/F = Standard Range (~55-60 kWh usable)
	//   K/L/M = Long Range (~75-82 kWh usable)
	//   S/A = Model S/X Long Range / Plaid (~100 kWh usable)
	//   P = Performance (~100 kWh usable)
	if len(vin) >= 8 {
		switch vin[7] {
		case 'E', 'F':
			return 60.0, "vin_estimate"
		case 'K', 'L', 'M':
			return 75.0, "vin_estimate"
		case 'S', 'A':
			return 100.0, "vin_estimate"
		case 'P':
			return 100.0, "vin_estimate"
		}
	}
	// Fallback: model name heuristic
	m := strings.ToLower(model)
	if strings.Contains(m, "model s") || strings.Contains(m, "model x") {
		return 100.0, "model_estimate"
	}
	return 75.0, "default"
}

// lookupVehicleCapacity fetches VIN and model for a vehicle ID and estimates
// battery capacity. Falls back to 75 kWh / "default" on any lookup error.
func lookupVehicleCapacity(ctx context.Context, db *database.DB, vehicleID int64) (float64, string) {
	var vin string
	var model *string
	err := db.Pool.QueryRow(ctx,
		`SELECT vin, model FROM vehicles WHERE id = $1`, vehicleID,
	).Scan(&vin, &model)
	if err != nil {
		return 75.0, "default"
	}
	m := ""
	if model != nil {
		m = *model
	}
	return EstimateBatteryCapacityKWh(vin, m)
}
