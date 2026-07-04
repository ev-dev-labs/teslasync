package visitedlocation

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	geomodel "github.com/ev-dev-labs/teslasync/internal/models/geo"
)

// fakeVisitedLocationRepo is an in-memory visitedLocationRepo double. It
// records which method was called and the arguments each received so the
// handler tests can assert routing (GetAll vs GetByVehicle) and parameter
// propagation (limit) without touching Postgres.
type fakeVisitedLocationRepo struct {
	allCalled       int
	byVehicleCalled int

	gotVehicleID int64
	gotLimit     int

	out []*geomodel.VisitedLocation
	err error
}

func (f *fakeVisitedLocationRepo) GetAll(_ context.Context, limit int) ([]*geomodel.VisitedLocation, error) {
	f.allCalled++
	f.gotLimit = limit
	return f.out, f.err
}

func (f *fakeVisitedLocationRepo) GetByVehicle(_ context.Context, vehicleID int64, limit int) ([]*geomodel.VisitedLocation, error) {
	f.byVehicleCalled++
	f.gotVehicleID = vehicleID
	f.gotLimit = limit
	return f.out, f.err
}

func ptrInt64(i int64) *int64        { return &i }
func ptrTime(t time.Time) *time.Time { return &t }

func doList(h *Handler, target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	h.List(rec, req)
	return rec
}

// sampleLocation is a fully-populated fixture used across the response-shape
// assertions.
func sampleLocation(last, created time.Time) *geomodel.VisitedLocation {
	return &geomodel.VisitedLocation{
		ID:             11,
		VehicleID:      7,
		AddressID:      ptrInt64(3),
		AddressName:    "Home — 123 Market St",
		VisitCount:     42,
		TotalDurationS: 7200.5,
		LastVisited:    ptrTime(last),
		CreatedAt:      created,
	}
}

// ---- routing: GetAll vs GetByVehicle -------------------------------------

func TestHandler_List_GetAll_NoVehicleFilter(t *testing.T) {
	t.Parallel()

	created := time.Date(2026, 5, 1, 8, 0, 0, 0, time.UTC)
	last := time.Date(2026, 5, 31, 18, 0, 0, 0, time.UTC)
	fake := &fakeVisitedLocationRepo{out: []*geomodel.VisitedLocation{sampleLocation(last, created)}}
	h := newHandler(fake)

	rec := doList(h, "/locations")

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200. body=%s", rec.Code, rec.Body.String())
	}
	if fake.allCalled != 1 {
		t.Errorf("GetAll called %d times, want 1", fake.allCalled)
	}
	if fake.byVehicleCalled != 0 {
		t.Errorf("GetByVehicle must not be called without vehicle_id; called=%d", fake.byVehicleCalled)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("content-type: got %q", ct)
	}

	var resp []geomodel.VisitedLocation
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp) != 1 {
		t.Fatalf("expected 1 location, got %d", len(resp))
	}
}

func TestHandler_List_GetByVehicle_Filter(t *testing.T) {
	t.Parallel()

	fake := &fakeVisitedLocationRepo{out: nil}
	h := newHandler(fake)

	rec := doList(h, "/locations?vehicle_id=7")

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200. body=%s", rec.Code, rec.Body.String())
	}
	if fake.byVehicleCalled != 1 {
		t.Errorf("GetByVehicle called %d times, want 1", fake.byVehicleCalled)
	}
	if fake.allCalled != 0 {
		t.Errorf("GetAll must not be called when vehicle_id present; called=%d", fake.allCalled)
	}
	if fake.gotVehicleID != 7 {
		t.Errorf("GetByVehicle vehicleID: got %d, want 7", fake.gotVehicleID)
	}
}

// ---- pagination (limit) propagation; offset intentionally ignored --------

