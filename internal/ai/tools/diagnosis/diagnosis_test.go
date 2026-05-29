// These tests cover query_charge_session, query_charging_aggregation,
// and RegisterChargingDiagnosisTools. They reuse toolstest.FakeCharges
// so query_charge_detail and the charging-diagnosis tools share the
// same test substrate.

package diagnosis

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/toolstest"
	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
)

// failingChargesImpl wraps the real ChargeSource signature properly
// via reuse of the shared fake. Embedding toolstest.FakeCharges lets us
// inherit its GetByVehicle signature; the override below supplies
// the IO error on every GetByID call so the tools' error wrapping
// path is exercised.
type failingChargesImpl struct {
	toolstest.FakeCharges
	getByIDErr error
}

func (f *failingChargesImpl) GetByID(_ context.Context, _ int64) (*chargingmodel.ChargingSession, error) {
	return nil, f.getByIDErr
}

// TestRegisterChargingDiagnosisTools_RegistersBoth proves the
// wiring helper installs BOTH new tools on a fresh registry.
// Mirrors the existing RegisterDriveCoachingTools test pattern.
func TestRegisterChargingDiagnosisTools_RegistersBoth(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	RegisterChargingDiagnosisTools(r, ChargingDiagnosisSources{Charges: &toolstest.FakeCharges{}})
	for _, name := range []string{"query_charge_session", "query_charging_aggregation"} {
		if _, ok := r.Get(name); !ok {
			t.Errorf("RegisterChargingDiagnosisTools did not register %q", name)
		}
	}
}

// TestRegisterChargingDiagnosisTools_DoesNotShadowBuiltins proves
// that installing charging-diagnosis tools keeps existing builtins
// reachable. Defends against accidental same-name collisions.
func TestRegisterChargingDiagnosisTools_DoesNotShadowBuiltins(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	tools.Register12Builtins(r, tools.Sources{
		Vehicles:      &toolstest.FakeVehicles{},
		VehicleState:  &toolstest.FakeState{},
		Drives:        &toolstest.FakeDrives{},
		Charges:       &toolstest.FakeCharges{},
		AlertRules:    &toolstest.FakeRules{},
		Notifications: &toolstest.FakeNotif{},
		Geofences:     &toolstest.FakeFences{},
		Efficiency:    &toolstest.FakeDrives{},
	})
	RegisterChargingDiagnosisTools(r, ChargingDiagnosisSources{Charges: &toolstest.FakeCharges{}})

	for _, name := range tools.BuiltinNames {
		if _, ok := r.Get(name); !ok {
			t.Errorf("builtin %q lost after RegisterChargingDiagnosisTools", name)
		}
	}
	for _, name := range []string{"query_charge_session", "query_charging_aggregation"} {
		if _, ok := r.Get(name); !ok {
			t.Errorf("charging-diagnosis tool %q missing", name)
		}
	}
}

// TestQueryChargeSession_HappyPath proves the tool returns the row
// the source has for the requested ID.
func TestQueryChargeSession_HappyPath(t *testing.T) {
	t.Parallel()
	now := time.Now()
	want := &chargingmodel.ChargingSession{ID: 501, VehicleID: 1, StartedAt: now}
	src := &toolstest.FakeCharges{One: map[int64]*chargingmodel.ChargingSession{501: want}}
	tool := &queryChargeSession{src: src}

	in, err := tool.Validate(json.RawMessage(`{"session_id": 501}`))
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	got, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if got != want {
		t.Errorf("Execute returned %v, want %v", got, want)
	}
}

// TestQueryChargeSession_NotFound proves a nil row surfaces as an
// explicit error so the dispatcher emits a tool-error frame.
func TestQueryChargeSession_NotFound(t *testing.T) {
	t.Parallel()
	src := &toolstest.FakeCharges{One: map[int64]*chargingmodel.ChargingSession{}}
	tool := &queryChargeSession{src: src}

	in, err := tool.Validate(json.RawMessage(`{"session_id": 999}`))
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Fatal("Execute returned nil err for missing session")
	}
}

// TestQueryChargeSession_RejectsBadInput proves Validate refuses a
// missing / zero / negative session_id.
func TestQueryChargeSession_RejectsBadInput(t *testing.T) {
	t.Parallel()
	tool := &queryChargeSession{src: &toolstest.FakeCharges{}}
	for _, raw := range []string{`{}`, `{"session_id": 0}`, `{"session_id": -1}`} {
		if _, err := tool.Validate(json.RawMessage(raw)); err == nil {
			t.Errorf("Validate(%s) returned nil err", raw)
		}
	}
}

