package softwareupdate

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
)

// HTTP tests for Handler.List.
//
// The handler multiplexes two repo methods off the presence of a
// ?vehicle_id query param, so the coverage map is:
//
//	no vehicle_id           -> GetAll (fleet-wide)
//	vehicle_id=<int64>>0    -> GetByVehicle (scoped)
//	vehicle_id invalid/<=0  -> 400 before any repo call
//	repo error (either)     -> 500
//	nil result set          -> 200 with `[]` (never `null`)
//
// The port interface (softwareUpdateRepository) lets these tests pin every
// repo response and capture every call argument without a database — the
// production *systemdb.SoftwareUpdateRepo satisfies the same interface
// (asserted by TestHandler_RepoImplementsPort).

// fakeSoftwareUpdateRepo records calls and returns canned responses so the
// handler can be exercised hermetically.
type fakeSoftwareUpdateRepo struct {
	byVehicle    []*vehiclemodel.SoftwareUpdate
	byVehicleErr error
	all          []*vehiclemodel.SoftwareUpdate
	allErr       error

	gotByVehicle []byVehicleCall
	gotAll       []allCall
}

type byVehicleCall struct {
	vehicleID int64
	limit     int
	start     time.Time
	end       time.Time
}

type allCall struct {
	limit int
	start time.Time
	end   time.Time
}

func (f *fakeSoftwareUpdateRepo) GetByVehicle(_ context.Context, vehicleID int64, limit int, start, end time.Time) ([]*vehiclemodel.SoftwareUpdate, error) {
	f.gotByVehicle = append(f.gotByVehicle, byVehicleCall{vehicleID, limit, start, end})
	if f.byVehicleErr != nil {
		return nil, f.byVehicleErr
	}
	return f.byVehicle, nil
}

func (f *fakeSoftwareUpdateRepo) GetAll(_ context.Context, limit int, start, end time.Time) ([]*vehiclemodel.SoftwareUpdate, error) {
	f.gotAll = append(f.gotAll, allCall{limit, start, end})
	if f.allErr != nil {
		return nil, f.allErr
	}
	return f.all, nil
}

func newTestHandler(repo softwareUpdateRepository) *Handler {
	return &Handler{repo: repo}
}

func suRequest(target string) *http.Request {
	return httptest.NewRequest(http.MethodGet, target, nil)
}

func ptrTime(t time.Time) *time.Time { return &t }

func sampleUpdate(id, vehicleID int64, version, status string) *vehiclemodel.SoftwareUpdate {
	created := time.Date(2025, 1, 15, 12, 0, 0, 0, time.UTC)
	installed := time.Date(2025, 1, 15, 13, 0, 0, 0, time.UTC)
	return &vehiclemodel.SoftwareUpdate{
		ID:          id,
		VehicleID:   vehicleID,
		Version:     version,
		Status:      status,
		InstalledAt: ptrTime(installed),
		CreatedAt:   created,
	}
}

// ---------- compile-time port conformance ----------

// TestHandler_RepoImplementsPort guarantees the production repo keeps
// satisfying the handler's port; a signature drift on either side fails
// the build here rather than at runtime.
func TestHandler_RepoImplementsPort(t *testing.T) {
	t.Parallel()
	var _ softwareUpdateRepository = (*systemdb.SoftwareUpdateRepo)(nil)
}

// ---------- NewHandler sanity ----------

// TestNewHandler_WiresRepo confirms the production constructor returns a
// usable handler whose port is populated. A nil *database.DB is accepted
// (the repo only dereferences the pool on the first query), which keeps
// this assertion database-free.
func TestNewHandler_WiresRepo(t *testing.T) {
	t.Parallel()
	h := NewHandler(nil)
	if h == nil {
		t.Fatal("NewHandler returned nil")
	}
	if h.repo == nil {
		t.Fatal("NewHandler left repo nil")
	}
}

// ---------- GetAll (fleet-wide) path ----------

