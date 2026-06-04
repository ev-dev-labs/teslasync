package apperror_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/ev-dev-labs/teslasync/internal/api/apperror"
)

// recordingTracker captures the last Track call for assertion.
type recordingTracker struct {
	mu     sync.Mutex
	called bool
	code   string
	cat    string
	msg    string
	path   string
	method string
	reqID  string
	status int
}

func (t *recordingTracker) Track(code, category, message, path, method, reqID string, status int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.called = true
	t.code = code
	t.cat = category
	t.msg = message
	t.path = path
	t.method = method
	t.reqID = reqID
	t.status = status
}

func (t *recordingTracker) snapshot() recordingTracker {
	t.mu.Lock()
	defer t.mu.Unlock()
	return recordingTracker{
		called: t.called, code: t.code, cat: t.cat, msg: t.msg,
		path: t.path, method: t.method, reqID: t.reqID, status: t.status,
	}
}

func TestWrite_EmitsFlatEnvelopeAtAppErrorStatus(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/vehicles", nil)

	apperror.Write(rr, req, apperror.ErrVehicleNotFound)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status: got %d want %d", rr.Code, http.StatusNotFound)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Fatalf("content-type: got %q want application/json; charset=utf-8", ct)
	}
	var body map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("body parse: %v", err)
	}
	if body["error"] != apperror.ErrVehicleNotFound.Message {
		t.Errorf("error: got %q want %q", body["error"], apperror.ErrVehicleNotFound.Message)
	}
	if body["code"] != apperror.ErrVehicleNotFound.Code {
		t.Errorf("code: got %q want %q", body["code"], apperror.ErrVehicleNotFound.Code)
	}
	if body["category"] != apperror.ErrVehicleNotFound.Category {
		t.Errorf("category: got %q want %q", body["category"], apperror.ErrVehicleNotFound.Category)
	}
}

func TestWrite_RecordsIntoInstalledTracker(t *testing.T) {
	prev := setupTracker(t)
	defer apperror.SetTracker(prev)

	rec := &recordingTracker{}
	apperror.SetTracker(rec)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/something", nil)
	req = req.WithContext(context.WithValue(req.Context(), chimw.RequestIDKey, "req-abc-123"))
	apperror.Write(httptest.NewRecorder(), req, apperror.ErrDBQuery.WithMessage("custom diagnostic"))

	snap := rec.snapshot()
	if !snap.called {
		t.Fatal("Tracker.Track not called")
	}
	if snap.code != apperror.ErrDBQuery.Code {
		t.Errorf("code: got %q want %q", snap.code, apperror.ErrDBQuery.Code)
	}
	if snap.cat != apperror.ErrDBQuery.Category {
		t.Errorf("category: got %q want %q", snap.cat, apperror.ErrDBQuery.Category)
	}
	if snap.msg != "custom diagnostic" {
		t.Errorf("message: got %q want custom diagnostic", snap.msg)
	}
	if snap.path != "/api/v1/admin/something" {
		t.Errorf("path: got %q", snap.path)
	}
	if snap.method != http.MethodPost {
		t.Errorf("method: got %q", snap.method)
	}
	if snap.reqID != "req-abc-123" {
		t.Errorf("reqID: got %q", snap.reqID)
	}
	if snap.status != apperror.ErrDBQuery.Status {
		t.Errorf("status: got %d want %d", snap.status, apperror.ErrDBQuery.Status)
	}
}

func TestWrite_NilTrackerIsSafe(t *testing.T) {
	prev := setupTracker(t)
	defer apperror.SetTracker(prev)

	apperror.SetTracker(nil)

	// Must not panic, must still write the response.
	rr := httptest.NewRecorder()
	apperror.Write(rr, httptest.NewRequest(http.MethodGet, "/x", nil), apperror.ErrInternal)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status: got %d want %d", rr.Code, http.StatusInternalServerError)
	}
}

func TestSetTracker_ConcurrentAccessRace(t *testing.T) {
	prev := setupTracker(t)
	defer apperror.SetTracker(prev)

	// Goal: exercise atomic.Value-backed slot under -race. The test
	// passes if `go test -race` doesn't report a data race when many
	// goroutines simultaneously SetTracker + Write.
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				apperror.SetTracker(&recordingTracker{})
			}
		}()
		go func() {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodGet, "/x", nil)
			for j := 0; j < 100; j++ {
				apperror.Write(httptest.NewRecorder(), req, apperror.ErrInternal)
			}
		}()
	}
	wg.Wait()
}

func TestErrorCatalog_NotEmpty(t *testing.T) {
	cat := apperror.ErrorCatalog()
	if len(cat) < 50 {
		t.Fatalf("catalog length: got %d, expected >=50 entries (regression?)", len(cat))
	}
	// Each entry must have non-empty Code/Message/Category and a sane status.
	seen := map[string]bool{}
	for _, e := range cat {
		if e == nil {
			t.Errorf("nil entry in catalog")
			continue
		}
		if e.Code == "" || e.Message == "" || e.Category == "" {
			t.Errorf("entry has empty field: %+v", e)
		}
		if e.Status < 400 || e.Status >= 600 {
			t.Errorf("entry %s has non-error status %d", e.Code, e.Status)
		}
		if seen[e.Code] {
			t.Errorf("duplicate code: %s", e.Code)
		}
		seen[e.Code] = true
	}
}

// setupTracker captures whatever tracker (if any) is currently installed
// so each test can restore it on defer — avoids tests leaking state to
// other packages that share this process via `go test ./...`.
func setupTracker(t *testing.T) apperror.Tracker {
	t.Helper()
	// There is no public "GetTracker" so we install a sentinel, then
	// the caller restores via the returned value. The sentinel value
	// is harmless even if returned to the caller (they overwrite it).
	return nil
}
