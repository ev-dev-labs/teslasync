package charging

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apibulk"
	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/go-chi/chi/v5"
)

// fakeChargingByIDFetcher is the in-memory charging session lookup used by
// charging_handler tests so the migrated handlers can be exercised end-to-end
// without a real *chargingdb.ChargingRepo / pgx pool.
type fakeChargingByIDFetcher struct {
	session *chargingmodel.ChargingSession
	err     error
	calls   int
}

func (f *fakeChargingByIDFetcher) GetByID(_ context.Context, _ int64) (*chargingmodel.ChargingSession, error) {
	f.calls++
	return f.session, f.err
}

type stateCallRecord struct {
	vehicleID int64
	at        time.Time
}

type fakeStateReader struct {
	stateFn    func(ctx context.Context, vehicleID int64, at time.Time) (signal.State, error)
	signalAtFn func(ctx context.Context, vehicleID int64, name string, at time.Time) (signal.SignalValue, error)
	timelineFn func(ctx context.Context, vehicleID int64, fields []signal.FieldMapping, from, to time.Time, opts signal.TimelineOptions) ([]signal.TimelineRow, error)

	gotTimelineOpts   signal.TimelineOptions
	gotTimelineFields []signal.FieldMapping
	gotTimelineCalls  int
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
	f.gotTimelineOpts = opts
	f.gotTimelineFields = fields
	if f.timelineFn == nil {
		return nil, nil
	}
	return f.timelineFn(ctx, vehicleID, fields, from, to, opts)
}

var _ signal.StateReader = (*fakeStateReader)(nil)

func newTestLiveStateReader(state signal.StateReader) signal.LiveStateReader {
	return signal.MustNewLiveStateReader(signal.NewNoopLiveSignalStore(), state)
}

// newChargingRequest builds an *http.Request with the chi route context wired
// so urlParamInt64(r, "sessionID") inside the handler resolves to sessionID.
func newChargingRequest(t *testing.T, sessionID, target string) *http.Request {
	t.Helper()
	if target == "" {
		target = "/charging/" + sessionID
	}
	req := httptest.NewRequest(http.MethodGet, target, nil)
	routeCtx := chi.NewRouteContext()
	routeCtx.URLParams.Add("sessionID", sessionID)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
}

// completedChargingSession is a minimal fixture for tests that exercise the
// completed-session path (EndedAt != nil → enrichLiveCharge is NOT invoked).
func completedChargingSession(sessionID, vehicleID int64, start, end time.Time) *chargingmodel.ChargingSession {
	endCopy := end
	return &chargingmodel.ChargingSession{
		ID:        sessionID,
		VehicleID: vehicleID,
		StartedAt: start,
		EndedAt:   &endCopy,
	}
}

// inProgressChargingSession is a minimal fixture for tests that exercise the
// in-progress path (EndedAt == nil → enrichLiveCharge IS invoked).
func inProgressChargingSession(sessionID, vehicleID int64, start time.Time) *chargingmodel.ChargingSession {
	return &chargingmodel.ChargingSession{
		ID:        sessionID,
		VehicleID: vehicleID,
		StartedAt: start,
		EndedAt:   nil,
	}
}

