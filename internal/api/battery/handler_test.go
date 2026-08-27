package battery

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// signalAtCallRecord captures one StateReader.SignalAt() invocation's
// vehicleID + signal name + at so battery_handler tests can assert which
// signal names the handler queried (and at what at-anchor) without
// depending on call order across the four projections.
type signalAtCallRecord struct {
	vehicleID int64
	name      string
	at        time.Time
}

// newBatteryReportRequest builds an *http.Request with the chi route
// context wired so apiparams.URLParamInt64(r, "vehicleID") inside BatteryHandler.Report
// resolves to vehicleID. Mirrors newEnergyFlowRequest / newDriveDetailRequest.
func newBatteryReportRequest(t *testing.T, vehicleID string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/vehicles/"+vehicleID+"/battery", nil)
	routeCtx := chi.NewRouteContext()
	routeCtx.URLParams.Add("vehicleID", vehicleID)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
}

// TestBatteryHandler_SOC_UsesSignalAt verifies that the handler queries
// the EnergyRemaining signal — the SOC-derived input feeding the health
// score / capacity / degradation projection — via StateReader.SignalAt
// at time.Now(). EnergyRemaining is the bedrock of the battery health
// derivation; a future regression that anchors this lookup to a stale
// timestamp, drops the signal name, or queries a different signal (e.g.
// BatteryLevel) would freeze or misderive the health panel and is caught
// here. The test also pins all four expected signal names
// (EnergyRemaining, EstBatteryRange, ModuleTempMax, ModuleTempMin) so a
// regression that drops one of the per-signal projections is also caught.
func TestBatteryHandler_SOC_UsesSignalAt(t *testing.T) {
	vid := int64(42)
	var calls []signalAtCallRecord
	fake := &fakeStateReader{
		signalAtFn: func(_ context.Context, v int64, name string, at time.Time) (signal.SignalValue, error) {
			calls = append(calls, signalAtCallRecord{vehicleID: v, name: name, at: at})
			// ModuleTempMax must return non-nil so the handler proceeds to
			// query ModuleTempMin (the handler short-circuits the temp pair
			// when valMax is nil — preserved from the legacy behavior).
			if name == "ModuleTempMax" {
				return float64(24.0), nil
			}
			return nil, nil
		},
	}
	h := &BatteryHandler{state: fake}

	before := time.Now()
	rec := httptest.NewRecorder()
	h.Report(rec, newBatteryReportRequest(t, "42"))
	after := time.Now()

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	wantNames := map[string]bool{
		"EnergyRemaining": false,
		"EstBatteryRange": false,
		"ModuleTempMax":   false,
		"ModuleTempMin":   false,
	}
	for _, c := range calls {
		if _, ok := wantNames[c.name]; !ok {
			continue
		}
		wantNames[c.name] = true
		if c.vehicleID != vid {
			t.Fatalf("SignalAt(%q).vehicleID = %d, want %d", c.name, c.vehicleID, vid)
		}
		if c.at.Before(before.Add(-time.Second)) || c.at.After(after.Add(time.Second)) {
			t.Fatalf("SignalAt(%q).at = %v, want within [%v, %v] (≈ time.Now())", c.name, c.at, before, after)
		}
	}
	for name, sawIt := range wantNames {
		if !sawIt {
			t.Fatalf("handler never called SignalAt with name=%q; calls=%v", name, calls)
		}
	}
}