func TestList_GetAll(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		target     string
		repo       *fakeSoftwareUpdateRepo
		wantStatus int
		wantLen    int
		wantLimit  int
	}{
		{
			name:   "default_limit_returns_rows",
			target: "/software-updates",
			repo: &fakeSoftwareUpdateRepo{all: []*vehiclemodel.SoftwareUpdate{
				sampleUpdate(2, 42, "2024.32.10", "installed"),
				sampleUpdate(1, 7, "2024.26.5", "installed"),
			}},
			wantStatus: http.StatusOK,
			wantLen:    2,
			wantLimit:  50,
		},
		{
			name:       "empty_result_is_json_array",
			target:     "/software-updates",
			repo:       &fakeSoftwareUpdateRepo{all: nil},
			wantStatus: http.StatusOK,
			wantLen:    0,
			wantLimit:  50,
		},
		{
			name:       "explicit_limit_passed_through",
			target:     "/software-updates?limit=10",
			repo:       &fakeSoftwareUpdateRepo{all: []*vehiclemodel.SoftwareUpdate{}},
			wantStatus: http.StatusOK,
			wantLen:    0,
			wantLimit:  10,
		},
		{
			name:       "over_cap_limit_falls_back_to_default",
			target:     "/software-updates?limit=9999",
			repo:       &fakeSoftwareUpdateRepo{all: []*vehiclemodel.SoftwareUpdate{}},
			wantStatus: http.StatusOK,
			wantLen:    0,
			wantLimit:  50,
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			h := newTestHandler(c.repo)
			rec := httptest.NewRecorder()
			h.List(rec, suRequest(c.target))

			if rec.Code != c.wantStatus {
				t.Fatalf("status = %d, want %d (body=%s)", rec.Code, c.wantStatus, rec.Body.String())
			}
			// GetAll path must never touch the scoped query.
			if len(c.repo.gotByVehicle) != 0 {
				t.Errorf("GetByVehicle called on fleet-wide path: %+v", c.repo.gotByVehicle)
			}
			if len(c.repo.gotAll) != 1 {
				t.Fatalf("GetAll called %d times, want 1", len(c.repo.gotAll))
			}
			if got := c.repo.gotAll[0].limit; got != c.wantLimit {
				t.Errorf("GetAll limit = %d, want %d", got, c.wantLimit)
			}

			var body []*vehiclemodel.SoftwareUpdate
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode: %v (body=%s)", err, rec.Body.String())
			}
			if len(body) != c.wantLen {
				t.Errorf("len(body) = %d, want %d", len(body), c.wantLen)
			}
		})
	}
}

// TestList_GetAll_EmptyIsArrayNotNull pins the byte stream: a nil repo
// slice must serialise as `[]`, not `null`, or the frontend safeArray
// helpers break.
func TestList_GetAll_EmptyIsArrayNotNull(t *testing.T) {
	t.Parallel()
	h := newTestHandler(&fakeSoftwareUpdateRepo{all: nil})
	rec := httptest.NewRecorder()
	h.List(rec, suRequest("/software-updates"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if body := rec.Body.String(); body != "[]\n" && body != "[]" {
		t.Errorf("body = %q, want `[]`", body)
	}
}

// TestList_GetAll_RepoError maps a repo failure to 500 with the shared
// error envelope.
func TestList_GetAll_RepoError(t *testing.T) {
	t.Parallel()
	repo := &fakeSoftwareUpdateRepo{allErr: errors.New("db down")}
	h := newTestHandler(repo)
	rec := httptest.NewRecorder()
	h.List(rec, suRequest("/software-updates"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%s)", rec.Code, rec.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["code"] != "INTERNAL_ERROR" {
		t.Errorf("code = %q, want INTERNAL_ERROR", body["code"])
	}
	if body["error"] == "" {
		t.Error("error message missing")
	}
}

// ---------- GetByVehicle (scoped) path ----------

func TestList_GetByVehicle(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name      string
		target    string
		repo      *fakeSoftwareUpdateRepo
		wantLen   int
		wantVID   int64
		wantLimit int
	}{
		{
			name:   "scoped_returns_rows",
			target: "/software-updates?vehicle_id=42",
			repo: &fakeSoftwareUpdateRepo{byVehicle: []*vehiclemodel.SoftwareUpdate{
				sampleUpdate(3, 42, "2024.32.10", "installed"),
			}},
			wantLen:   1,
			wantVID:   42,
			wantLimit: 50,
		},
		{
			name:      "scoped_empty_is_array",
			target:    "/software-updates?vehicle_id=7",
			repo:      &fakeSoftwareUpdateRepo{byVehicle: nil},
			wantLen:   0,
			wantVID:   7,
			wantLimit: 50,
		},
		{
			name:      "scoped_with_limit",
			target:    "/software-updates?vehicle_id=42&limit=5",
			repo:      &fakeSoftwareUpdateRepo{byVehicle: []*vehiclemodel.SoftwareUpdate{}},
			wantLen:   0,
			wantVID:   42,
			wantLimit: 5,
		},
		{
			name:      "max_int64_vehicle_id",
			target:    "/software-updates?vehicle_id=9223372036854775807",
			repo:      &fakeSoftwareUpdateRepo{byVehicle: []*vehiclemodel.SoftwareUpdate{}},
			wantLen:   0,
			wantVID:   9223372036854775807,
			wantLimit: 50,
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			h := newTestHandler(c.repo)
			rec := httptest.NewRecorder()
			h.List(rec, suRequest(c.target))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
			}
			// Scoped path must never touch the fleet-wide query.
			if len(c.repo.gotAll) != 0 {
				t.Errorf("GetAll called on scoped path: %+v", c.repo.gotAll)
			}
			if len(c.repo.gotByVehicle) != 1 {
				t.Fatalf("GetByVehicle called %d times, want 1", len(c.repo.gotByVehicle))
			}
			call := c.repo.gotByVehicle[0]
			if call.vehicleID != c.wantVID {
				t.Errorf("GetByVehicle vehicleID = %d, want %d", call.vehicleID, c.wantVID)
			}
			if call.limit != c.wantLimit {
				t.Errorf("GetByVehicle limit = %d, want %d", call.limit, c.wantLimit)
			}

			var body []*vehiclemodel.SoftwareUpdate
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode: %v (body=%s)", err, rec.Body.String())
			}
			if len(body) != c.wantLen {
				t.Errorf("len(body) = %d, want %d", len(body), c.wantLen)
			}
		})
	}
}

