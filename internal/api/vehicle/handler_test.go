package vehicle

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/go-chi/chi/v5"
)

// newPositionsRequest builds an *http.Request with chi route context wired
// so urlParamInt64(r, "vehicleID") inside the handler resolves correctly.
// Pass an empty string for url to use the default "/positions" target.
func newPositionsRequest(t *testing.T, vehicleID, url string) *http.Request {
	t.Helper()
	target := url
	if target == "" {
		target = "/positions"
	}
	req := httptest.NewRequest(http.MethodGet, target, nil)
	routeCtx := chi.NewRouteContext()
	routeCtx.URLParams.Add("vehicleID", vehicleID)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
}

// TestVehicleHandler_Positions_ReturnsRowsNewestFirst verifies the
// chronological-reversal contract: Timeline returns rows ordered ascending
// by timestamp, and the handler MUST flip them to newest-first so the
// frontend map/timeline renders most-recent positions at the top.
func TestVehicleHandler_Positions_ReturnsRowsNewestFirst(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 10, 0, 0, 0, time.UTC)
	asc := []signal.TimelineRow{
		{Timestamp: t0, Fields: map[string]signal.SignalValue{"latitude": 37.0, "longitude": -122.0}},
		{Timestamp: t0.Add(1 * time.Minute), Fields: map[string]signal.SignalValue{"latitude": 37.1, "longitude": -122.1}},
		{Timestamp: t0.Add(2 * time.Minute), Fields: map[string]signal.SignalValue{"latitude": 37.2, "longitude": -122.2}},
	}
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return asc, nil
		},
	}
	h := &Handler{state: fake}

	rec := httptest.NewRecorder()
	h.Positions(rec, newPositionsRequest(t, "42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if len(got) != 3 {
		t.Fatalf("response row count = %d, want 3; rows=%v", len(got), got)
	}
	// Newest-first: row[0] must be the LAST emission (t0+2m), row[2] the
	// first (t0). JSON unmarshals time.Time to RFC3339 strings — compare by
	// parsing back to time.Time so we don't depend on string format quirks.
	want := []time.Time{t0.Add(2 * time.Minute), t0.Add(1 * time.Minute), t0}
	for i, row := range got {
		raw, ok := row["created_at"].(string)
		if !ok {
			t.Fatalf("row %d created_at missing or not a string; row=%v", i, row)
		}
		ts, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			t.Fatalf("row %d created_at parse: %v; raw=%q", i, err, raw)
		}
		if !ts.Equal(want[i]) {
			t.Fatalf("row %d created_at = %v, want %v (reversal failed)", i, ts, want[i])
		}
	}
}

// TestVehicleHandler_Positions_RespectsLimit verifies that the ?limit=N
// query param trims the response to N rows AFTER reversal, so the N most
// recent positions are returned (not the N oldest).
func TestVehicleHandler_Positions_RespectsLimit(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 10, 0, 0, 0, time.UTC)
	rows := make([]signal.TimelineRow, 100)
	for i := range rows {
		rows[i] = signal.TimelineRow{
			Timestamp: t0.Add(time.Duration(i) * time.Second),
			Fields: map[string]signal.SignalValue{
				"latitude":  37.0 + float64(i)*0.001,
				"longitude": -122.0 - float64(i)*0.001,
			},
		}
	}
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return rows, nil
		},
	}
	h := &Handler{state: fake}

	rec := httptest.NewRecorder()
	h.Positions(rec, newPositionsRequest(t, "42", "/positions?limit=10"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if len(got) != 10 {
		t.Fatalf("response row count = %d, want exactly 10 (limit applied after reversal)", len(got))
	}
	// First returned row must be the LAST raw row (newest), not the first.
	wantNewest := t0.Add(99 * time.Second)
	raw, ok := got[0]["created_at"].(string)
	if !ok {
		t.Fatalf("row 0 created_at missing; row=%v", got[0])
	}
	ts, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		t.Fatalf("row 0 created_at parse: %v; raw=%q", err, raw)
	}
	if !ts.Equal(wantNewest) {
		t.Fatalf("row 0 created_at = %v, want %v (must be NEWEST after limit)", ts, wantNewest)
	}
}

