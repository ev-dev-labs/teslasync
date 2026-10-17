package energyflow

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

type stateCallRecord struct {
	vehicleID int64
	at        time.Time
}

type fakeStateReader struct {
	stateFn func(ctx context.Context, vehicleID int64, at time.Time) (signal.State, error)
}

func (f *fakeStateReader) State(ctx context.Context, vehicleID int64, at time.Time) (signal.State, error) {
	if f.stateFn == nil {
		return signal.State{}, nil
	}
	return f.stateFn(ctx, vehicleID, at)
}

func (f *fakeStateReader) SignalAt(context.Context, int64, string, time.Time) (signal.SignalValue, error) {
	return nil, nil
}

func (f *fakeStateReader) Timeline(context.Context, int64, []signal.FieldMapping, time.Time, time.Time, signal.TimelineOptions) ([]signal.TimelineRow, error) {
	return nil, nil
}

var _ signal.StateReader = (*fakeStateReader)(nil)

func newTestLiveStateReader(state signal.StateReader) signal.LiveStateReader {
	return signal.MustNewLiveStateReader(signal.NewNoopLiveSignalStore(), state)
}

// newEnergyFlowRequest builds an *http.Request with the chi route context
// wired so apiparams.URLParamInt64(r, "vehicleID") inside the handler resolves to
// vehicleID. Mirrors newChargingRequest / newDriveDetailRequest.
func newEnergyFlowRequest(t *testing.T, vehicleID string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/vehicles/"+vehicleID+"/energy/flow", nil)
	routeCtx := chi.NewRouteContext()
	routeCtx.URLParams.Add("vehicleID", vehicleID)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
}

// TestEnergyFlow_Latest_UsesNow verifies that the /vehicles/{id}/energy/flow
// endpoint resolves the per-vehicle energy snapshot via StateReader.State
// at time.Now() (NOT a fixed archive timestamp, NOT the period start of a
// rolling window). The endpoint is a "current values" view — every render
// must reflect the latest forward-folded state — so a future regression
// that anchors this lookup to a stale timestamp would freeze the energy
// flow panel and is caught here. The test also pins the projection of all
// seven fields onto their JSON output keys (dc_charging_power_w,
// ac_charging_power_w, energy_remaining, pack_voltage, pack_current, soc,
// charge_state) so the frontend wire-shape contract is locked in.
func TestEnergyFlow_Latest_UsesNow(t *testing.T) {
	vid := int64(42)
	var calls []stateCallRecord
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, v int64, at time.Time) (signal.State, error) {
			calls = append(calls, stateCallRecord{vehicleID: v, at: at})
			return signal.State{
				"DCChargingPower": 48500.0,
				"ACChargingPower": 7200.0,
				"EnergyRemaining": 62.3,
				"PackVoltage":     396.8,
				"PackCurrent":     -120.4,
				"BatteryLevel":    78.0,
				"ChargeState":     "Charging",
			}, nil
		},
	}
	h := &EnergyFlowHandler{state: fake, live: newTestLiveStateReader(fake)}

	before := time.Now()
	rec := httptest.NewRecorder()
	h.Get(rec, newEnergyFlowRequest(t, "42"))
	after := time.Now()

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if len(calls) != 1 {
		t.Fatalf("State call count = %d, want 1", len(calls))
	}
	if calls[0].vehicleID != vid {
		t.Fatalf("State.vehicleID = %d, want %d", calls[0].vehicleID, vid)
	}
	if calls[0].at.Before(before.Add(-time.Second)) || calls[0].at.After(after.Add(time.Second)) {
		t.Fatalf("State.at = %v, want within [%v, %v] (≈ time.Now())", calls[0].at, before, after)
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	wantKeys := []string{
		"dc_charging_power_w",
		"ac_charging_power_w",
		"energy_remaining",
		"pack_voltage",
		"pack_current",
		"soc",
		"charge_state",
	}
	for _, k := range wantKeys {
		if _, ok := body[k]; !ok {
			t.Fatalf("response missing key %q; body=%v", k, body)
		}
		if body[k] == nil {
			t.Fatalf("response[%q] = nil, want value projected from State", k)
		}
	}
	if body["charge_state"] != "Charging" {
		t.Fatalf("charge_state = %#v, want \"Charging\"", body["charge_state"])
	}
	if body["dc_charging_power_w"] != 48500.0 || body["ac_charging_power_w"] != 7200.0 {
		t.Fatalf("charging power = (%v, %v), want (48500, 7200) W",
			body["dc_charging_power_w"], body["ac_charging_power_w"])
	}
	if body["energy_remaining"] != 62.3 {
		t.Fatalf("energy_remaining = %v, want unchanged raw reading 62.3", body["energy_remaining"])
	}
	if len(body) != len(wantKeys) {
		t.Fatalf("response must not contain compatibility aliases: %v", body)
	}
}

// TestEnergyFlow_PropagatesError verifies that a StateReader.State
// transport error (e.g. pgx connection drop) becomes a 500 to the client.
// The legacy SnapshotAt-based handler swallowed errors and returned an
// all-null payload; this migration tightens error handling so the
// frontend can surface the failure rather than silently rendering an
// empty energy-flow panel that callers cannot distinguish from "vehicle
// truly idle". A future regression that reverts to the silent-null
// behaviour is caught here.
func TestEnergyFlow_PropagatesError(t *testing.T) {
	wantErr := errors.New("simulated pgx connection lost")
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, _ int64, _ time.Time) (signal.State, error) {
			return nil, wantErr
		},
	}

	h := &EnergyFlowHandler{state: fake, live: newTestLiveStateReader(fake)}

	rec := httptest.NewRecorder()
	h.Get(rec, newEnergyFlowRequest(t, "42"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

func TestEnergyFlow_PreservesStoredReadings(t *testing.T) {
	for _, tc := range []struct {
		name string
		snap signal.State
		dc   any
		ac   any
	}{
		{"numeric codec values", signal.State{"DCChargingPower": float32(48500), "ACChargingPower": int32(7200), "EnergyRemaining": 62.3}, 48500.0, 7200.0},
		{"measured zero", signal.State{"DCChargingPower": 0.0, "ACChargingPower": 0.0}, 0.0, 0.0},
		{"missing channel", signal.State{"ACChargingPower": 7200.0}, nil, 7200.0},
		{"no telemetry", signal.State{}, nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fake := &fakeStateReader{stateFn: func(context.Context, int64, time.Time) (signal.State, error) {
				return tc.snap, nil
			}}
			h := NewEnergyFlowHandler(nil, fake, newTestLiveStateReader(fake))
			rec := httptest.NewRecorder()
			h.Get(rec, newEnergyFlowRequest(t, "42"))
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d; body=%s", rec.Code, rec.Body.String())
			}
			var body map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body["dc_charging_power_w"] != tc.dc || body["ac_charging_power_w"] != tc.ac {
				t.Fatalf("power = (%v, %v), want (%v, %v)", body["dc_charging_power_w"], body["ac_charging_power_w"], tc.dc, tc.ac)
			}
			if body["energy_remaining"] != tc.snap["EnergyRemaining"] {
				t.Fatalf("raw energy changed: %v", body["energy_remaining"])
			}
			for _, old := range []string{"dc_charging_power", "ac_charging_power", "energy_remaining_wh"} {
				if _, ok := body[old]; ok {
					t.Fatalf("unexpected inferred unit or compatibility key %q", old)
				}
			}
		})
	}
}