// TestList_GetByVehicle_RepoError maps a scoped repo failure to 500.
func TestList_GetByVehicle_RepoError(t *testing.T) {
	t.Parallel()
	repo := &fakeSoftwareUpdateRepo{byVehicleErr: errors.New("query failed")}
	h := newTestHandler(repo)
	rec := httptest.NewRecorder()
	h.List(rec, suRequest("/software-updates?vehicle_id=42"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%s)", rec.Code, rec.Body.String())
	}
	if len(repo.gotByVehicle) != 1 {
		t.Errorf("GetByVehicle calls = %d, want 1", len(repo.gotByVehicle))
	}
}

// ---------- vehicle_id validation ----------

// TestList_InvalidVehicleID rejects malformed and non-positive IDs with a
// 400 and, crucially, without dispatching to either repo method.
func TestList_InvalidVehicleID(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name  string
		query string
	}{
		{"non_numeric", "vehicle_id=abc"},
		{"float", "vehicle_id=1.5"},
		{"zero", "vehicle_id=0"},
		{"negative", "vehicle_id=-5"},
		{"overflow_int64", "vehicle_id=99999999999999999999999"},
		{"trailing_space", "vehicle_id=42x"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeSoftwareUpdateRepo{}
			h := newTestHandler(repo)
			rec := httptest.NewRecorder()
			h.List(rec, suRequest("/software-updates?"+c.query))

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
			}
			if len(repo.gotByVehicle) != 0 || len(repo.gotAll) != 0 {
				t.Errorf("repo dispatched on invalid vehicle_id (byVehicle=%d, all=%d)",
					len(repo.gotByVehicle), len(repo.gotAll))
			}
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if body["error"] != "invalid vehicle_id" {
				t.Errorf("error = %q, want %q", body["error"], "invalid vehicle_id")
			}
			if body["code"] != "BAD_REQUEST" {
				t.Errorf("code = %q, want BAD_REQUEST", body["code"])
			}
		})
	}
}

// TestList_EmptyVehicleIDFallsThroughToGetAll proves the branch key is the
// *presence* of a non-empty vehicle_id: an empty value (`?vehicle_id=`) is
// treated as absent and routes to GetAll rather than 400.
func TestList_EmptyVehicleIDFallsThroughToGetAll(t *testing.T) {
	t.Parallel()
	repo := &fakeSoftwareUpdateRepo{all: []*vehiclemodel.SoftwareUpdate{}}
	h := newTestHandler(repo)
	rec := httptest.NewRecorder()
	h.List(rec, suRequest("/software-updates?vehicle_id="))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if len(repo.gotAll) != 1 {
		t.Errorf("GetAll calls = %d, want 1 (empty vehicle_id must fall through)", len(repo.gotAll))
	}
	if len(repo.gotByVehicle) != 0 {
		t.Errorf("GetByVehicle called for empty vehicle_id")
	}
}