// TestQueryChargeSession_PropagatesIOError proves Execute wraps an
// IO error from the source instead of swallowing it.
func TestQueryChargeSession_PropagatesIOError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("io failure")
	tool := &queryChargeSession{src: &failingChargesImpl{getByIDErr: sentinel}}

	in, _ := tool.Validate(json.RawMessage(`{"session_id": 1}`))
	_, err := tool.Execute(context.Background(), in)
	if err == nil || !errors.Is(err, sentinel) {
		t.Errorf("Execute err = %v, want wrap of %v", err, sentinel)
	}
}

// TestQueryChargeSession_NilSourcePanics proves a wiring bug
// (nil ChargeSource) surfaces as an error rather than a silent
// nil-deref.
func TestQueryChargeSession_NilSource(t *testing.T) {
	t.Parallel()
	tool := &queryChargeSession{src: nil}
	in, _ := tool.Validate(json.RawMessage(`{"session_id": 1}`))
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Fatal("Execute returned nil err with nil source")
	}
}

// TestQueryChargingAggregation_TrickleFlag pins the trickle
// detection thresholds: a 7-hour session at 1.6 kW MUST surface
// `trickle` as the first matching flag.
func TestQueryChargingAggregation_TrickleFlag(t *testing.T) {
	t.Parallel()
	start := time.Date(2026, 5, 1, 22, 0, 0, 0, time.UTC)
	end := start.Add(7 * time.Hour)
	pwr := 1600.0      // W
	energy := 11_200.0 // Wh — 1.6 kW * 7 h
	c := &chargingmodel.ChargingSession{
		ID:                 501,
		VehicleID:          1,
		StartedAt:          start,
		EndedAt:            &end,
		AvgPowerW:          &pwr,
		TotalEnergyAddedWh: &energy,
	}
	out := aggregateChargingSession(c)

	flags, ok := out["flags"].([]string)
	if !ok {
		t.Fatalf("flags not []string: %T", out["flags"])
	}
	if len(flags) == 0 || flags[0] != "trickle" {
		t.Errorf("flags = %v, want first='trickle'", flags)
	}
	if got := out["flag"]; got != "trickle" {
		t.Errorf("flag = %v, want 'trickle'", got)
	}
}

// TestQueryChargingAggregation_ExpensiveFlag pins the expensive
// detection thresholds: a 30-minute, 28 kWh session at $17.40 MUST
// surface `expensive` (cost/kWh ~ 0.62 > 0.50).
func TestQueryChargingAggregation_ExpensiveFlag(t *testing.T) {
	t.Parallel()
	start := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	end := start.Add(30 * time.Minute)
	cost := 17.40
	currency := "USD"
	chargerType := "Supercharger"
	energy := 28_000.0
	c := &chargingmodel.ChargingSession{
		ID:                 502,
		VehicleID:          1,
		StartedAt:          start,
		EndedAt:            &end,
		TotalEnergyAddedWh: &energy,
		CostDecimal:        &cost,
		CostCurrency:       &currency,
		ChargerType:        &chargerType,
	}
	out := aggregateChargingSession(c)
	flags, _ := out["flags"].([]string)
	found := false
	for _, f := range flags {
		if f == "expensive" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("flags = %v, want includes 'expensive'", flags)
	}
	cpk, ok := out["cost_per_kwh"].(float64)
	if !ok || cpk <= 0.50 {
		t.Errorf("cost_per_kwh = %v, want > 0.50", out["cost_per_kwh"])
	}
}

// TestQueryChargingAggregation_NoFlagsHealthySession pins the
// no-anomaly path: a 35-minute Supercharger session at 7 kWh /
// 12 kW with $2.10 cost (cpk = 0.30, well below 0.50) MUST surface
// no flags.
func TestQueryChargingAggregation_NoFlagsHealthySession(t *testing.T) {
	t.Parallel()
	start := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	end := start.Add(35 * time.Minute)
	cost := 2.10
	chargerType := "Supercharger"
	energy := 7_000.0
	c := &chargingmodel.ChargingSession{
		ID:                 503,
		VehicleID:          1,
		StartedAt:          start,
		EndedAt:            &end,
		TotalEnergyAddedWh: &energy,
		CostDecimal:        &cost,
		ChargerType:        &chargerType,
	}
	out := aggregateChargingSession(c)
	flags, _ := out["flags"].([]string)
	if len(flags) != 0 {
		t.Errorf("flags = %v, want empty list for healthy session", flags)
	}
	if got := out["flag"]; got != nil {
		t.Errorf("flag = %v, want nil for no-anomaly session", got)
	}
}

