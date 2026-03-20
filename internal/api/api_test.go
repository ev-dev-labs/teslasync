package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// setupTestRouter creates a minimal chi router for testing health endpoints
// and middleware without requiring real DB/Tesla dependencies.
func setupTestRouter() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	return mux
}

func doRequest(handler http.Handler, method, path string, body string) *httptest.ResponseRecorder {
	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, bodyReader)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func assertStatus(t *testing.T, rec *httptest.ResponseRecorder, expected int) {
	t.Helper()
	if rec.Code != expected {
		t.Errorf("expected status %d, got %d. Body: %s", expected, rec.Code, rec.Body.String())
	}
}

func assertJSON(t *testing.T, rec *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var result map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("response is not valid JSON: %v. Body: %s", err, rec.Body.String())
	}
	return result
}

func assertContentType(t *testing.T, rec *httptest.ResponseRecorder, expected string) {
	t.Helper()
	ct := rec.Header().Get("Content-Type")
	if !strings.Contains(ct, expected) {
		t.Errorf("expected Content-Type containing %q, got %q", expected, ct)
	}
}

// ---------------------------------------------------------------------------
// Health endpoint tests
// ---------------------------------------------------------------------------

func TestHealthz_ReturnsOK(t *testing.T) {
	handler := setupTestRouter()
	rec := doRequest(handler, "GET", "/healthz", "")
	assertStatus(t, rec, http.StatusOK)
	assertContentType(t, rec, "application/json")
	body := assertJSON(t, rec)
	if body["status"] != "ok" {
		t.Errorf("expected status ok, got %v", body["status"])
	}
}

func TestReadyz_ReturnsOK(t *testing.T) {
	handler := setupTestRouter()
	rec := doRequest(handler, "GET", "/readyz", "")
	assertStatus(t, rec, http.StatusOK)
	assertContentType(t, rec, "application/json")
	body := assertJSON(t, rec)
	if body["status"] != "ok" {
		t.Errorf("expected status ok, got %v", body["status"])
	}
}

// ---------------------------------------------------------------------------
// Security headers middleware tests
// ---------------------------------------------------------------------------

func TestSecurityHeadersMiddleware(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := SecurityHeadersMiddleware(inner)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/test", nil)
	handler.ServeHTTP(rec, req)

	expected := map[string]string{
		"X-Content-Type-Options":    "nosniff",
		"X-Frame-Options":          "DENY",
		"X-XSS-Protection":        "1; mode=block",
		"Strict-Transport-Security": "max-age=31536000; includeSubDomains",
		"Referrer-Policy":          "strict-origin-when-cross-origin",
	}

	for header, want := range expected {
		got := rec.Header().Get(header)
		if got != want {
			t.Errorf("header %s: expected %q, got %q", header, want, got)
		}
	}

	// CSP and Permissions-Policy should be present (just check non-empty)
	if csp := rec.Header().Get("Content-Security-Policy"); csp == "" {
		t.Error("expected Content-Security-Policy header to be set")
	}
	if pp := rec.Header().Get("Permissions-Policy"); pp == "" {
		t.Error("expected Permissions-Policy header to be set")
	}
}

func TestSecurityHeadersMiddleware_PassesThrough(t *testing.T) {
	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusTeapot)
	})
	handler := SecurityHeadersMiddleware(inner)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/test", nil)
	handler.ServeHTTP(rec, req)

	if !called {
		t.Error("inner handler was not called")
	}
	assertStatus(t, rec, http.StatusTeapot)
}

// ---------------------------------------------------------------------------
// Recovery middleware tests
// ---------------------------------------------------------------------------

func TestRecoveryMiddleware_NoPanic(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
	})
	handler := RecoveryMiddleware(inner)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/safe", nil)
	handler.ServeHTTP(rec, req)

	assertStatus(t, rec, http.StatusOK)
}

func TestRecoveryMiddleware_CatchesPanic(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("something went wrong")
	})
	handler := RecoveryMiddleware(inner)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/panic", nil)
	handler.ServeHTTP(rec, req)

	assertStatus(t, rec, http.StatusInternalServerError)
	body := assertJSON(t, rec)
	if body["error"] != "internal server error" {
		t.Errorf("expected error 'internal server error', got %v", body["error"])
	}
}

