package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

// acceptanceRouter creates a chi router with just enough wiring
// to exercise route matching, health endpoints, and method handling
// without any database or Tesla dependencies.
func acceptanceRouter() http.Handler {
	r := chi.NewRouter()

	r.Use(SecurityHeadersMiddleware)
	r.Use(RecoveryMiddleware)

	// Health endpoints — self-contained, no DB needed
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// Minimal API v1 routes for acceptance testing
	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/auth/status", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"authenticated": false,
			})
		})

		r.Get("/vehicles", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, http.StatusOK, []interface{}{})
		})

		r.Post("/vehicles/sync", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, http.StatusOK, map[string]string{"status": "synced"})
		})
	})

	return r
}

// ---------------------------------------------------------------------------
// Acceptance: Health endpoints
// ---------------------------------------------------------------------------

func TestAcceptance_HealthzReturns200(t *testing.T) {
	r := acceptanceRouter()
	rec := doRequest(r, "GET", "/healthz", "")
	assertStatus(t, rec, http.StatusOK)
	body := assertJSON(t, rec)
	if body["status"] != "ok" {
		t.Errorf("expected status ok, got %v", body["status"])
	}
}

func TestAcceptance_ReadyzReturns200(t *testing.T) {
	r := acceptanceRouter()
	rec := doRequest(r, "GET", "/readyz", "")
	assertStatus(t, rec, http.StatusOK)
}

// ---------------------------------------------------------------------------
// Acceptance: Auth status returns valid response structure
// ---------------------------------------------------------------------------

func TestAcceptance_AuthStatusStructure(t *testing.T) {
	r := acceptanceRouter()
	rec := doRequest(r, "GET", "/api/v1/auth/status", "")
	assertStatus(t, rec, http.StatusOK)
	assertContentType(t, rec, "application/json")
	body := assertJSON(t, rec)
	if _, ok := body["authenticated"]; !ok {
		t.Error("expected 'authenticated' field in response")
	}
}

// ---------------------------------------------------------------------------
// Acceptance: Unknown API paths return 404 (chi default)
// ---------------------------------------------------------------------------

func TestAcceptance_UnknownPath_Returns404(t *testing.T) {
	r := acceptanceRouter()
	rec := doRequest(r, "GET", "/api/v1/nonexistent", "")
	assertStatus(t, rec, http.StatusNotFound)
}

func TestAcceptance_UnknownTopLevelPath_Returns404(t *testing.T) {
	r := acceptanceRouter()
	rec := doRequest(r, "GET", "/totally-unknown", "")
	assertStatus(t, rec, http.StatusNotFound)
}

// ---------------------------------------------------------------------------
// Acceptance: Method not allowed returns 405
// ---------------------------------------------------------------------------

func TestAcceptance_MethodNotAllowed_Returns405(t *testing.T) {
	r := acceptanceRouter()

	// /healthz only accepts GET; POST should be 405
	rec := doRequest(r, "POST", "/healthz", "")
	assertStatus(t, rec, http.StatusMethodNotAllowed)
}

func TestAcceptance_MethodNotAllowed_VehiclesSync(t *testing.T) {
	r := acceptanceRouter()

	// /api/v1/vehicles/sync only accepts POST; GET should be 405
	rec := doRequest(r, "GET", "/api/v1/vehicles/sync", "")
	assertStatus(t, rec, http.StatusMethodNotAllowed)
}

// ---------------------------------------------------------------------------
// Acceptance: Security headers on all responses
// ---------------------------------------------------------------------------

func TestAcceptance_SecurityHeaders_OnAllResponses(t *testing.T) {
	r := acceptanceRouter()

	paths := []string{"/healthz", "/readyz", "/api/v1/auth/status"}
	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			rec := doRequest(r, "GET", path, "")
			if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Error("missing X-Content-Type-Options header")
			}
			if rec.Header().Get("X-Frame-Options") != "DENY" {
				t.Error("missing X-Frame-Options header")
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Acceptance: Recovery middleware catches panics in chi router
// ---------------------------------------------------------------------------

func TestAcceptance_PanicRecovery(t *testing.T) {
	r := chi.NewRouter()
	r.Use(RecoveryMiddleware)
	r.Get("/boom", func(w http.ResponseWriter, r *http.Request) {
		panic("kaboom")
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/boom", nil)
	r.ServeHTTP(rec, req)

	assertStatus(t, rec, http.StatusInternalServerError)
	body := assertJSON(t, rec)
	if body["error"] != "internal server error" {
		t.Errorf("expected 'internal server error', got %v", body["error"])
	}
}

// ---------------------------------------------------------------------------
// Acceptance: Content-Type is JSON for API responses
// ---------------------------------------------------------------------------

func TestAcceptance_ContentTypeJSON(t *testing.T) {
	r := acceptanceRouter()

	rec := doRequest(r, "GET", "/api/v1/vehicles", "")
	assertStatus(t, rec, http.StatusOK)
	assertContentType(t, rec, "application/json")
}
