package userpref

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

// newUserPreferenceRequest builds an *http.Request for the
// /user-preference handlers with vehicle_id pre-encoded.
func newUserPreferenceRequest(vehicleID, target string) *http.Request {
	if target == "" {
		target = "/user-preference?vehicle_id=" + vehicleID
	}
	return httptest.NewRequest(http.MethodGet, target, nil)
}

// TestUserPreference_History_CarriesForwardUnits is the carry-forward
// proof for the phase-39 user_preference_handler migration's List
// endpoint.
//
// User preferences are USER-PINNED settings (24-hour clock, charge /
// distance / temperature / tire-pressure unit selections). Tesla Fleet
// Telemetry only emits a value when both the interval has elapsed AND
// the value has changed — so once the owner picks "miles" + "°F" +
// "psi" + "kWh" + "12-hour clock" at delivery, those signals do NOT
// re-emit until the owner changes one in the UI. They can sit
// unchanged for MONTHS or YEARS.
//
// Under the legacy raw-pivot SignalTracePivotFlat, a /user-preference
// history call against such a vehicle would project NULL for every
// unit field on every row in the lookback window, even though the
// values are perfectly known. With StateReader.Timeline forward-folding
// the change feed, the most recent emission of every signal carries
// forward to every later row.
//
// This test asserts:
//
//  1. The handler invokes Timeline exactly once with the full
//     userPrefMappings projection.
//  2. The handler asks for CHART MODE (empty CollapseBy) so every
//     change-feed emission becomes one row. A non-empty CollapseBy
//     would coalesce consecutive identical-preference rows into a
//     single "still the same" row and break the per-emission resolution
//     of the preference-history view.
//  3. The handler does NOT strip, drop, or filter rows that carry
//     forward-folded values — every TimelineRow becomes one response
//     row with the legacy created_at / id aliases preserved.
//  4. Forward-folded unit values appear on every row even when they
//     did not re-emit in that bucket — a vehicle whose owner has not
//     touched their settings in months still produces a fully-populated
//     history, never NULL units. Silently flipping units to defaults
//     in a chart row would silently mislead the owner about their own
//     past preferences.
func TestUserPreference_History_CarriesForwardUnits(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 9, 0, 0, 0, time.UTC)
	folded := []signal.TimelineRow{
		{Timestamp: t0, Fields: map[string]signal.SignalValue{
			"setting_24hr_time":          true,
			"setting_charge_unit":        "kWh",
			"setting_distance_unit":      "Miles",
			"setting_temperature_unit":   "Fahrenheit",
			"setting_tire_pressure_unit": "Psi",
		}},
		{Timestamp: t0.Add(60 * time.Second), Fields: map[string]signal.SignalValue{
			"setting_24hr_time":          true,
			"setting_charge_unit":        "kWh",
			"setting_distance_unit":      "Miles",
			"setting_temperature_unit":   "Fahrenheit",
			"setting_tire_pressure_unit": "Psi",
		}},
		{Timestamp: t0.Add(120 * time.Second), Fields: map[string]signal.SignalValue{
			"setting_24hr_time":          true,
			"setting_charge_unit":        "kWh",
			"setting_distance_unit":      "Miles",
			"setting_temperature_unit":   "Fahrenheit",
			"setting_tire_pressure_unit": "Psi",
		}},
	}
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return folded, nil
		},
	}
	h := NewUserPreferenceHandler(fake, newTestLiveStateReader(fake))

	rec := httptest.NewRecorder()
	h.List(rec, newUserPreferenceRequest("42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if fake.gotTimelineCalls != 1 {
		t.Fatalf("Timeline call count = %d, want 1", fake.gotTimelineCalls)
	}
	// Chart mode contract: empty CollapseBy so every emission becomes
	// one row. A non-empty CollapseBy would collapse identical
	// "still the same units" runs into a single row and break the
	// preference-history view's per-emission resolution.
	if len(fake.gotTimelineOpts.CollapseBy) != 0 {
		t.Fatalf("Timeline opts.CollapseBy = %v, want empty (chart mode)", fake.gotTimelineOpts.CollapseBy)
	}
	if len(fake.gotTimelineFields) != len(userPrefMappings) {
		t.Fatalf("Timeline fields count = %d, want %d", len(fake.gotTimelineFields), len(userPrefMappings))
	}

	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if len(got) != len(folded) {
		t.Fatalf("response row count = %d, want %d (forward-folded rows must NOT be dropped)", len(got), len(folded))
	}
	for i, row := range got {
		// Every row must carry the forward-folded unit values; under
		// the old raw-pivot impl, only the row with a fresh emission
		// would have these populated, leaving the rest as NULL — which
		// would silently mislead the owner about their own history.
		du, ok := row["setting_distance_unit"].(string)
		if !ok || du != "Miles" {
			t.Fatalf("row[%d].setting_distance_unit = %#v, want \"Miles\" (forward-folded carry-forward)", i, row["setting_distance_unit"])
		}
		tu, ok := row["setting_temperature_unit"].(string)
		if !ok || tu != "Fahrenheit" {
			t.Fatalf("row[%d].setting_temperature_unit = %#v, want \"Fahrenheit\" (forward-folded carry-forward)", i, row["setting_temperature_unit"])
		}
		pu, ok := row["setting_tire_pressure_unit"].(string)
		if !ok || pu != "Psi" {
			t.Fatalf("row[%d].setting_tire_pressure_unit = %#v, want \"Psi\" (forward-folded carry-forward)", i, row["setting_tire_pressure_unit"])
		}
		cu, ok := row["setting_charge_unit"].(string)
		if !ok || cu != "kWh" {
			t.Fatalf("row[%d].setting_charge_unit = %#v, want \"kWh\" (forward-folded carry-forward)", i, row["setting_charge_unit"])
		}
		hr, ok := row["setting_24hr_time"].(bool)
		if !ok || hr != true {
			t.Fatalf("row[%d].setting_24hr_time = %#v, want true (forward-folded carry-forward)", i, row["setting_24hr_time"])
		}
		// Legacy field-name aliases must be present so the existing
		// frontend consuming created_at / id keeps working.
		if _, ok := row["created_at"]; !ok {
			t.Fatalf("row[%d] missing created_at alias; row=%v", i, row)
		}
		idVal, ok := row["id"].(float64)
		if !ok || int(idVal) != i+1 {
			t.Fatalf("row[%d].id = %#v, want %d", i, row["id"], i+1)
		}
	}
}

