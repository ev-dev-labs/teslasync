package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// fakeTripsDetailRepo records the trip id passed to GetTrip and
// returns canned responses. Used by the handler tests to exercise
// every branch (happy path, not-found, internal error) without
// touching Postgres.
type fakeTripsDetailRepo struct {
	gotID  int64
	called int
	out    *database.TripDetail
	err    error
}

func (f *fakeTripsDetailRepo) GetTrip(_ context.Context, id int64) (*database.TripDetail, error) {
	f.called++
	f.gotID = id
	return f.out, f.err
}

// newTripsDetailRouter wires the SUT through chi so that
// chi.URLParam(r, "trip_id") resolves correctly. Mirrors the
// pattern used in trip_planner_handler_test.go (chi router round-trip,
// httptest.NewServer not needed because handler is a plain HandlerFunc).
func newTripsDetailRouter(h *TripsDetailHandler) chi.Router {
	r := chi.NewRouter()
	r.Get("/trips/{trip_id}", h.Get)
	return r
}

func ptrString(s string) *string     { return &s }
func ptrTime(t time.Time) *time.Time { return &t }
func ptrFloat64(f float64) *float64  { return &f }
func ptrInt64(i int64) *int64        { return &i }

// ---- handler tests ------------------------------------------------

func TestTripsDetailHandler_Get_HappyPath(t *testing.T) {
	t.Parallel()

	start := time.Date(2026, 3, 1, 8, 0, 0, 0, time.UTC)
	end := time.Date(2026, 3, 15, 18, 0, 0, 0, time.UTC)
	driveStart := time.Date(2026, 3, 1, 9, 0, 0, 0, time.UTC)
	driveEnd := time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC)

	fake := &fakeTripsDetailRepo{
		out: &database.TripDetail{
			ID:           42,
			VehicleID:    7,
			Name:         ptrString("Vacation 2026"),
			StartedAt:    start,
			EndedAt:      ptrTime(end),
			DistanceM:    1234500.0, // 1234500.0 km
			EnergyUsedWh: 250000.0,  // 250000.0 kWh
			DurationS:    1209600,
			DriveCount:   12,
			ChargeCount:  5,
			TotalCost:    75.50,
			Drives: []database.TripDriveSummary{
				{
					ID:           101,
					StartedAt:    driveStart,
					EndedAt:      ptrTime(driveEnd),
					DistanceM:    ptrFloat64(100000.0),
					EnergyUsedWh: ptrFloat64(20000.0),
					DurationS:    ptrInt64(3600),
					StartPlace:   ptrString("Home"),
					EndPlace:     ptrString("Hotel"),
				},
			},
		},
	}
	h := NewTripsDetailHandler(fake)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/trips/42", nil)
	newTripsDetailRouter(h).ServeHTTP(rec, req)

	if got, want := rec.Code, http.StatusOK; got != want {
		t.Fatalf("status: got %d, want %d. body=%s", got, want, rec.Body.String())
	}
	if fake.gotID != 42 {
		t.Errorf("repo called with id %d, want 42", fake.gotID)
	}

	var resp tripDetailResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	// Header field assertions.
	if resp.ID != 42 || resp.VehicleID != 7 {
		t.Errorf("id/vehicle_id: got %d/%d, want 42/7", resp.ID, resp.VehicleID)
	}
	if resp.Name == nil || *resp.Name != "Vacation 2026" {
		t.Errorf("name: got %v", resp.Name)
	}

	// SUPERSET: both start_date and started_at must be present.
	if !resp.StartDate.Equal(start) {
		t.Errorf("start_date: got %v, want %v", resp.StartDate, start)
	}
	if !resp.StartedAt.Equal(start) {
		t.Errorf("started_at: got %v, want %v", resp.StartedAt, start)
	}
	if resp.EndDate == nil || !resp.EndDate.Equal(end) {
		t.Errorf("end_date: got %v, want %v", resp.EndDate, end)
	}
	if resp.EndedAt == nil || !resp.EndedAt.Equal(end) {
		t.Errorf("ended_at: got %v, want %v", resp.EndedAt, end)
	}

	// SI conversion math.
	if resp.TotalDistanceM != 1234500.0 {
		t.Errorf("total_distance_m: got %v, want 1234500.0", resp.TotalDistanceM)
	}
	if resp.TotalEnergyWh != 250000.0 {
		t.Errorf("total_energy_wh: got %v, want 250000.0", resp.TotalEnergyWh)
	}
	if resp.EnergyUsedWh != 250000.0 {
		t.Errorf("energy_used_wh alias: got %v, want 250000.0", resp.EnergyUsedWh)
	}
	if resp.TotalDurationS != 1209600 {
		t.Errorf("total_duration_seconds: got %d, want 1209600", resp.TotalDurationS)
	}
	if resp.TotalCost != 75.50 {
		t.Errorf("total_cost: got %v, want 75.50", resp.TotalCost)
	}
	if resp.DriveCount != 12 || resp.ChargeCount != 5 {
		t.Errorf("counts: got drives=%d charges=%d, want 12/5", resp.DriveCount, resp.ChargeCount)
	}

	// created_at = started_at (compatibility alias).
	if !resp.CreatedAt.Equal(start) {
		t.Errorf("created_at must equal started_at; got %v, want %v", resp.CreatedAt, start)
	}

	// Drive list shape + SI conversion.
	if len(resp.Drives) != 1 {
		t.Fatalf("drives: got %d, want 1", len(resp.Drives))
	}
	d := resp.Drives[0]
	if d.ID != 101 {
		t.Errorf("drive id: got %d, want 101", d.ID)
	}
	if d.DistanceM == nil || *d.DistanceM != 100000.0 {
		t.Errorf("drive distance_km: got %v, want 100000.0", d.DistanceM)
	}
	if d.EnergyUsedWh == nil || *d.EnergyUsedWh != 20000.0 {
		t.Errorf("drive energy_used_wh: got %v, want 20000.0", d.EnergyUsedWh)
	}
	if d.DurationS == nil || *d.DurationS != 3600 {
		t.Errorf("drive duration_s: got %v, want 3600", d.DurationS)
	}
	if d.StartPlace == nil || *d.StartPlace != "Home" {
		t.Errorf("drive start_place: got %v", d.StartPlace)
	}
	if d.EndPlace == nil || *d.EndPlace != "Hotel" {
		t.Errorf("drive end_place: got %v", d.EndPlace)
	}
}

