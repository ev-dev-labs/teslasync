package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
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