// TestUserPreference_Latest_UsesNow is the carry-forward proof for the
// user-preference Latest endpoint and the wire-up proof that Latest
// anchors on time.Now() rather than a rolling lookback window.
//
// The legacy SnapshotAt against a vehicle whose owner had not toggled
// any unit setting within the lookback window would project NULL for
// every unit field, silently flipping the dashboard to default units
// (km / °C / bar / 24-hour) on a metric-units owner whose actual
// current preferences are imperial. With StateReader.State forward-
// folding the change feed, the most recent emission of every signal
// is carried forward to time.Now().
//
// This test:
//
//  1. Confirms Latest invokes State at ≈ time.Now() (NOT a rolling
//     window or session-anchored timestamp), with the supplied
//     vehicle_id. A rolling-window anchor would re-introduce the very
//     "no preferences" bug this migration fixes.
//  2. Simulates a State response that contains stable unit selections
//     forward-folded from an emission at delivery (months / years
//     ago) plus an absent SettingTirePressureUnit (the owner never
//     touched the tire-pressure-unit picker).
//  3. Asserts the response contains every projected field whose Signal
//     IS present in State, under its mapped JSON name — never blanks
//     them just because no recent emission exists.
//  4. Confirms that signals NOT present in State are OMITTED from the
//     response (rather than projected as null) — the legacy contract
//     was "return only the keys we know", and the frontend treats
//     missing keys as "use the previously-known value".
//  5. Confirms that raw signal names (the Signal side of
//     userPrefMappings) do NOT leak into the response — only the
//     projected Field names appear.
func TestUserPreference_Latest_UsesNow(t *testing.T) {
	var gotAt time.Time
	var gotVehicleID int64
	var stateCalls int
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, vid int64, at time.Time) (signal.State, error) {
			stateCalls++
			gotAt = at
			gotVehicleID = vid
			return signal.State{
				// Stable user-pinned unit selections forward-folded
				// from an emission months / years ago — the canonical
				// reason this migration matters.
				"Setting24HourTime":      false,
				"SettingChargeUnit":      "kWh",
				"SettingDistanceUnit":    "Miles",
				"SettingTemperatureUnit": "Fahrenheit",
				// SettingTirePressureUnit intentionally absent — the
				// owner never touched the tire-pressure-unit picker,
				// so it must be OMITTED from the response (not
				// projected as null).
			}, nil
		},
	}
	h := NewUserPreferenceHandler(fake, newTestLiveStateReader(fake))

	before := time.Now()
	rec := httptest.NewRecorder()
	h.Latest(rec, newUserPreferenceRequest("42", "/user-preference/latest?vehicle_id=42"))
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
	// Allow a 1-second tolerance window around the wall-clock
	// observation. Latest MUST anchor on time.Now(), NOT a rolling
	// window — a rolling-window anchor would re-introduce the very
	// "no preferences known" bug this migration fixes.
	if gotAt.Before(before.Add(-time.Second)) || gotAt.After(after.Add(time.Second)) {
		t.Fatalf("State.at = %v, want within [%v, %v] (≈ time.Now())", gotAt, before, after)
	}

	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	// CRITICAL preference contract: each present unit MUST round-trip
	// even when forward-folded from an emission months ago. A NULL or
	// missing unit here would silently flip the dashboard to defaults.
	if v, ok := got["setting_charge_unit"].(string); !ok || v != "kWh" {
		t.Fatalf("setting_charge_unit = %#v, want \"kWh\" (forward-folded user pin)", got["setting_charge_unit"])
	}
	if v, ok := got["setting_distance_unit"].(string); !ok || v != "Miles" {
		t.Fatalf("setting_distance_unit = %#v, want \"Miles\" (forward-folded user pin)", got["setting_distance_unit"])
	}
	if v, ok := got["setting_temperature_unit"].(string); !ok || v != "Fahrenheit" {
		t.Fatalf("setting_temperature_unit = %#v, want \"Fahrenheit\" (forward-folded user pin)", got["setting_temperature_unit"])
	}
	if v, ok := got["setting_24hr_time"].(bool); !ok || v != false {
		t.Fatalf("setting_24hr_time = %#v, want false (forward-folded user pin)", got["setting_24hr_time"])
	}
	// Signals NOT present in State must be OMITTED from the response,
	// NOT projected as null. The legacy contract is "return only the
	// keys we know"; the frontend treats missing keys as "use the
	// previously-known value".
	if _, present := got["setting_tire_pressure_unit"]; present {
		t.Fatalf("setting_tire_pressure_unit unexpectedly present in response; got=%v", got)
	}
	// Raw signal names (the Signal side of userPrefMappings) must NOT
	// leak into the response — only the projected Field names.
	if _, present := got["SettingChargeUnit"]; present {
		t.Fatalf("raw signal SettingChargeUnit unexpectedly present in response; got=%v", got)
	}
	if _, present := got["SettingDistanceUnit"]; present {
		t.Fatalf("raw signal SettingDistanceUnit unexpectedly present in response; got=%v", got)
	}
}