// TestVehicleHandler_Positions_AliasesSpeedAndTs locks in the legacy
// PositionRecord JSON contract: the handler MUST emit `speed` (alias of
// the signal_log `speed_mph` projection), `created_at` (alias of the
// authoritative TimelineRow.Timestamp), and `id` (a stable string derived
// from the timestamp). Removing any alias would break the frontend.
func TestVehicleHandler_Positions_AliasesSpeedAndTs(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 10, 0, 0, 0, time.UTC)
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return []signal.TimelineRow{
				{Timestamp: t0, Fields: map[string]signal.SignalValue{
					"latitude":    37.0,
					"longitude":   -122.0,
					"speed_mph":   65.0,
					"heading":     180.0,
					"elevation_m": 12.5,
				}},
			}, nil
		},
	}
	h := &Handler{state: fake}

	rec := httptest.NewRecorder()
	h.Positions(rec, newPositionsRequest(t, "42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if len(got) != 1 {
		t.Fatalf("response row count = %d, want 1", len(got))
	}
	row := got[0]

	// speed alias: PositionRecord uses `speed`, signal_log emits `speed_mph`
	speed, ok := row["speed"]
	if !ok {
		t.Fatalf("row missing `speed` alias; row=%v", row)
	}
	if speed != 65.0 {
		t.Fatalf("row.speed = %#v, want 65.0", speed)
	}

	// created_at alias: PositionRecord uses `created_at`, TimelineRow has Timestamp
	createdAtRaw, ok := row["created_at"].(string)
	if !ok {
		t.Fatalf("row missing `created_at` alias; row=%v", row)
	}
	ca, err := time.Parse(time.RFC3339Nano, createdAtRaw)
	if err != nil {
		t.Fatalf("created_at parse: %v; raw=%q", err, createdAtRaw)
	}
	if !ca.Equal(t0) {
		t.Fatalf("row.created_at = %v, want %v", ca, t0)
	}

	// id MUST be present (frontend list-key) and derived from the timestamp.
	if _, ok := row["id"]; !ok {
		t.Fatalf("row missing `id`; row=%v", row)
	}
	if id, ok := row["id"].(string); !ok || id == "" {
		t.Fatalf("row.id = %#v, want non-empty string", row["id"])
	}
}

// TestVehicleHandler_Positions_PropagatesError verifies that a Timeline
// transport error becomes a 500 to the client (never a 200 with a nil or
// partial body).
func TestVehicleHandler_Positions_PropagatesError(t *testing.T) {
	wantErr := errors.New("simulated pgx connection lost")
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return nil, wantErr
		},
	}
	h := &Handler{state: fake}

	rec := httptest.NewRecorder()
	h.Positions(rec, newPositionsRequest(t, "42", ""))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

// TestVehicleHandler_Positions_InvalidVehicleID verifies the input
// validation: a non-numeric `vehicleID` URL param is a 400, and the
// reader is NEVER called (proven by gotTimelineCalls == 0).
func TestVehicleHandler_Positions_InvalidVehicleID(t *testing.T) {
	fake := &fakeStateReader{}
	h := &Handler{state: fake}

	rec := httptest.NewRecorder()
	h.Positions(rec, newPositionsRequest(t, "not-a-number", ""))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if fake.gotTimelineCalls != 0 {
		t.Fatalf("Timeline call count = %d, want 0 (handler must reject before calling reader)", fake.gotTimelineCalls)
	}
}

type fakeVehicleListFetcher struct {
	all       []*vehiclemodel.Vehicle
	page      []*vehiclemodel.Vehicle
	allCalls  int
	pageCalls int
	limit     int
	offset    int
}

func (f *fakeVehicleListFetcher) GetAll(context.Context) ([]*vehiclemodel.Vehicle, error) {
	f.allCalls++
	return f.all, nil
}

