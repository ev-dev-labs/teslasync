package api

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

func TestErrorTracker_Track(t *testing.T) {
	tracker := NewErrorTracker(10)

	tracker.Track("AUTH_INVALID_CREDENTIALS", "authentication", "bad password", "/api/v1/auth/login", "POST", "req-1", 401)
	tracker.Track("VEHICLE_NOT_FOUND", "vehicle", "vehicle not found", "/api/v1/vehicles/99", "GET", "req-2", 404)
	tracker.Track("AUTH_INVALID_CREDENTIALS", "authentication", "bad password again", "/api/v1/auth/login", "POST", "req-3", 401)

	stats := tracker.Stats()

	if stats.TotalErrors != 3 {
		t.Errorf("expected 3 total errors, got %d", stats.TotalErrors)
	}
	if stats.ByCode["AUTH_INVALID_CREDENTIALS"].Count != 2 {
		t.Errorf("expected AUTH_INVALID_CREDENTIALS count 2, got %d", stats.ByCode["AUTH_INVALID_CREDENTIALS"].Count)
	}
	if stats.ByCode["VEHICLE_NOT_FOUND"].Count != 1 {
		t.Errorf("expected VEHICLE_NOT_FOUND count 1, got %d", stats.ByCode["VEHICLE_NOT_FOUND"].Count)
	}
	if stats.ByCategory["authentication"].Count != 2 {
		t.Errorf("expected authentication category count 2, got %d", stats.ByCategory["authentication"].Count)
	}
	if stats.ByStatus[401].Count != 2 {
		t.Errorf("expected status 401 count 2, got %d", stats.ByStatus[401].Count)
	}
	if len(stats.RecentErrors) != 3 {
		t.Errorf("expected 3 recent errors, got %d", len(stats.RecentErrors))
	}
	if stats.RecentErrors[0].Code != "AUTH_INVALID_CREDENTIALS" {
		t.Errorf("expected most recent error to be AUTH_INVALID_CREDENTIALS, got %s", stats.RecentErrors[0].Code)
	}
}

func TestErrorTracker_RingBuffer(t *testing.T) {
	tracker := NewErrorTracker(3)

	for i := 0; i < 5; i++ {
		tracker.Track("ERR", "internal", "msg", "/test", "GET", "req", 500)
	}

	stats := tracker.Stats()
	if len(stats.RecentErrors) != 3 {
		t.Errorf("expected ring buffer capped at 3, got %d", len(stats.RecentErrors))
	}
	if stats.TotalErrors != 5 {
		t.Errorf("expected 5 total, got %d", stats.TotalErrors)
	}
}

func TestErrorTracker_Concurrent(t *testing.T) {
	tracker := NewErrorTracker(50)
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			tracker.Track("ERR", "internal", "test", "/", "GET", "r", 500)
		}()
	}
	wg.Wait()

	stats := tracker.Stats()
	if stats.TotalErrors != 100 {
		t.Errorf("expected 100 total errors, got %d", stats.TotalErrors)
	}
}

func TestAppError_WithMessage(t *testing.T) {
	err := ErrVehicleNotFound.WithMessage("vehicle 42 not found")
	if err.Message != "vehicle 42 not found" {
		t.Errorf("expected custom message, got %s", err.Message)
	}
	if err.Code != "VEHICLE_NOT_FOUND" {
		t.Errorf("expected code preserved, got %s", err.Code)
	}
	if err.Status != http.StatusNotFound {
		t.Errorf("expected 404 status, got %d", err.Status)
	}
	if ErrVehicleNotFound.Message != "vehicle not found" {
		t.Errorf("original error message should not change")
	}
}

func TestErrorCatalog_Complete(t *testing.T) {
	catalog := ErrorCatalog()
	if len(catalog) < 40 {
		t.Errorf("expected at least 40 error codes in catalog, got %d", len(catalog))
	}
	codes := make(map[string]bool)
	for _, e := range catalog {
		if e.Code == "" {
			t.Error("error code should not be empty")
		}
		if e.Message == "" {
			t.Errorf("error %s has empty message", e.Code)
		}
		if e.Category == "" {
			t.Errorf("error %s has empty category", e.Code)
		}
		if e.Status == 0 {
			t.Errorf("error %s has zero status", e.Code)
		}
		if codes[e.Code] {
			t.Errorf("duplicate error code: %s", e.Code)
		}
		codes[e.Code] = true
	}
}

func TestErrorStatsHandler(t *testing.T) {
	tracker := NewErrorTracker(10)
	tracker.Track("TEST_ERR", "internal", "test", "/test", "GET", "r1", 500)

	handler := ErrorStatsHandler(tracker)
	req := httptest.NewRequest("GET", "/api/v1/system/errors/stats", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	body := rec.Body.String()
	if body == "" {
		t.Error("expected non-empty body")
	}
}

func TestErrorCatalogHandler(t *testing.T) {
	handler := ErrorCatalogHandler()
	req := httptest.NewRequest("GET", "/api/v1/system/errors/catalog", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}