func TestHandler_List_LimitPropagation(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name      string
		target    string
		wantAll   bool // expect GetAll (true) or GetByVehicle (false)
		wantVeh   int64
		wantLimit int
	}{
		{
			name:      "get_all_default_limit",
			target:    "/locations",
			wantAll:   true,
			wantLimit: 50, // apiparams.Pagination default
		},
		{
			name:      "get_all_custom_limit",
			target:    "/locations?limit=10",
			wantAll:   true,
			wantLimit: 10,
		},
		{
			// offset must NOT alter the limit passed to the repo; this
			// aggregation endpoint has no offset support and silently
			// discards it (top-N by visit_count).
			name:      "offset_is_ignored",
			target:    "/locations?limit=10&offset=20",
			wantAll:   true,
			wantLimit: 10,
		},
		{
			name:      "get_by_vehicle_custom_limit",
			target:    "/locations?vehicle_id=42&limit=25",
			wantAll:   false,
			wantVeh:   42,
			wantLimit: 25,
		},
		{
			// over-cap limit falls back to the default 50 (see
			// apiparams.Pagination), it is NOT clamped to the 1000 cap.
			name:      "over_cap_limit_falls_back_to_default",
			target:    "/locations?limit=5000",
			wantAll:   true,
			wantLimit: 50,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			fake := &fakeVisitedLocationRepo{}
			h := newHandler(fake)

			rec := doList(h, tc.target)
			if rec.Code != http.StatusOK {
				t.Fatalf("status: got %d, want 200. body=%s", rec.Code, rec.Body.String())
			}
			if fake.gotLimit != tc.wantLimit {
				t.Errorf("limit: got %d, want %d", fake.gotLimit, tc.wantLimit)
			}
			if tc.wantAll {
				if fake.allCalled != 1 || fake.byVehicleCalled != 0 {
					t.Fatalf("routing: allCalled=%d byVehicleCalled=%d, want 1/0", fake.allCalled, fake.byVehicleCalled)
				}
			} else {
				if fake.byVehicleCalled != 1 || fake.allCalled != 0 {
					t.Fatalf("routing: byVehicleCalled=%d allCalled=%d, want 1/0", fake.byVehicleCalled, fake.allCalled)
				}
				if fake.gotVehicleID != tc.wantVeh {
					t.Errorf("vehicleID: got %d, want %d", fake.gotVehicleID, tc.wantVeh)
				}
			}
		})
	}
}

// ---- empty / nil result → JSON [] ----------------------------------------

func TestHandler_List_EmptyResultSerialisesAsArray(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name   string
		out    []*geomodel.VisitedLocation
		target string
	}{
		{"nil_slice_get_all", nil, "/locations"},
		{"empty_slice_get_all", []*geomodel.VisitedLocation{}, "/locations"},
		{"nil_slice_by_vehicle", nil, "/locations?vehicle_id=5"},
		{"empty_slice_by_vehicle", []*geomodel.VisitedLocation{}, "/locations?vehicle_id=5"},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			fake := &fakeVisitedLocationRepo{out: tc.out}
			h := newHandler(fake)

			rec := doList(h, tc.target)
			if rec.Code != http.StatusOK {
				t.Fatalf("status: got %d, want 200", rec.Code)
			}
			body := strings.TrimSpace(rec.Body.String())
			if body != "[]" {
				t.Errorf("empty result must serialise as [] not null; got %q", body)
			}
		})
	}
}

// ---- repo error paths → 500 ----------------------------------------------

func TestHandler_List_RepoError(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name          string
		target        string
		wantAll       int
		wantByVehicle int
	}{
		{"get_all_error", "/locations", 1, 0},
		{"get_by_vehicle_error", "/locations?vehicle_id=9", 0, 1},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			fake := &fakeVisitedLocationRepo{err: errors.New("db exploded")}
			h := newHandler(fake)

			rec := doList(h, tc.target)
			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("status: got %d, want 500. body=%s", rec.Code, rec.Body.String())
			}
			if fake.allCalled != tc.wantAll || fake.byVehicleCalled != tc.wantByVehicle {
				t.Errorf("routing: allCalled=%d byVehicleCalled=%d, want %d/%d",
					fake.allCalled, fake.byVehicleCalled, tc.wantAll, tc.wantByVehicle)
			}
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode error body: %v", err)
			}
			if body["error"] != "failed to get visited locations" {
				t.Errorf("error message: got %q, want 'failed to get visited locations'", body["error"])
			}
			if body["code"] != "INTERNAL_ERROR" {
				t.Errorf("error code: got %q, want INTERNAL_ERROR", body["code"])
			}
		})
	}
}

