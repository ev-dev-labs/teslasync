package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/api/apitest"
	apimw "github.com/ev-dev-labs/teslasync/internal/api/middleware"
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

// Test helpers were promoted to internal/api/apitest with exported names
// so subpackages can import them. Call sites below use apitest.DoRequest,
// apitest.AssertStatus, apitest.AssertJSON, and apitest.AssertContentType
// directly; no parent wrappers were retained.

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

func TestSecurityHeadersMiddleware(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := apimw.SecurityHeaders(inner)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/test", nil)
	handler.ServeHTTP(rec, req)

	expected := map[string]string{
		"X-Content-Type-Options":    "nosniff",
		"X-Frame-Options":           "DENY",
		"X-XSS-Protection":          "0",
		"Referrer-Policy":           "strict-origin-when-cross-origin",
	}

	for header, want := range expected {
		got := rec.Header().Get(header)
		if got != want {
			t.Errorf("header %s: expected %q, got %q", header, want, got)
		}
	}
	if csp := rec.Header().Get("Content-Security-Policy"); csp != "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" {
		t.Errorf("unexpected Content-Security-Policy: %q", csp)
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
	handler := apimw.SecurityHeaders(inner)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/test", nil)
	handler.ServeHTTP(rec, req)

	if !called {
		t.Error("inner handler was not called")
	}
	apitest.AssertStatus(t, rec, http.StatusTeapot)
}

func TestRecoveryMiddleware_NoPanic(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
	})
	handler := apimw.Recovery(inner)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/safe", nil)
	handler.ServeHTTP(rec, req)

	apitest.AssertStatus(t, rec, http.StatusOK)
}

func TestRecoveryMiddleware_CatchesPanic(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("something went wrong")
	})
	handler := apimw.Recovery(inner)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/panic", nil)
	handler.ServeHTTP(rec, req)

	apitest.AssertStatus(t, rec, http.StatusInternalServerError)
	body := apitest.AssertJSON(t, rec)
	if body["error"] != "internal server error" {
		t.Errorf("expected error 'internal server error', got %v", body["error"])
	}
}