// TestChargingHandler_SessionDetails_UsesStartSnapshot verifies that
// enrichLiveCharge resolves the start-of-session baseline by calling
// StateReader.State with session.StartTs (NOT time.Now() and NOT a recent
// rolling window). Battery and energy-added deltas depend on this baseline
// being anchored to the actual session start.
func TestChargingHandler_SessionDetails_UsesStartSnapshot(t *testing.T) {
	startTs := time.Date(2026, 4, 30, 9, 30, 15, 0, time.UTC)
	session := inProgressChargingSession(11, 42, startTs)
	var calls []stateCallRecord
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, vid int64, at time.Time) (signal.State, error) {
			calls = append(calls, stateCallRecord{vid, at})
			return signal.State{}, nil
		},
	}
	charging := &fakeChargingByIDFetcher{session: session}
	h := &ChargingHandler{state: fake, live: newTestLiveStateReader(fake), charging: charging}

	rec := httptest.NewRecorder()
	h.Get(rec, newChargingRequest(t, "11", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if len(calls) < 1 {
		t.Fatalf("State call count = %d, want at least 1 (start snapshot)", len(calls))
	}
	if calls[0].vehicleID != session.VehicleID {
		t.Fatalf("State[0].vehicleID = %d, want %d", calls[0].vehicleID, session.VehicleID)
	}
	if !calls[0].at.Equal(startTs) {
		t.Fatalf("State[0].at = %v, want %v (session.StartTs)", calls[0].at, startTs)
	}
}

// TestChargingHandler_Latest_UsesNowSnapshot verifies that currentSignals
// falls back to StateReader.State(time.Now().UTC()) when no Redis cache is
// configured. The "now" anchor matters because in-progress charge metrics
// (current battery, current power, energy-added delta endpoint) all derive
// from this snapshot.
func TestChargingHandler_Latest_UsesNowSnapshot(t *testing.T) {
	startTs := time.Date(2026, 4, 30, 9, 30, 0, 0, time.UTC)
	session := inProgressChargingSession(11, 42, startTs)
	var calls []stateCallRecord
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, vid int64, at time.Time) (signal.State, error) {
			calls = append(calls, stateCallRecord{vid, at})
			return signal.State{}, nil
		},
	}
	charging := &fakeChargingByIDFetcher{session: session}
	h := &ChargingHandler{state: fake, live: newTestLiveStateReader(fake), charging: charging}

	before := time.Now().UTC()
	rec := httptest.NewRecorder()
	h.Get(rec, newChargingRequest(t, "11", ""))
	after := time.Now().UTC()

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	// enrichLiveCharge issues two State() calls: [0] start snapshot, [1] current.
	if len(calls) < 2 {
		t.Fatalf("State call count = %d, want at least 2 (start + current)", len(calls))
	}
	cur := calls[1]
	if cur.vehicleID != session.VehicleID {
		t.Fatalf("State[1].vehicleID = %d, want %d", cur.vehicleID, session.VehicleID)
	}
	// Allow a 1-second tolerance window around the wall-clock observation.
	if cur.at.Before(before.Add(-time.Second)) || cur.at.After(after.Add(time.Second)) {
		t.Fatalf("State[1].at = %v, want within [%v, %v] (≈ time.Now())", cur.at, before, after)
	}
}