// ---- invalid vehicle_id → 400, repo untouched ----------------------------

func TestHandler_List_InvalidVehicleID(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name   string
		target string
	}{
		{"non_numeric", "/locations?vehicle_id=abc"},
		{"zero", "/locations?vehicle_id=0"},
		{"negative", "/locations?vehicle_id=-1"},
		{"overflow", "/locations?vehicle_id=99999999999999999999999999"},
		{"float", "/locations?vehicle_id=1.5"},
		{"whitespace", "/locations?vehicle_id=%20"},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			fake := &fakeVisitedLocationRepo{}
			h := newHandler(fake)

			rec := doList(h, tc.target)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status: got %d, want 400. body=%s", rec.Code, rec.Body.String())
			}
			if fake.allCalled != 0 || fake.byVehicleCalled != 0 {
				t.Errorf("repo must not be called for invalid vehicle_id; all=%d byVehicle=%d",
					fake.allCalled, fake.byVehicleCalled)
			}
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode error body: %v", err)
			}
			if body["error"] != "invalid vehicle_id" {
				t.Errorf("error message: got %q, want 'invalid vehicle_id'", body["error"])
			}
			if body["code"] != "BAD_REQUEST" {
				t.Errorf("error code: got %q, want BAD_REQUEST", body["code"])
			}
		})
	}
}

// ---- empty vehicle_id param falls through to GetAll ----------------------

func TestHandler_List_EmptyVehicleParamUsesGetAll(t *testing.T) {
	t.Parallel()

	// vehicle_id present but empty ("?vehicle_id=") must be treated as
	// "unscoped" (GetAll), NOT as an invalid id — the query-string key
	// exists but carries no value.
	fake := &fakeVisitedLocationRepo{}
	h := newHandler(fake)

	rec := doList(h, "/locations?vehicle_id=")
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200. body=%s", rec.Code, rec.Body.String())
	}
	if fake.allCalled != 1 || fake.byVehicleCalled != 0 {
		t.Errorf("empty vehicle_id must route to GetAll; all=%d byVehicle=%d",
			fake.allCalled, fake.byVehicleCalled)
	}
}

// ---- full model shape over the wire --------------------------------------

func TestHandler_List_ResponseShape(t *testing.T) {
	t.Parallel()

	created := time.Date(2026, 4, 1, 8, 0, 0, 0, time.UTC)
	last := time.Date(2026, 5, 31, 18, 30, 0, 0, time.UTC)
	fake := &fakeVisitedLocationRepo{out: []*geomodel.VisitedLocation{sampleLocation(last, created)}}
	h := newHandler(fake)

	rec := doList(h, "/locations?vehicle_id=7")
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200. body=%s", rec.Code, rec.Body.String())
	}

	// Typed decode: field values round-trip correctly.
	var resp []geomodel.VisitedLocation
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp) != 1 {
		t.Fatalf("expected 1 location, got %d", len(resp))
	}
	got := resp[0]
	if got.ID != 11 || got.VehicleID != 7 {
		t.Errorf("id/vehicle_id: got %d/%d, want 11/7", got.ID, got.VehicleID)
	}
	if got.AddressID == nil || *got.AddressID != 3 {
		t.Errorf("address_id: got %v, want 3", got.AddressID)
	}
	if got.AddressName != "Home — 123 Market St" {
		t.Errorf("address_name: got %q", got.AddressName)
	}
	if got.VisitCount != 42 {
		t.Errorf("visit_count: got %d, want 42", got.VisitCount)
	}
	if got.TotalDurationS != 7200.5 {
		t.Errorf("total_duration_s: got %v, want 7200.5", got.TotalDurationS)
	}
	if got.LastVisited == nil || !got.LastVisited.Equal(last) {
		t.Errorf("last_visited: got %v, want %v", got.LastVisited, last)
	}
	if !got.CreatedAt.Equal(created) {
		t.Errorf("created_at: got %v, want %v", got.CreatedAt, created)
	}

	// Wire contract: snake_case JSON keys the frontend depends on must be
	// present exactly (camelCaseKeys retains snake_case on the client).
	var raw []map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode raw: %v", err)
	}
	for _, key := range []string{"id", "vehicle_id", "address_id", "address_name", "visit_count", "total_duration_s", "last_visited", "created_at"} {
		if _, ok := raw[0][key]; !ok {
			t.Errorf("response missing expected JSON key %q; row=%v", key, raw[0])
		}
	}
}

