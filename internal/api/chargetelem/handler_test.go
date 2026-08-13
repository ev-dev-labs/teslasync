package chargetelem

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// newChargingTelemetryRequest builds an *http.Request for the
// /charging-telemetry handlers with vehicle_id pre-encoded.
func newChargingTelemetryRequest(vehicleID string, target string) *http.Request {
	if target == "" {
		target = "/charging-telemetry?vehicle_id=" + vehicleID
	}
	return httptest.NewRequest(http.MethodGet, target, nil)
}

// TestChargingTelemetry_Chart_NoCollapse locks in the chart-mode contract:
// List MUST call Timeline with an empty CollapseBy slice so every
// change-feed emission becomes one row. The frontend stepped-line chart on
// the charging-detail page depends on consecutive emissions surviving even
// when their projected fields are identical to the previous row — collapsing
// would drop "still 200V, still 65%" tuples and break the time-series
// rendering. Also asserts the canonical mapping set is forwarded so the wire
// shape (charger_voltage, charger_power_w, ...) stays stable.
func TestChargingTelemetry_Chart_NoCollapse(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 10, 0, 0, 0, time.UTC)
	rows := []signal.TimelineRow{
		{Timestamp: t0, Fields: map[string]signal.SignalValue{
			"charger_voltage":           240.0,
			"charger_actual_current":    32.0,
			"charger_power_w":           7700.0,
			"dc_charger_power_w":        150000.0,
			"charge_energy_added_wh":    10000.0,
			"dc_charge_energy_added_wh": 12000.0,
			"battery_level":             55.0,
		}},
		{Timestamp: t0.Add(30 * time.Second), Fields: map[string]signal.SignalValue{
			"charger_voltage":        240.0,
			"charger_actual_current": 32.0,
			"charger_power_w":        7700.0,
			"battery_level":          55.0,
		}},
		{Timestamp: t0.Add(60 * time.Second), Fields: map[string]signal.SignalValue{
			"charger_voltage":        240.0,
			"charger_actual_current": 32.0,
			"charger_power_w":        7700.0,
			"battery_level":          56.0,
		}},
	}
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return rows, nil
		},
	}
	h := NewChargingTelemetryHandler(fake, newTestLiveStateReader(fake))

	rec := httptest.NewRecorder()
	h.List(rec, newChargingTelemetryRequest("42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if fake.gotTimelineCalls != 1 {
		t.Fatalf("Timeline call count = %d, want 1", fake.gotTimelineCalls)
	}
	if len(fake.gotTimelineOpts.CollapseBy) != 0 {
		t.Fatalf("Timeline opts.CollapseBy = %v, want empty (chart mode)", fake.gotTimelineOpts.CollapseBy)
	}
	if len(fake.gotTimelineFields) != len(chargingTelemetryMappings) {
		t.Fatalf("Timeline fields count = %d, want %d", len(fake.gotTimelineFields), len(chargingTelemetryMappings))
	}

	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if len(got) != len(rows) {
		t.Fatalf("returned row count = %d, want %d (chart mode keeps every emission, even identity duplicates)", len(got), len(rows))
	}
	for i, row := range got {
		if _, ok := row["ts"]; !ok {
			t.Fatalf("row[%d] missing ts key; got %v", i, row)
		}
	}
	if got[0]["charger_power_w"] != 150000.0 || got[0]["charge_energy_added_wh"] != 12000.0 {
		t.Fatalf("DC values were not merged into canonical fields: %v", got[0])
	}
	if _, ok := got[0]["dc_charger_power_w"]; ok {
		t.Fatalf("temporary DC power field leaked into response: %v", got[0])
	}
	if _, ok := got[0]["dc_charge_energy_added_wh"]; ok {
		t.Fatalf("temporary DC energy field leaked into response: %v", got[0])
	}
}

// TestChargingTelemetry_Latest_UsesNow verifies that Latest derives the
// current charging snapshot from StateReader.State(time.Now()) — not from a
// rolling-window or session-anchored timestamp. Latest projects each mapped
// signal under its JSON field name; the special DCChargingPower override
// stays in this handler (DC fast-charge sessions report DCChargingPower
// instead of ACChargingPower, and the frontend exposes a single
// charger_power_w field).
func TestChargingTelemetry_Latest_UsesNow(t *testing.T) {
	var gotAt time.Time
	var gotVehicleID int64
	var stateCalls int
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, vid int64, at time.Time) (signal.State, error) {
			stateCalls++
			gotAt = at
			gotVehicleID = vid
			return signal.State{
				"ChargerVoltage":       240.0,
				"ChargerActualCurrent": 32.0,
				"ACChargingPower":      7700.0,
				"DCChargingPower":      150000.0, // active DC charge — must override AC
				"ACChargingEnergyIn":   10000.0,
				"DCChargingEnergyIn":   12000.0,
				"BatteryLevel":         65.0,
				"ChargeState":          "Charging",
				"IdealBatteryRange":    250.0,
			}, nil
		},
	}
	h := NewChargingTelemetryHandler(fake, newTestLiveStateReader(fake))

	before := time.Now()
	rec := httptest.NewRecorder()
	h.Latest(rec, newChargingTelemetryRequest("42", "/charging-telemetry/latest?vehicle_id=42"))
	after := time.Now()

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if stateCalls != 1 {
		t.Fatalf("State call count = %d, want 1", stateCalls)
	}
	if gotVehicleID != 42 {
		t.Fatalf("State.vehicleID = %d, want 42", gotVehicleID)
	}
	if gotAt.Before(before.Add(-time.Second)) || gotAt.After(after.Add(time.Second)) {
		t.Fatalf("State.at = %v, want within [%v, %v] (≈ time.Now())", gotAt, before, after)
	}

	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if v, ok := got["charger_voltage"].(float64); !ok || v != 240.0 {
		t.Fatalf("charger_voltage = %v (%T), want 240", got["charger_voltage"], got["charger_voltage"])
	}
	if v, ok := got["charging_state"].(string); !ok || v != "Charging" {
		t.Fatalf("charging_state = %v, want Charging", got["charging_state"])
	}
	// DCChargingPower=150000 W must override AC power under the SI key.
	if v, ok := got["charger_power_w"].(float64); !ok || v != 150000.0 {
		t.Fatalf("charger_power_w = %v, want 150000 (DC override active)", got["charger_power_w"])
	}
	if v, ok := got["charge_energy_added_wh"].(float64); !ok || v != 12000.0 {
		t.Fatalf("charge_energy_added_wh = %v, want 12000 (DC override active)", got["charge_energy_added_wh"])
	}
}

// TestChargingTelemetry_PropagatesError verifies that a Timeline transport
// error (e.g. pgx connection drop) becomes a 500 to the client. The legacy
// handler also returned 500 here; this test locks the contract in for the
// migrated implementation so a future regression that swallows the error or
// returns an empty list is caught.
func TestChargingTelemetry_PropagatesError(t *testing.T) {
	wantErr := errors.New("simulated pgx connection lost")
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return nil, wantErr
		},
	}
	h := NewChargingTelemetryHandler(fake, newTestLiveStateReader(fake))

	rec := httptest.NewRecorder()
	h.List(rec, newChargingTelemetryRequest("42", ""))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

// fakeStateReader is duplicated from internal/api media handler tests while
// Phase R2 carves handler subpackages away from parent-package test fixtures.
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