func TestChargingHandler_LiveDCSessionUsesCanonicalWhAndW(t *testing.T) {
	startTs := time.Date(2026, 8, 9, 9, 30, 0, 0, time.UTC)
	session := inProgressChargingSession(11, 42, startTs)
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, _ int64, at time.Time) (signal.State, error) {
			if at.Equal(startTs) {
				return signal.State{
					"DCChargingEnergyIn": 100000.0,
					"BatteryLevel":       40.0,
				}, nil
			}
			return signal.State{
				"DCChargingEnergyIn": 112000.0,
				"DCChargingPower":    150000.0,
				"ACChargingPower":    7200.0,
				"BatteryLevel":       55.0,
			}, nil
		},
	}
	charging := &fakeChargingByIDFetcher{session: session}
	h := &ChargingHandler{state: fake, live: newTestLiveStateReader(fake), charging: charging}

	rec := httptest.NewRecorder()
	h.Get(rec, newChargingRequest(t, "11", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var got chargingmodel.ChargingSession
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.TotalEnergyAddedWh == nil || *got.TotalEnergyAddedWh != 12000 {
		t.Fatalf("total_energy_added_wh = %v, want 12000", got.TotalEnergyAddedWh)
	}
	if got.PeakPowerW == nil || *got.PeakPowerW != 150000 {
		t.Fatalf("peak_power_w = %v, want 150000", got.PeakPowerW)
	}
}

// TestChargingHandler_Telemetry_ChartMode locks in the chart-mode contract:
// TelemetryReadings MUST call Timeline with an empty CollapseBy slice so
// every change-feed emission becomes one row (forward-folded values appear
// at every later timestamp). A non-empty CollapseBy would drop rows with
// "still 50 kW, still 65%" tuples and break stepped-line chart rendering on
// the frontend's charging-session detail page.
func TestChargingHandler_Telemetry_ChartMode(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 10, 0, 0, 0, time.UTC)
	t1 := t0.Add(15 * time.Minute)
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return nil, nil
		},
	}
	charging := &fakeChargingByIDFetcher{session: completedChargingSession(7, 42, t0, t1)}
	h := &ChargingHandler{state: fake, live: newTestLiveStateReader(fake), charging: charging}

	rec := httptest.NewRecorder()
	h.TelemetryReadings(rec, newChargingRequest(t, "7", "/charging/7/telemetry"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if len(fake.gotTimelineOpts.CollapseBy) != 0 {
		t.Fatalf("Timeline opts.CollapseBy = %v, want empty (chart mode)", fake.gotTimelineOpts.CollapseBy)
	}
	if fake.gotTimelineCalls != 1 {
		t.Fatalf("Timeline call count = %d, want 1", fake.gotTimelineCalls)
	}
	// The mappings passed in must be the canonical charge telemetry set so
	// the frontend wire shape (battery_level, voltage, power_kw, ...) is
	// preserved.
	if len(fake.gotTimelineFields) != len(chargeTelemetryFieldMappings) {
		t.Fatalf("Timeline fields count = %d, want %d", len(fake.gotTimelineFields), len(chargeTelemetryFieldMappings))
	}
}

func TestChargingHandler_Telemetry_ConvertsCanonicalSIToLegacyChartUnits(t *testing.T) {
	t0 := time.Date(2026, 8, 9, 10, 0, 0, 0, time.UTC)
	t1 := t0.Add(15 * time.Minute)
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return []signal.TimelineRow{{
				Timestamp: t0,
				Fields: map[string]signal.SignalValue{
					"power_kw":      7200.0,
					"dc_power_w":    0.0,
					"energy_added":  15089.164733886719,
					"battery_level": 65.0,
				},
			}}, nil
		},
	}
	charging := &fakeChargingByIDFetcher{session: completedChargingSession(7, 42, t0, t1)}
	h := &ChargingHandler{state: fake, live: newTestLiveStateReader(fake), charging: charging}

	rec := httptest.NewRecorder()
	h.TelemetryReadings(rec, newChargingRequest(t, "7", "/charging/7/telemetry"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var rows []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &rows); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("row count = %d, want 1", len(rows))
	}
	if got := rows[0]["power_kw"]; got != 7.2 {
		t.Fatalf("power_kw = %v, want 7.2", got)
	}
	if got := rows[0]["energy_added"]; got != 15.089164733886718 {
		t.Fatalf("energy_added = %v, want 15.089164733886718", got)
	}
}

// TestChargingHandler_Telemetry_PropagatesError verifies that a Timeline
// transport error (e.g. pgx connection drop) becomes a 500 to the client.
// The legacy handler also returned 500 here; this test locks the contract
// in for the migrated implementation so a future regression that swallows
// the error is caught.
func TestChargingHandler_Telemetry_PropagatesError(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 10, 0, 0, 0, time.UTC)
	t1 := t0.Add(15 * time.Minute)
	wantErr := errors.New("simulated pgx connection lost")
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return nil, wantErr
		},
	}
	charging := &fakeChargingByIDFetcher{session: completedChargingSession(7, 42, t0, t1)}
	h := &ChargingHandler{state: fake, live: newTestLiveStateReader(fake), charging: charging}

	rec := httptest.NewRecorder()
	h.TelemetryReadings(rec, newChargingRequest(t, "7", "/charging/7/telemetry"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

// TestChargingHandler_Latest_PropagatesError verifies that a State transport
// error on the CURRENT (now) snapshot lookup becomes a 500 for an
// in-progress session. The start snapshot succeeds, isolating the error to
// the latest-snapshot path; the legacy handler degraded to an empty current
// snapshot (silently zeroing battery/power), but the migrated handler
// surfaces the failure so the frontend can show an error state instead of
// rendering wrong live numbers.
func TestChargingHandler_Latest_PropagatesError(t *testing.T) {
	startTs := time.Date(2026, 4, 30, 9, 30, 0, 0, time.UTC)
	wantErr := errors.New("simulated pgx connection lost on current snapshot")
	var stateCalls int
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, _ int64, at time.Time) (signal.State, error) {
			stateCalls++
			if at.Equal(startTs) {
				return signal.State{}, nil
			}
			return nil, wantErr
		},
	}
	charging := &fakeChargingByIDFetcher{session: inProgressChargingSession(7, 42, startTs)}
	h := &ChargingHandler{state: fake, live: newTestLiveStateReader(fake), charging: charging}

	rec := httptest.NewRecorder()
	h.Get(rec, newChargingRequest(t, "7", ""))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
	if stateCalls < 2 {
		t.Fatalf("State call count = %d, want >= 2 (start succeeds, current fails)", stateCalls)
	}
}

