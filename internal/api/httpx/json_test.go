package httpx_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

func TestWriteJSON(t *testing.T) {
	rec := httptest.NewRecorder()
	httpx.WriteJSON(rec, http.StatusOK, map[string]string{"key": "value"})

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Header().Get("Content-Type"), "application/json") {
		t.Errorf("Content-Type = %q, want application/json...", rec.Header().Get("Content-Type"))
	}

	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if body["key"] != "value" {
		t.Errorf("body[key] = %q, want value", body["key"])
	}
}

func TestWriteJSON_NilData(t *testing.T) {
	rec := httptest.NewRecorder()
	httpx.WriteJSON(rec, http.StatusNoContent, nil)

	if rec.Code != http.StatusNoContent {
		t.Errorf("status = %d, want 204", rec.Code)
	}
	if !strings.Contains(rec.Header().Get("Content-Type"), "application/json") {
		t.Errorf("Content-Type should still be set for 204, got %q", rec.Header().Get("Content-Type"))
	}
	if rec.Body.Len() != 0 {
		t.Errorf("body for nil data = %q, want empty", rec.Body.String())
	}
}

func TestWriteJSON_CustomStatus(t *testing.T) {
	rec := httptest.NewRecorder()
	httpx.WriteJSON(rec, http.StatusCreated, map[string]int{"id": 42})

	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want 201", rec.Code)
	}
	var body map[string]int
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["id"] != 42 {
		t.Errorf("body[id] = %d, want 42", body["id"])
	}
}

// TestWriteJSON_ContentTypeExactSpelling pins the Content-Type to the
// exact byte sequence the SPA matches on.
func TestWriteJSON_ContentTypeExactSpelling(t *testing.T) {
	rec := httptest.NewRecorder()
	httpx.WriteJSON(rec, http.StatusOK, map[string]string{"k": "v"})

	got := rec.Header().Get("Content-Type")
	const want = "application/json; charset=utf-8"
	if got != want {
		t.Errorf("Content-Type = %q, want %q", got, want)
	}
}

func TestWriteError(t *testing.T) {
	rec := httptest.NewRecorder()
	httpx.WriteError(rec, http.StatusBadRequest, "bad request")

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}

	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if body["error"] != "bad request" {
		t.Errorf("body[error] = %q, want bad request", body["error"])
	}
	if body["code"] != "BAD_REQUEST" {
		t.Errorf("body[code] = %q, want BAD_REQUEST", body["code"])
	}
}

func TestWriteError_AllCodes(t *testing.T) {
	tests := []struct {
		status   int
		wantCode string
	}{
		{http.StatusBadRequest, "BAD_REQUEST"},
		{http.StatusUnauthorized, "UNAUTHORIZED"},
		{http.StatusForbidden, "FORBIDDEN"},
		{http.StatusNotFound, "NOT_FOUND"},
		{http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED"},
		{http.StatusConflict, "CONFLICT"},
		{http.StatusUnprocessableEntity, "UNPROCESSABLE_ENTITY"},
		{http.StatusTooManyRequests, "RATE_LIMITED"},
		{http.StatusInternalServerError, "INTERNAL_ERROR"},
		{http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE"},
		{http.StatusGatewayTimeout, "GATEWAY_TIMEOUT"},
		{http.StatusNotImplemented, "ERROR"}, // unmapped
		{http.StatusTeapot, "ERROR"},
	}
	for _, tt := range tests {
		t.Run(tt.wantCode, func(t *testing.T) {
			rec := httptest.NewRecorder()
			httpx.WriteError(rec, tt.status, "msg")
			var body map[string]string
			_ = json.Unmarshal(rec.Body.Bytes(), &body)
			if body["code"] != tt.wantCode {
				t.Errorf("status %d: code = %q, want %q", tt.status, body["code"], tt.wantCode)
			}
		})
	}
}

func TestWriteErrorCode(t *testing.T) {
	rec := httptest.NewRecorder()
	httpx.WriteErrorCode(rec, http.StatusForbidden, "custom msg", "CUSTOM_CODE")

	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403", rec.Code)
	}
	var body map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["error"] != "custom msg" {
		t.Errorf("body[error] = %q, want custom msg", body["error"])
	}
	if body["code"] != "CUSTOM_CODE" {
		t.Errorf("body[code] = %q, want CUSTOM_CODE", body["code"])
	}
}

func TestHTTPStatusCode(t *testing.T) {
	tests := []struct {
		status int
		want   string
	}{
		{http.StatusBadRequest, "BAD_REQUEST"},
		{http.StatusUnauthorized, "UNAUTHORIZED"},
		{http.StatusForbidden, "FORBIDDEN"},
		{http.StatusNotFound, "NOT_FOUND"},
		{http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED"},
		{http.StatusConflict, "CONFLICT"},
		{http.StatusUnprocessableEntity, "UNPROCESSABLE_ENTITY"},
		{http.StatusTooManyRequests, "RATE_LIMITED"},
		{http.StatusInternalServerError, "INTERNAL_ERROR"},
		{http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE"},
		{http.StatusGatewayTimeout, "GATEWAY_TIMEOUT"},
		{http.StatusTeapot, "ERROR"},
		{299, "ERROR"},
	}
	for _, tt := range tests {
		got := httpx.HTTPStatusCode(tt.status)
		if got != tt.want {
			t.Errorf("HTTPStatusCode(%d) = %q, want %q", tt.status, got, tt.want)
		}
	}
}