// ---------------------------------------------------------------------------
// writeJSON / writeError helper tests
// ---------------------------------------------------------------------------

func TestWriteJSON(t *testing.T) {
	rec := httptest.NewRecorder()
	data := map[string]string{"key": "value"}
	writeJSON(rec, http.StatusOK, data)

	assertStatus(t, rec, http.StatusOK)
	assertContentType(t, rec, "application/json")

	body := assertJSON(t, rec)
	if body["key"] != "value" {
		t.Errorf("expected key=value, got %v", body["key"])
	}
}

func TestWriteJSON_NilData(t *testing.T) {
	rec := httptest.NewRecorder()
	writeJSON(rec, http.StatusNoContent, nil)

	assertStatus(t, rec, http.StatusNoContent)
	assertContentType(t, rec, "application/json")
	if rec.Body.Len() != 0 {
		t.Errorf("expected empty body for nil data, got %q", rec.Body.String())
	}
}

func TestWriteJSON_CustomStatus(t *testing.T) {
	rec := httptest.NewRecorder()
	writeJSON(rec, http.StatusCreated, map[string]int{"id": 42})

	assertStatus(t, rec, http.StatusCreated)
	body := assertJSON(t, rec)
	if body["id"] != float64(42) {
		t.Errorf("expected id=42, got %v", body["id"])
	}
}

func TestWriteError(t *testing.T) {
	rec := httptest.NewRecorder()
	writeError(rec, http.StatusBadRequest, "bad request")

	assertStatus(t, rec, http.StatusBadRequest)
	assertContentType(t, rec, "application/json")

	body := assertJSON(t, rec)
	if body["error"] != "bad request" {
		t.Errorf("expected error 'bad request', got %v", body["error"])
	}
	if body["code"] != "BAD_REQUEST" {
		t.Errorf("expected code BAD_REQUEST, got %v", body["code"])
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
		{http.StatusNotImplemented, "ERROR"}, // unmapped code
	}

	for _, tt := range tests {
		t.Run(tt.wantCode, func(t *testing.T) {
			rec := httptest.NewRecorder()
			writeError(rec, tt.status, "test")
			body := assertJSON(t, rec)
			if body["code"] != tt.wantCode {
				t.Errorf("status %d: expected code %q, got %v", tt.status, tt.wantCode, body["code"])
			}
		})
	}
}

func TestWriteErrorCode(t *testing.T) {
	rec := httptest.NewRecorder()
	writeErrorCode(rec, http.StatusForbidden, "custom msg", "CUSTOM_CODE")

	assertStatus(t, rec, http.StatusForbidden)
	body := assertJSON(t, rec)
	if body["error"] != "custom msg" {
		t.Errorf("expected error 'custom msg', got %v", body["error"])
	}
	if body["code"] != "CUSTOM_CODE" {
		t.Errorf("expected code CUSTOM_CODE, got %v", body["code"])
	}
}

// ---------------------------------------------------------------------------
// Pagination helper tests
// ---------------------------------------------------------------------------

func TestPagination_Defaults(t *testing.T) {
	req := httptest.NewRequest("GET", "/test", nil)
	limit, offset := pagination(req)
	if limit != 50 {
		t.Errorf("expected default limit 50, got %d", limit)
	}
	if offset != 0 {
		t.Errorf("expected default offset 0, got %d", offset)
	}
}

func TestPagination_CustomValues(t *testing.T) {
	req := httptest.NewRequest("GET", "/test?limit=25&offset=10", nil)
	limit, offset := pagination(req)
	if limit != 25 {
		t.Errorf("expected limit 25, got %d", limit)
	}
	if offset != 10 {
		t.Errorf("expected offset 10, got %d", offset)
	}
}