// TestQueryChargingAggregation_TelemetryGapFlag pins the
// telemetry_gap (interrupted) detection: 10-minute home session
// with 0 kWh added MUST surface `telemetry_gap`.
func TestQueryChargingAggregation_TelemetryGapFlag(t *testing.T) {
	t.Parallel()
	start := time.Date(2026, 5, 1, 22, 0, 0, 0, time.UTC)
	end := start.Add(10 * time.Minute)
	energy := 0.0
	c := &chargingmodel.ChargingSession{
		ID:                 504,
		VehicleID:          1,
		StartedAt:          start,
		EndedAt:            &end,
		TotalEnergyAddedWh: &energy,
	}
	out := aggregateChargingSession(c)
	flags, _ := out["flags"].([]string)
	if len(flags) == 0 || flags[0] != "telemetry_gap" {
		t.Errorf("flags = %v, want first='telemetry_gap'", flags)
	}
}

// TestQueryChargingAggregation_BadPowerFlag pins the low-power
// (bad_power) detection on a DC charger: 45 min DC session at 1 kW
// MUST surface `bad_power`.
func TestQueryChargingAggregation_BadPowerFlag(t *testing.T) {
	t.Parallel()
	start := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	end := start.Add(45 * time.Minute)
	chargerType := "DC Fast"
	pwr := 1000.0   // W = 1 kW
	energy := 750.0 // Wh — small enough to keep avg power computation honest
	c := &chargingmodel.ChargingSession{
		ID:                 505,
		VehicleID:          1,
		StartedAt:          start,
		EndedAt:            &end,
		ChargerType:        &chargerType,
		AvgPowerW:          &pwr,
		TotalEnergyAddedWh: &energy,
	}
	out := aggregateChargingSession(c)
	flags, _ := out["flags"].([]string)
	found := false
	for _, f := range flags {
		if f == "bad_power" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("flags = %v, want includes 'bad_power'", flags)
	}
	if got, _ := out["charger_category"].(string); got != "dc" {
		t.Errorf("charger_category = %q, want 'dc'", got)
	}
}

// TestQueryChargingAggregation_InProgressSession proves that an
// in-progress session (EndedAt nil) surfaces is_active=true and
// duration_min=nil; flag detection must not misfire on the unknown
// duration.
func TestQueryChargingAggregation_InProgressSession(t *testing.T) {
	t.Parallel()
	start := time.Now()
	c := &chargingmodel.ChargingSession{
		ID:        506,
		VehicleID: 1,
		StartedAt: start,
	}
	out := aggregateChargingSession(c)
	if got := out["is_active"]; got != true {
		t.Errorf("is_active = %v, want true", got)
	}
	if got := out["duration_min"]; got != nil {
		t.Errorf("duration_min = %v, want nil for in-progress", got)
	}
	flags, _ := out["flags"].([]string)
	for _, f := range flags {
		if f == "trickle" || f == "telemetry_gap" || f == "bad_power" {
			t.Errorf("flag %q raised on in-progress session with unknown duration", f)
		}
	}
}

// TestQueryChargingAggregation_ThresholdsMatchFrontend pins the
// detection thresholds to the exact numbers in
// web/src/lib/chargingAggregation.ts → DEFAULT_THRESHOLDS. A future
// PR that drifts one without the other will fail this test.
func TestQueryChargingAggregation_ThresholdsMatchFrontend(t *testing.T) {
	t.Parallel()
	cases := map[string]float64{
		"chargingFlagExpensiveCostPerKwh":  chargingFlagExpensiveCostPerKwh,
		"chargingFlagTricklePowerKw":       chargingFlagTricklePowerKw,
		"chargingFlagTrickleMinDurMin":     chargingFlagTrickleMinDurMin,
		"chargingFlagTelemetryGapKwhFloor": chargingFlagTelemetryGapKwhFloor,
		"chargingFlagTelemetryGapMinDur":   chargingFlagTelemetryGapMinDur,
		"chargingFlagCostZeroKwhFloor":     chargingFlagCostZeroKwhFloor,
		"chargingFlagBadPowerKw":           chargingFlagBadPowerKw,
		"chargingFlagBadPowerMinDur":       chargingFlagBadPowerMinDur,
	}
	want := map[string]float64{
		"chargingFlagExpensiveCostPerKwh":  0.50,
		"chargingFlagTricklePowerKw":       5.0,
		"chargingFlagTrickleMinDurMin":     360.0,
		"chargingFlagTelemetryGapKwhFloor": 0.1,
		"chargingFlagTelemetryGapMinDur":   5.0,
		"chargingFlagCostZeroKwhFloor":     1.0,
		"chargingFlagBadPowerKw":           3.0,
		"chargingFlagBadPowerMinDur":       30.0,
	}
	for k, v := range want {
		if got := cases[k]; got != v {
			t.Errorf("%s = %v, want %v (must match web/src/lib/chargingAggregation.ts → DEFAULT_THRESHOLDS)", k, got, v)
		}
	}
}