// TestUserPreference_PropagatesError verifies that BOTH endpoints
// surface upstream StateReader errors as HTTP 500, never as a silent
// 200 with an empty body. The legacy handler also returned 500 on
// Pivot / Snapshot failure; this test locks the contract for the
// migrated implementation. A silent-empty 200 here would render every
// dashboard formatted value with default units on every transient pgx
// blip — silently flipping a metric-units owner's whole UI to imperial
// and being indistinguishable from a real "we have no preferences"
// condition.
func TestUserPreference_PropagatesError(t *testing.T) {
	t.Run("List_TimelineError", func(t *testing.T) {
		wantErr := errors.New("simulated pgx connection lost on Timeline")
		fake := &fakeStateReader{
			timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
				return nil, wantErr
			},
		}
		h := NewUserPreferenceHandler(fake, newTestLiveStateReader(fake))

		rec := httptest.NewRecorder()
		h.List(rec, newUserPreferenceRequest("42", ""))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("Latest_StateError", func(t *testing.T) {
		wantErr := errors.New("simulated pgx connection lost on State")
		fake := &fakeStateReader{
			stateFn: func(_ context.Context, _ int64, _ time.Time) (signal.State, error) {
				return nil, wantErr
			},
		}
		h := NewUserPreferenceHandler(fake, newTestLiveStateReader(fake))

		rec := httptest.NewRecorder()
		h.Latest(rec, newUserPreferenceRequest("42", "/user-preference/latest?vehicle_id=42"))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
		}
	})
}

// fakeStateReader is a hand-rolled signal.StateReader for handler tests.
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