// TestHandler_List_OmitemptyNullables proves the omitempty pointer fields
// (address_id, last_visited) drop out of the payload when nil, so the wire
// stays lean for derived-from-drives rows that carry no legacy address FK.
func TestHandler_List_OmitemptyNullables(t *testing.T) {
	t.Parallel()

	fake := &fakeVisitedLocationRepo{out: []*geomodel.VisitedLocation{{
		ID:          1,
		VehicleID:   2,
		AddressName: "Unnamed Place",
		VisitCount:  1,
		CreatedAt:   time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		// AddressID and LastVisited deliberately nil.
	}}}
	h := newHandler(fake)

	rec := doList(h, "/locations")
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rec.Code)
	}
	var raw []map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode raw: %v", err)
	}
	if _, ok := raw[0]["address_id"]; ok {
		t.Errorf("nil address_id must be omitted (omitempty); row=%v", raw[0])
	}
	if _, ok := raw[0]["last_visited"]; ok {
		t.Errorf("nil last_visited must be omitted (omitempty); row=%v", raw[0])
	}
	// Non-omitempty required keys are still present.
	if _, ok := raw[0]["address_name"]; !ok {
		t.Errorf("address_name must always be present; row=%v", raw[0])
	}
}

// ---- nonNilLocations pure-function contract ------------------------------

func TestNonNilLocations(t *testing.T) {
	t.Parallel()

	t.Run("nil_returns_non_nil_empty", func(t *testing.T) {
		t.Parallel()
		out := nonNilLocations(nil)
		if out == nil {
			t.Fatal("must return non-nil slice so JSON encodes as [] not null")
		}
		if len(out) != 0 {
			t.Errorf("expected empty slice, got len %d", len(out))
		}
	})

	t.Run("passes_through_and_preserves_order", func(t *testing.T) {
		t.Parallel()
		in := []*geomodel.VisitedLocation{
			{ID: 3},
			{ID: 1},
			{ID: 2},
		}
		out := nonNilLocations(in)
		if len(out) != 3 {
			t.Fatalf("expected 3, got %d", len(out))
		}
		wantIDs := []int64{3, 1, 2}
		for i, want := range wantIDs {
			if out[i].ID != want {
				t.Errorf("order[%d]: got id %d, want %d", i, out[i].ID, want)
			}
		}
	})

	t.Run("empty_non_nil_passes_through", func(t *testing.T) {
		t.Parallel()
		in := []*geomodel.VisitedLocation{}
		out := nonNilLocations(in)
		if out == nil || len(out) != 0 {
			t.Errorf("empty non-nil slice must pass through as empty; got %v", out)
		}
	})
}

// ---- constructor fail-fast contracts -------------------------------------

func TestNewHandler_NilDBPanics(t *testing.T) {
	t.Parallel()

	defer func() {
		if recover() == nil {
			t.Fatal("expected NewHandler(nil) to panic")
		}
	}()
	_ = NewHandler(nil)
}

func TestNewHandler_NilRepoPanics(t *testing.T) {
	t.Parallel()

	defer func() {
		if recover() == nil {
			t.Fatal("expected newHandler(nil) to panic")
		}
	}()
	_ = newHandler(nil)
}
