package httpx

import (
	"encoding/json"
	"net/http"
)

// WriteJSON writes a JSON response with the given status code and
// payload. A nil payload writes only the status line + Content-Type
// header (used for 204 No Content responses).
//
// The Content-Type is always "application/json; charset=utf-8" — this
// exact spelling is asserted by helpers_extra_test.go and depended on
// by frontend hooks that perform `response.headers.get('content-type')`
// matches.
func WriteJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if data != nil {
		_ = json.NewEncoder(w).Encode(data)
	}
}

// HTTPStatusCode maps an HTTP status code to the machine-readable
// error code surfaced in `{"code": "..."}` on error responses. Unknown
// status codes return "ERROR".
//
// The exact mapping is part of the frontend wire contract — any change
// here must coordinate with web/src/lib/resilience.ts.
func HTTPStatusCode(status int) string {
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

// WriteError writes a JSON error response with a derived machine code.
// The code is HTTPStatusCode(status); use WriteErrorCode when the
// caller needs a custom code (e.g. domain-specific identifiers).
func WriteError(w http.ResponseWriter, status int, msg string) {
	WriteJSON(w, status, map[string]string{
		"error": msg,
		"code":  HTTPStatusCode(status),
	})
}

// WriteErrorCode writes a JSON error response with an explicit machine
// code, bypassing the status-based code derivation in WriteError.
// Used when the wire-level code is part of a frontend recovery
// contract (e.g. TESLA_TOKEN_EXPIRED, AUTH_MODE_OPEN).
func WriteErrorCode(w http.ResponseWriter, status int, msg, code string) {
	WriteJSON(w, status, map[string]string{
		"error": msg,
		"code":  code,
	})
}