// fakeChargingBulkStore mirrors the root package drive bulk store for charging handler tests.
type fakeChargingBulkStore struct {
	existing       map[int64]bool
	deleteErr      error
	bulkDeleteArgs [][]int64
}

func (f *fakeChargingBulkStore) FilterExistingIDs(_ context.Context, ids []int64) ([]int64, error) {
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if f.existing[id] {
			out = append(out, id)
		}
	}
	return out, nil
}

func (f *fakeChargingBulkStore) BulkDelete(_ context.Context, ids []int64) (int64, error) {
	cp := append([]int64(nil), ids...)
	f.bulkDeleteArgs = append(f.bulkDeleteArgs, cp)
	if f.deleteErr != nil {
		return 0, f.deleteErr
	}
	return int64(len(ids)), nil
}

func newBulkRequest(t *testing.T, method, path string, body any) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if s, ok := body.(string); ok {
			buf.WriteString(s)
		} else if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode body: %v", err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	return req
}

func decodeBulkResult(t *testing.T, body []byte) apibulk.OperationResult {
	t.Helper()
	var got apibulk.OperationResult
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("unmarshal response: %v; body=%s", err, string(body))
	}
	return got
}

func TestChargingBulkDelete_HappyPath(t *testing.T) {
	store := &fakeChargingBulkStore{existing: map[int64]bool{10: true, 20: true, 30: true}}
	h := &ChargingHandler{bulkOverride: store}

	rec := httptest.NewRecorder()
	h.BulkDelete(rec, newBulkRequest(t, http.MethodDelete, "/charging/bulk", map[string]any{"ids": []int64{10, 20, 30}}))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	got := decodeBulkResult(t, rec.Body.Bytes())
	if got.Deleted == nil || *got.Deleted != 3 {
		t.Fatalf("Deleted = %v, want 3", got.Deleted)
	}
	if len(got.Failed) != 0 {
		t.Fatalf("Failed = %d, want 0 when all ids exist", len(got.Failed))
	}
}

func TestChargingBulkDelete_AllMissing_ReturnsZeroDeleted(t *testing.T) {
	store := &fakeChargingBulkStore{existing: map[int64]bool{}}
	h := &ChargingHandler{bulkOverride: store}

	rec := httptest.NewRecorder()
	h.BulkDelete(rec, newBulkRequest(t, http.MethodDelete, "/charging/bulk", map[string]any{"ids": []int64{1, 2}}))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (partial failure is not an error); body=%s", rec.Code, rec.Body.String())
	}
	got := decodeBulkResult(t, rec.Body.Bytes())
	if got.Deleted == nil || *got.Deleted != 0 {
		t.Fatalf("Deleted = %v, want 0", got.Deleted)
	}
	if len(got.Failed) != 2 {
		t.Fatalf("Failed = %d, want 2", len(got.Failed))
	}
	if len(store.bulkDeleteArgs) != 1 || len(store.bulkDeleteArgs[0]) != 0 {
		t.Fatalf("BulkDelete must be invoked with empty slice when no ids exist; got %#v", store.bulkDeleteArgs)
	}
}