// TestBatteryHandler_AllFieldsCarryForward verifies that the handler
// derives all four projected battery fields (capacity_wh, est_range_km,
// avg_cell_temp_c, health_score) from forward-folded SignalAt reads. The
// fake returns last-known values for every signal name — emulating
// StateReader's forward-fold semantics where unchanged signals carry
// their prior emitted value rather than disappearing — and the test
// asserts every downstream projection field renders that carried-forward
// value. The legacy raw-snapshot path returned zero for any signal that
// had no fresh emission inside the window; this contract test pins the
// new behavior so a regression that re-introduces a "fresh-only" filter
// (and freezes the Battery Health panel at zero on a parked vehicle) is
// caught immediately.
func TestBatteryHandler_AllFieldsCarryForward(t *testing.T) {
	const (
		nominalCapacity = 75000.0
		energyRemaining = 60000.0 // capacity_wh; health = 60000/75000*100 = 80%
		estBatteryRange = 410.5   // est_range_km
		moduleTempMax   = 24.0
		moduleTempMin   = 20.0 // avg_cell_temp = (24+20)/2 = 22.0
		expectedHealth  = (energyRemaining / nominalCapacity) * 100
		expectedDegrad  = 100 - expectedHealth
	)
	carried := map[string]float64{
		"EnergyRemaining": energyRemaining,
		"EstBatteryRange": estBatteryRange,
		"ModuleTempMax":   moduleTempMax,
		"ModuleTempMin":   moduleTempMin,
	}
	fake := &fakeStateReader{
		signalAtFn: func(_ context.Context, _ int64, name string, _ time.Time) (signal.SignalValue, error) {
			v, ok := carried[name]
			if !ok {
				return nil, nil
			}
			return v, nil
		},
	}
	h := &BatteryHandler{state: fake}

	rec := httptest.NewRecorder()
	h.Report(rec, newBatteryReportRequest(t, "42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if got, _ := body["capacity_wh"].(float64); got != energyRemaining {
		t.Fatalf("capacity_wh = %#v, want %v (carried forward from EnergyRemaining)", body["capacity_wh"], energyRemaining)
	}
	if got, _ := body["est_range_km"].(float64); got != estBatteryRange {
		t.Fatalf("est_range_km = %#v, want %v (carried forward from EstBatteryRange)", body["est_range_km"], estBatteryRange)
	}
	if got, _ := body["health_score"].(float64); got != expectedHealth {
		t.Fatalf("health_score = %#v, want %v (derived from EnergyRemaining/%v*100)", body["health_score"], expectedHealth, nominalCapacity)
	}
	if got, _ := body["degradation_pct"].(float64); got != expectedDegrad {
		t.Fatalf("degradation_pct = %#v, want %v (100 - health_score)", body["degradation_pct"], expectedDegrad)
	}
	avg, ok := body["avg_cell_temp_c"].(float64)
	if !ok {
		t.Fatalf("avg_cell_temp_c missing or wrong type (%#v); want %v", body["avg_cell_temp_c"], (moduleTempMax+moduleTempMin)/2)
	}
	if want := (moduleTempMax + moduleTempMin) / 2; avg != want {
		t.Fatalf("avg_cell_temp_c = %v, want %v (mean of ModuleTempMax/Min)", avg, want)
	}
	if _, ok := body["generated_at"].(string); !ok {
		t.Fatalf("generated_at missing or wrong type (%#v)", body["generated_at"])
	}
	if got, _ := body["source"].(string); got != "signal_log_and_cagg_battery_daily" {
		t.Fatalf("source = %q, want signal_log_and_cagg_battery_daily", got)
	}
	partial, ok := body["partial_result"].(map[string]any)
	if !ok {
		t.Fatalf("partial_result missing or wrong type (%#v)", body["partial_result"])
	}
	if isPartial, _ := partial["is_partial"].(bool); !isPartial {
		t.Fatalf("partial_result.is_partial = %v, want true when the DB trend source is unavailable", partial["is_partial"])
	}
}

// TestBatteryHandler_PropagatesError verifies that a StateReader.SignalAt
// transport error (e.g. pgx connection drop) becomes a 500 to the client.
// The legacy *signaldb.SignalLogReader-backed handler silently swallowed
// SignalAt errors and returned a partial payload with zero-valued fields,
// which is indistinguishable on the frontend from "vehicle truly idle /
// brand-new vehicle with no signal_log history". This migration tightens
// error handling so the frontend can surface the failure rather than
// silently rendering a "battery looks dead" panel. A future regression
// that reverts to the silent-swallow behavior is caught here.
func TestBatteryHandler_PropagatesError(t *testing.T) {
	wantErr := errors.New("simulated pgx connection lost")
	fake := &fakeStateReader{
		signalAtFn: func(_ context.Context, _ int64, _ string, _ time.Time) (signal.SignalValue, error) {
			return nil, wantErr
		},
	}
	h := &BatteryHandler{state: fake}

	rec := httptest.NewRecorder()
	h.Report(rec, newBatteryReportRequest(t, "42"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

func TestBatteryHandler_RejectsOversizedTrendWindow(t *testing.T) {
	h := &BatteryHandler{state: &fakeStateReader{}}
	req := newBatteryReportRequest(t, "42")
	req.URL.RawQuery = "days=367"

	rec := httptest.NewRecorder()
	h.Report(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

// fakeStateReader is a hand-rolled signal.StateReader for battery package tests.
type fakeStateReader struct {
	stateFn    func(ctx context.Context, vehicleID int64, at time.Time) (signal.State, error)
	signalAtFn func(ctx context.Context, vehicleID int64, name string, at time.Time) (signal.SignalValue, error)
	timelineFn func(ctx context.Context, vehicleID int64, fields []signal.FieldMapping, from, to time.Time, opts signal.TimelineOptions) ([]signal.TimelineRow, error)
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
	if f.timelineFn == nil {
		return nil, nil
	}
	return f.timelineFn(ctx, vehicleID, fields, from, to, opts)
}

var _ signal.StateReader = (*fakeStateReader)(nil)
