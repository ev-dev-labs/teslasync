package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/api/apitest"
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

// Phase R2.0b (2026-05-28): doRequest / assertStatus / assertJSON /
// assertContentType were promoted to internal/api/apitest with
// exported names so R2a-R2e wave subpackages can import them. Call
// sites below use apitest.DoRequest / apitest.AssertStatus /
// apitest.AssertJSON / apitest.AssertContentType directly — no
// parent wrappers were retained (only 40 call sites in 2 files, so
// the mass-rewrite was preferable to drained-wrapper dead code).

// ---------------------------------------------------------------------------
// Health endpoint tests
// ---------------------------------------------------------------------------

func TestHealthz_ReturnsOK(t *testing.T) {
	handler := setupTestRouter()
	rec := apitest.DoRequest(handler, "GET", "/healthz", "")
	apitest.AssertStatus(t, rec, http.StatusOK)
	apitest.AssertContentType(t, rec, "application/json")
	body := apitest.AssertJSON(t, rec)
	if body["status"] != "ok" {
		t.Errorf("expected status ok, got %v", body["status"])
	}
}

func TestReadyz_ReturnsOK(t *testing.T) {
	handler := setupTestRouter()
	rec := apitest.DoRequest(handler, "GET", "/readyz", "")
	apitest.AssertStatus(t, rec, http.StatusOK)
	apitest.AssertContentType(t, rec, "application/json")
	body := apitest.AssertJSON(t, rec)
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
		"X-Frame-Options":           "DENY",
		"X-XSS-Protection":          "1; mode=block",
		"Strict-Transport-Security": "max-age=31536000; includeSubDomains",
		"Referrer-Policy":           "strict-origin-when-cross-origin",
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
	apitest.AssertStatus(t, rec, http.StatusTeapot)
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

	apitest.AssertStatus(t, rec, http.StatusOK)
}

func TestRecoveryMiddleware_CatchesPanic(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("something went wrong")
	})
	handler := RecoveryMiddleware(inner)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/panic", nil)
	handler.ServeHTTP(rec, req)

	apitest.AssertStatus(t, rec, http.StatusInternalServerError)
	body := apitest.AssertJSON(t, rec)
	if body["error"] != "internal server error" {
		t.Errorf("expected error 'internal server error', got %v", body["error"])
	}
}

// ---------------------------------------------------------------------------
// writeJSON / writeError helper tests
//
// Phase R2.0a (2026-05-28): TestWriteJSON, TestWriteJSON_NilData,
// TestWriteJSON_CustomStatus, TestWriteError, TestWriteError_AllCodes,
// TestWriteErrorCode were relocated to internal/api/httpx/json_test.go
// alongside the canonical exported helpers they exercise.
// ---------------------------------------------------------------------------

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