func (f *fakeVehicleListFetcher) GetPage(_ context.Context, limit, offset int) ([]*vehiclemodel.Vehicle, error) {
	f.pageCalls++
	f.limit = limit
	f.offset = offset
	return f.page, nil
}

func TestVehicleHandler_ListWithoutPaginationReturnsEntireFleet(t *testing.T) {
	vehicles := make([]*vehiclemodel.Vehicle, 51)
	for i := range vehicles {
		vehicles[i] = &vehiclemodel.Vehicle{ID: int64(i + 1)}
	}
	repo := &fakeVehicleListFetcher{all: vehicles}
	h := &Handler{vehicleRepo: repo}

	rec := httptest.NewRecorder()
	h.List(rec, httptest.NewRequest(http.MethodGet, "/vehicles", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var got []vehiclemodel.Vehicle
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode list response: %v; body=%s", err, rec.Body.String())
	}
	if len(got) != len(vehicles) {
		t.Fatalf("vehicle count = %d, want complete fleet count %d", len(got), len(vehicles))
	}
	if repo.allCalls != 1 || repo.pageCalls != 0 {
		t.Fatalf("calls GetAll=%d GetPage=%d, want GetAll once only", repo.allCalls, repo.pageCalls)
	}
	if got := rec.Header().Get("X-Pagination-Limit"); got != "" {
		t.Fatalf("default full-list response unexpectedly has pagination header %q", got)
	}
}

func TestVehicleHandler_ListWithPaginationUsesPage(t *testing.T) {
	repo := &fakeVehicleListFetcher{page: []*vehiclemodel.Vehicle{{ID: 2}}}
	h := &Handler{vehicleRepo: repo}

	rec := httptest.NewRecorder()
	h.List(rec, httptest.NewRequest(http.MethodGet, "/vehicles?limit=1&offset=1", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if repo.allCalls != 0 || repo.pageCalls != 1 {
		t.Fatalf("calls GetAll=%d GetPage=%d, want GetPage once only", repo.allCalls, repo.pageCalls)
	}
	if repo.limit != 1 || repo.offset != 1 {
		t.Fatalf("GetPage arguments = (%d, %d), want (1, 1)", repo.limit, repo.offset)
	}
	if got, want := rec.Header().Get("X-Pagination-Limit"), "1"; got != want {
		t.Fatalf("X-Pagination-Limit = %q, want %q", got, want)
	}
}

// fakeStateReader is a hand-rolled signal.StateReader for handler tests.
// Duplicated from internal/api/media_handler_test.go for the duration of
// Phase R2; tests inside the carved subpackage can't import the parent's
// test-only fixture (would close the cycle), so a local copy lives here
// until apitest.FakeStateReader is promoted.
type fakeStateReader struct {
	stateFn    func(ctx context.Context, vehicleID int64, at time.Time) (signal.State, error)
	signalAtFn func(ctx context.Context, vehicleID int64, name string, at time.Time) (signal.SignalValue, error)
	timelineFn func(ctx context.Context, vehicleID int64, fields []signal.FieldMapping, from, to time.Time, opts signal.TimelineOptions) ([]signal.TimelineRow, error)

	gotTimelineCalls int
}

func (f *fakeStateReader) State(ctx context.Context, vehicleID int64, at time.Time) (signal.State, error) {
	if f.stateFn == nil {
		return signal.State{}, nil
	}
	return f.stateFn(ctx, vehicleID, at)
}

func (f *fakeStateReader) SignalAt(ctx context.Context, vehicleID int64, name string, at time.Time) (signal.SignalValue, error) {
	if f.signalAtFn == nil {
		return nil, nil
	}
	return f.signalAtFn(ctx, vehicleID, name, at)
}

func (f *fakeStateReader) Timeline(ctx context.Context, vehicleID int64, fields []signal.FieldMapping, from, to time.Time, opts signal.TimelineOptions) ([]signal.TimelineRow, error) {
	f.gotTimelineCalls++
	if f.timelineFn == nil {
		return nil, nil
	}
	return f.timelineFn(ctx, vehicleID, fields, from, to, opts)
}

var _ signal.StateReader = (*fakeStateReader)(nil)