func TestPagination_InvalidValues(t *testing.T) {
	req := httptest.NewRequest("GET", "/test?limit=abc&offset=-5", nil)
	limit, offset := pagination(req)
	if limit != 50 {
		t.Errorf("expected default limit 50 for invalid input, got %d", limit)
	}
	if offset != 0 {
		t.Errorf("expected default offset 0 for negative input, got %d", offset)
	}
}

func TestPagination_ExceedsMax(t *testing.T) {
	req := httptest.NewRequest("GET", "/test?limit=5000", nil)
	limit, _ := pagination(req)
	if limit != 50 {
		t.Errorf("expected default limit 50 for over-max input, got %d", limit)
	}
}

func TestPagination_ZeroLimit(t *testing.T) {
	req := httptest.NewRequest("GET", "/test?limit=0", nil)
	limit, _ := pagination(req)
	if limit != 50 {
		t.Errorf("expected default limit 50 for zero, got %d", limit)
	}
}

// ---------------------------------------------------------------------------
// parseDateRange tests
// ---------------------------------------------------------------------------

func TestParseDateRange_ValidDates(t *testing.T) {
	req := httptest.NewRequest("GET", "/test?start=2024-01-15&end=2024-02-15", nil)
	start, end := parseDateRange(req)
	if start.IsZero() {
		t.Error("expected non-zero start time")
	}
	if end.IsZero() {
		t.Error("expected non-zero end time")
	}
	if start.Year() != 2024 || start.Month() != 1 || start.Day() != 15 {
		t.Errorf("unexpected start date: %v", start)
	}
}

func TestParseDateRange_NoDates(t *testing.T) {
	req := httptest.NewRequest("GET", "/test", nil)
	start, end := parseDateRange(req)
	if !start.IsZero() || !end.IsZero() {
		t.Error("expected zero values when no dates provided")
	}
}

func TestParseDateRange_InvalidFormat(t *testing.T) {
	req := httptest.NewRequest("GET", "/test?start=01-15-2024", nil)
	start, _ := parseDateRange(req)
	if !start.IsZero() {
		t.Error("expected zero start for invalid format")
	}
}

// ---------------------------------------------------------------------------
// EventHub (SSE) tests
// ---------------------------------------------------------------------------

func TestEventHub_SubscribeAndBroadcast(t *testing.T) {
	hub := NewEventHub()

	ch, unsub := hub.Subscribe("test-client")
	defer unsub()

	if hub.ClientCount() != 1 {
		t.Fatalf("expected 1 client, got %d", hub.ClientCount())
	}

	hub.Broadcast("update", map[string]string{"msg": "hello"})

	select {
	case msg := <-ch:
		s := string(msg)
		if !strings.Contains(s, "event: update") {
			t.Errorf("expected event type 'update' in message, got %q", s)
		}
		if !strings.Contains(s, "hello") {
			t.Errorf("expected 'hello' in message, got %q", s)
		}
	default:
		t.Error("expected to receive a broadcast message")
	}
}

func TestEventHub_Unsubscribe(t *testing.T) {
	hub := NewEventHub()

	_, unsub := hub.Subscribe("test-client")
	if hub.ClientCount() != 1 {
		t.Fatalf("expected 1 client, got %d", hub.ClientCount())
	}

	unsub()
	if hub.ClientCount() != 0 {
		t.Errorf("expected 0 clients after unsubscribe, got %d", hub.ClientCount())
	}
}

func TestEventHub_MultipleClients(t *testing.T) {
	hub := NewEventHub()

	ch1, unsub1 := hub.Subscribe("client-1")
	defer unsub1()
	ch2, unsub2 := hub.Subscribe("client-2")
	defer unsub2()

	if hub.ClientCount() != 2 {
		t.Fatalf("expected 2 clients, got %d", hub.ClientCount())
	}

	hub.Broadcast("ping", map[string]bool{"ok": true})

	for _, ch := range []<-chan []byte{ch1, ch2} {
		select {
		case msg := <-ch:
			if !strings.Contains(string(msg), "event: ping") {
				t.Errorf("expected ping event, got %q", string(msg))
			}
		default:
			t.Error("client did not receive broadcast")
		}
	}
}