func TestTripsDetailHandler_Get_InProgressTrip_NullEndFields(t *testing.T) {
	t.Parallel()

	start := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)

	fake := &fakeTripsDetailRepo{
		out: &database.TripDetail{
			ID:        7,
			VehicleID: 1,
			StartedAt: start,
			EndedAt:   nil, // open trip
		},
	}
	h := NewTripsDetailHandler(fake)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/trips/7", nil)
	newTripsDetailRouter(h).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200. body=%s", rec.Code, rec.Body.String())
	}

	// Use raw JSON to verify nulls (rubber-duck issue #7).
	var raw map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode raw: %v", err)
	}
	if got, ok := raw["end_date"]; !ok || got != nil {
		t.Errorf("end_date must be JSON null for in-progress trip, got %#v (present=%v)", got, ok)
	}
	if got, ok := raw["ended_at"]; !ok || got != nil {
		t.Errorf("ended_at must be JSON null for in-progress trip, got %#v (present=%v)", got, ok)
	}
}

func TestTripsDetailHandler_Get_ZeroDrivesEmptyArray(t *testing.T) {
	t.Parallel()

	fake := &fakeTripsDetailRepo{
		out: &database.TripDetail{
			ID:        9,
			VehicleID: 2,
			StartedAt: time.Now().UTC(),
			Drives:    nil, // explicitly nil
		},
	}
	h := NewTripsDetailHandler(fake)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/trips/9", nil)
	newTripsDetailRouter(h).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: %d body=%s", rec.Code, rec.Body.String())
	}
	// Confirm `drives` serialises as `[]` not `null`.
	if !strings.Contains(rec.Body.String(), `"drives":[]`) {
		t.Errorf("drives must serialise as empty array, body=%s", rec.Body.String())
	}
}

func TestTripsDetailHandler_Get_NotFound(t *testing.T) {
	t.Parallel()

	fake := &fakeTripsDetailRepo{err: database.ErrTripNotFound}
	h := NewTripsDetailHandler(fake)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/trips/999", nil)
	newTripsDetailRouter(h).ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status: got %d, want 404. body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "trip not found") {
		t.Errorf("expected 'trip not found' in body, got %s", rec.Body.String())
	}
}

func TestTripsDetailHandler_Get_RepoError(t *testing.T) {
	t.Parallel()

	fake := &fakeTripsDetailRepo{err: errors.New("boom")}
	h := NewTripsDetailHandler(fake)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/trips/5", nil)
	newTripsDetailRouter(h).ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status: got %d, want 500. body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "failed to load trip") {
		t.Errorf("expected 'failed to load trip' in body, got %s", rec.Body.String())
	}
}

func TestTripsDetailHandler_Get_BadID(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		path string
	}{
		{"non_numeric", "/trips/abc"},
		{"zero", "/trips/0"},
		{"negative", "/trips/-1"},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			fake := &fakeTripsDetailRepo{}
			h := NewTripsDetailHandler(fake)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			newTripsDetailRouter(h).ServeHTTP(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status: got %d, want 400. body=%s", rec.Code, rec.Body.String())
			}
			if fake.called != 0 {
				t.Errorf("repo must not be called for invalid id; called=%d", fake.called)
			}
		})
	}
}

func TestNewTripsDetailHandler_NilRepoPanics(t *testing.T) {
	t.Parallel()

	defer func() {
		if recover() == nil {
			t.Fatal("expected NewTripsDetailHandler(nil) to panic")
		}
	}()
	_ = NewTripsDetailHandler(nil)
}

// ---- conversion-only test (covers null distance/energy preservation) -----

func TestBuildTripDetailResponse_PreservesNullDriveFields(t *testing.T) {
	t.Parallel()

	td := &database.TripDetail{
		ID:        1,
		VehicleID: 1,
		StartedAt: time.Now().UTC(),
		Drives: []database.TripDriveSummary{
			{ID: 1, StartedAt: time.Now().UTC()}, // all optional fields nil
		},
	}
	resp := buildTripDetailResponse(td)
	if len(resp.Drives) != 1 {
		t.Fatalf("expected 1 drive, got %d", len(resp.Drives))
	}
	d := resp.Drives[0]
	if d.DistanceM != nil {
		t.Errorf("nil distance_m must surface as nil distance_km, got %v", *d.DistanceM)
	}
	if d.EnergyUsedWh != nil {
		t.Errorf("nil energy_used_wh must surface as nil energy_used_wh, got %v", *d.EnergyUsedWh)
	}
	if d.DurationS != nil {
		t.Errorf("nil duration_s must surface as nil, got %v", *d.DurationS)
	}
	if d.StartPlace != nil || d.EndPlace != nil {
		t.Errorf("nil place fields must surface as nil")
	}
}
