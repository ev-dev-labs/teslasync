package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/api/apitest"
	apimw "github.com/ev-dev-labs/teslasync/internal/api/middleware"
	"github.com/go-chi/chi/v5"
)

// acceptanceRouter creates a chi router with just enough wiring
// to exercise route matching, health endpoints, and method handling
// without any database or Tesla dependencies.
func acceptanceRouter() http.Handler {
	r := chi.NewRouter()

	r.Use(apimw.SecurityHeaders)
	r.Use(apimw.Recovery)
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
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

func TestAcceptance_HealthzReturns200(t *testing.T) {
	r := acceptanceRouter()
	rec := apitest.DoRequest(r, "GET", "/healthz", "")
	apitest.AssertStatus(t, rec, http.StatusOK)
	body := apitest.AssertJSON(t, rec)
	if body["status"] != "ok" {
		t.Errorf("expected status ok, got %v", body["status"])
	}
}

func TestAcceptance_ReadyzReturns200(t *testing.T) {
	r := acceptanceRouter()
	rec := apitest.DoRequest(r, "GET", "/readyz", "")
	apitest.AssertStatus(t, rec, http.StatusOK)
}

func TestAcceptance_AuthStatusStructure(t *testing.T) {
	r := acceptanceRouter()
	rec := apitest.DoRequest(r, "GET", "/api/v1/auth/status", "")
	apitest.AssertStatus(t, rec, http.StatusOK)
	apitest.AssertContentType(t, rec, "application/json")
	body := apitest.AssertJSON(t, rec)
	if _, ok := body["authenticated"]; !ok {
		t.Error("expected 'authenticated' field in response")
	}
}

func TestAcceptance_UnknownPath_Returns404(t *testing.T) {
	r := acceptanceRouter()
	rec := apitest.DoRequest(r, "GET", "/api/v1/nonexistent", "")
	apitest.AssertStatus(t, rec, http.StatusNotFound)
}

func TestAcceptance_UnknownTopLevelPath_Returns404(t *testing.T) {
	r := acceptanceRouter()
	rec := apitest.DoRequest(r, "GET", "/totally-unknown", "")
	apitest.AssertStatus(t, rec, http.StatusNotFound)
}

func TestAcceptance_MethodNotAllowed_Returns405(t *testing.T) {
	r := acceptanceRouter()
	rec := apitest.DoRequest(r, "POST", "/healthz", "")
	apitest.AssertStatus(t, rec, http.StatusMethodNotAllowed)
}

func TestAcceptance_MethodNotAllowed_VehiclesSync(t *testing.T) {
	r := acceptanceRouter()
	rec := apitest.DoRequest(r, "GET", "/api/v1/vehicles/sync", "")
	apitest.AssertStatus(t, rec, http.StatusMethodNotAllowed)
}

func TestAcceptance_SecurityHeaders_OnAllResponses(t *testing.T) {
	r := acceptanceRouter()

	paths := []string{"/healthz", "/readyz", "/api/v1/auth/status"}
	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			rec := apitest.DoRequest(r, "GET", path, "")
			if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Error("missing X-Content-Type-Options header")
			}
			if rec.Header().Get("X-Frame-Options") != "DENY" {
				t.Error("missing X-Frame-Options header")
			}
		})
	}
}

func TestAcceptance_PanicRecovery(t *testing.T) {
	r := chi.NewRouter()
	r.Use(apimw.Recovery)
	r.Get("/boom", func(w http.ResponseWriter, r *http.Request) {
		panic("kaboom")
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/boom", nil)
	r.ServeHTTP(rec, req)

	apitest.AssertStatus(t, rec, http.StatusInternalServerError)
	body := apitest.AssertJSON(t, rec)
	if body["error"] != "internal server error" {
		t.Errorf("expected 'internal server error', got %v", body["error"])
	}
}

func TestAcceptance_ContentTypeJSON(t *testing.T) {
	r := acceptanceRouter()

	rec := apitest.DoRequest(r, "GET", "/api/v1/vehicles", "")
	apitest.AssertStatus(t, rec, http.StatusOK)
	apitest.AssertContentType(t, rec, "application/json")
}