// ---------- date-range pass-through ----------

// TestList_DateRangePassThrough verifies parsed start/end instants reach
// the repo for both dispatch paths. The RFC3339 end is made inclusive by
// apiparams (minus 1µs), so we assert the microsecond-adjusted boundary.
func TestList_DateRangePassThrough(t *testing.T) {
	t.Parallel()

	start := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	endExclusive := time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC)
	wantEnd := endExclusive.Add(-time.Microsecond)
	query := "start=2025-01-01T00:00:00Z&end=2025-02-01T00:00:00Z"

	t.Run("get_all", func(t *testing.T) {
		t.Parallel()
		repo := &fakeSoftwareUpdateRepo{all: []*vehiclemodel.SoftwareUpdate{}}
		h := newTestHandler(repo)
		rec := httptest.NewRecorder()
		h.List(rec, suRequest("/software-updates?"+query))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if len(repo.gotAll) != 1 {
			t.Fatalf("GetAll calls = %d, want 1", len(repo.gotAll))
		}
		if !repo.gotAll[0].start.Equal(start) {
			t.Errorf("start = %v, want %v", repo.gotAll[0].start, start)
		}
		if !repo.gotAll[0].end.Equal(wantEnd) {
			t.Errorf("end = %v, want %v", repo.gotAll[0].end, wantEnd)
		}
	})

	t.Run("get_by_vehicle", func(t *testing.T) {
		t.Parallel()
		repo := &fakeSoftwareUpdateRepo{byVehicle: []*vehiclemodel.SoftwareUpdate{}}
		h := newTestHandler(repo)
		rec := httptest.NewRecorder()
		h.List(rec, suRequest("/software-updates?vehicle_id=42&"+query))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if len(repo.gotByVehicle) != 1 {
			t.Fatalf("GetByVehicle calls = %d, want 1", len(repo.gotByVehicle))
		}
		if !repo.gotByVehicle[0].start.Equal(start) {
			t.Errorf("start = %v, want %v", repo.gotByVehicle[0].start, start)
		}
		if !repo.gotByVehicle[0].end.Equal(wantEnd) {
			t.Errorf("end = %v, want %v", repo.gotByVehicle[0].end, wantEnd)
		}
	})

	t.Run("absent_range_is_zero_times", func(t *testing.T) {
		t.Parallel()
		repo := &fakeSoftwareUpdateRepo{all: []*vehiclemodel.SoftwareUpdate{}}
		h := newTestHandler(repo)
		rec := httptest.NewRecorder()
		h.List(rec, suRequest("/software-updates"))

		if len(repo.gotAll) != 1 {
			t.Fatalf("GetAll calls = %d, want 1", len(repo.gotAll))
		}
		if !repo.gotAll[0].start.IsZero() || !repo.gotAll[0].end.IsZero() {
			t.Errorf("absent range should yield zero times, got start=%v end=%v",
				repo.gotAll[0].start, repo.gotAll[0].end)
		}
	})
}

// ---------- wire contract ----------

// TestList_ResponseContentType asserts the JSON content-type frontend
// hooks match on, and that snake_case field tags survive marshalling.
func TestList_ResponseContentType(t *testing.T) {
	t.Parallel()
	repo := &fakeSoftwareUpdateRepo{all: []*vehiclemodel.SoftwareUpdate{
		sampleUpdate(1, 42, "2024.32.10", "installed"),
	}}
	h := newTestHandler(repo)
	rec := httptest.NewRecorder()
	h.List(rec, suRequest("/software-updates"))

	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q, want application/json; charset=utf-8", ct)
	}

	var raw []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode raw: %v", err)
	}
	if len(raw) != 1 {
		t.Fatalf("len = %d, want 1", len(raw))
	}
	for _, k := range []string{"id", "vehicle_id", "version", "status", "installed_at", "created_at"} {
		if _, ok := raw[0][k]; !ok {
			t.Errorf("missing snake_case key %q in %s", k, rec.Body.String())
		}
	}
	if raw[0]["version"] != "2024.32.10" {
		t.Errorf("version = %v, want 2024.32.10", raw[0]["version"])
	}
}