// TestClassifyChargerCategory pins the substring-match category
// inference logic to mirror the frontend's getChargerCategory.
func TestClassifyChargerCategory(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"":                 "home",
		"Supercharger":     "supercharger",
		"TPC v3":           "supercharger",
		"DC Fast":          "dc",
		"CCS":              "dc",
		"CHAdeMO":          "dc",
		"Home AC":          "home",
		"Wall Connector":   "home",
		"AC Generic":       "home",
		"Some Strange One": "unknown",
	}
	for in, want := range cases {
		if got := classifyChargerCategory(in); got != want {
			t.Errorf("classifyChargerCategory(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestQueryChargingAggregation_FlagDetailMapAlwaysReturned proves
// flag_detail is ALWAYS a non-nil map (possibly empty) so the LLM
// can iterate it without a nil-check.
func TestQueryChargingAggregation_FlagDetailMapAlwaysReturned(t *testing.T) {
	t.Parallel()
	c := &chargingmodel.ChargingSession{ID: 507, VehicleID: 1, StartedAt: time.Now()}
	out := aggregateChargingSession(c)
	if _, ok := out["flag_detail"].(map[string]any); !ok {
		t.Errorf("flag_detail is not map[string]any: %T (%v)", out["flag_detail"], out["flag_detail"])
	}
}

// TestQueryChargingAggregation_NilEnergyDoesNotCrash proves the
// helper handles a missing total_energy_added_wh column without
// panicking, and that derived metrics surface as nil.
func TestQueryChargingAggregation_NilEnergyDoesNotCrash(t *testing.T) {
	t.Parallel()
	start := time.Now()
	end := start.Add(time.Hour)
	c := &chargingmodel.ChargingSession{
		ID:        508,
		VehicleID: 1,
		StartedAt: start,
		EndedAt:   &end,
	}
	out := aggregateChargingSession(c)
	if got := out["kwh_added"]; got != nil {
		t.Errorf("kwh_added = %v, want nil for missing energy column", got)
	}
	if got := out["cost_per_kwh"]; got != nil {
		t.Errorf("cost_per_kwh = %v, want nil for missing energy column", got)
	}
}

// TestQueryChargingAggregation_FullEnvelopeShape pins the keys the
// envelope emits so a future field rename surfaces here. Mirrors
// the documented envelope at the top of charging_diagnosis.go.
func TestQueryChargingAggregation_FullEnvelopeShape(t *testing.T) {
	t.Parallel()
	c := &chargingmodel.ChargingSession{ID: 509, VehicleID: 1, StartedAt: time.Now()}
	out := aggregateChargingSession(c)
	wantKeys := []string{
		"session_id", "vehicle_id", "duration_min", "kwh_added", "avg_power_kw",
		"peak_power_kw", "cost_per_kwh", "cost_total", "currency",
		"charger_category", "start_soc_pct", "end_soc_pct", "delta_soc_pct",
		"is_active", "flags", "flag", "flag_detail", "thresholds",
	}
	for _, k := range wantKeys {
		if _, ok := out[k]; !ok {
			t.Errorf("envelope missing key %q", k)
		}
	}
}

// TestQueryChargingAggregation_PriorityOrder pins the priority-order
// behaviour: when both telemetry_gap and trickle would fire, the
// FIRST listed flag (and the `flag` field) MUST be telemetry_gap.
//
// We construct a session that satisfies both rules: 0 kWh added (so
// telemetry_gap fires on a long zero-energy session) AND a 7-hour
// duration with zero average power (which trips trickle's "0 < 5
// kW for >360 min" too). Note: in practice a real telemetry_gap
// is short (5-30 min) and a real trickle has positive power, but
// the contrived-but-legal input here proves the priority-order
// invariant explicitly.
func TestQueryChargingAggregation_PriorityOrder(t *testing.T) {
	t.Parallel()
	start := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(7 * time.Hour)
	energy := 0.0
	c := &chargingmodel.ChargingSession{
		ID:                 510,
		VehicleID:          1,
		StartedAt:          start,
		EndedAt:            &end,
		TotalEnergyAddedWh: &energy,
	}
	out := aggregateChargingSession(c)
	flags, _ := out["flags"].([]string)
	if len(flags) < 1 || flags[0] != "telemetry_gap" {
		t.Fatalf("flags = %v, want first='telemetry_gap' (priority order)", flags)
	}
	// Second flag MUST be trickle (the only other rule that
	// matches a 0-power 7-hour session).
	hasTrickle := false
	for _, f := range flags[1:] {
		if f == "trickle" {
			hasTrickle = true
			break
		}
	}
	if !hasTrickle {
		t.Errorf("flags = %v, want includes 'trickle' as a secondary observation", flags)
	}
	if got := out["flag"]; got != "telemetry_gap" {
		t.Errorf("flag = %v, want 'telemetry_gap' (first match)", got)
	}
}
