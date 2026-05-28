// Phase-50 / 0025 — D5 Trip planner LLM agent tool tests.
//
// Tool tests for query_chargers_along_route + query_user_charge_dwells
// + draft_trip_plan. All three tools are pure functions over their
// typed input + a narrow port (ChargeSource or TripPlanComputer);
// the tests stub each port with a deterministic fake so the tests
// stay hermetic (no DB, no canonical-planner round-trip).
//
// Reuses the shared `fakeCharges` source from builtins_test.go so
// the existing charging-domain tools and these new tools share the
// same test substrate.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
)

// fixedNowFn returns a deterministic `func() time.Time` clock for
// the trip-planner tool's lookback-window tests so the goldens stay
// stable across CI runs. Distinct from `fixedNow()` (used by the
// route-efficiency tool tests) so the package compiles cleanly.
// 2025-01-15 12:00:00 UTC is well past the Phase-42 cutover so the
// charging-session model fields are all SI-canonical.
func fixedNowFn() func() time.Time {
	t := time.Date(2025, 1, 15, 12, 0, 0, 0, time.UTC)
	return func() time.Time { return t }
}

// ptrTime is a helper for *time.Time fields on
// *chargingmodel.ChargingSession.
func ptrTime(t time.Time) *time.Time { return &t }

// Local ptr helpers — originally defined in route_efficiency_test.go,
// duplicated here after the R6.28 carve of route_efficiency → route/
// (parent test cannot import the subpkg without inducing a cycle).
func ptrStr(s string) *string       { return &s }
func ptrFloat64(v float64) *float64 { return &v }

// ---------------------------------------------------------------------------
// query_chargers_along_route
// ---------------------------------------------------------------------------

// TestQueryChargersAlongRoute_FiltersByCorridor proves only sessions
// whose start coordinates fall within corridor_km of the
// origin→destination great-circle line are returned. The two
// in-corridor stations should be grouped by start_place and emitted
// sorted by visit_count desc.
func TestQueryChargersAlongRoute_FiltersByCorridor(t *testing.T) {
	t.Parallel()
	// Build a deterministic SF→LA corridor.
	// SF: 37.78, -122.42. LA: 34.05, -118.24.
	// The line's t=0.5 midpoint is (35.915, -120.33).
	// In-corridor: (35.92, -120.30) — on the midline.
	// Also in-corridor: (34.5, -118.5) — near LA, slightly off-line.
	// Out-of-corridor: (40.0, -100.0) — Kansas, far from the line.
	sf := time.Date(2024, 11, 1, 8, 0, 0, 0, time.UTC)
	ended := func(t time.Time, mins float64) *time.Time {
		out := t.Add(time.Duration(mins * float64(time.Minute)))
		return &out
	}
	rows := []*chargingmodel.ChargingSession{
		// 2 visits to "Halfway SC" inside corridor
		{
			ID: 1, VehicleID: 42, StartedAt: sf,
			EndedAt:  ended(sf, 30),
			StartLat: ptrFloat64(35.92), StartLng: ptrFloat64(-120.30),
			StartPlace: ptrStr("Halfway SC"),
			PeakPowerW: ptrFloat64(150000), AvgPowerW: ptrFloat64(100000),
			DeltaSocPct: ptrFloat64(40), TotalEnergyAddedWh: ptrFloat64(30000),
		},
		{
			ID: 2, VehicleID: 42, StartedAt: sf.AddDate(0, 0, 7),
			EndedAt:  ended(sf.AddDate(0, 0, 7), 25),
			StartLat: ptrFloat64(35.92), StartLng: ptrFloat64(-120.30),
			StartPlace: ptrStr("Halfway SC"),
			PeakPowerW: ptrFloat64(140000), AvgPowerW: ptrFloat64(95000),
			DeltaSocPct: ptrFloat64(35), TotalEnergyAddedWh: ptrFloat64(28000),
		},
		// 1 visit to "Near LA SC" inside corridor
		{
			ID: 3, VehicleID: 42, StartedAt: sf.AddDate(0, 0, 14),
			EndedAt:  ended(sf.AddDate(0, 0, 14), 20),
			StartLat: ptrFloat64(34.5), StartLng: ptrFloat64(-118.5),
			StartPlace: ptrStr("Near LA SC"),
			PeakPowerW: ptrFloat64(150000), AvgPowerW: ptrFloat64(110000),
			DeltaSocPct: ptrFloat64(30), TotalEnergyAddedWh: ptrFloat64(22000),
		},
		// 1 visit to "Kansas SC" OUT of corridor — must be skipped.
		{
			ID: 4, VehicleID: 42, StartedAt: sf.AddDate(0, 0, 21),
			EndedAt:  ended(sf.AddDate(0, 0, 21), 60),
			StartLat: ptrFloat64(40.0), StartLng: ptrFloat64(-100.0),
			StartPlace: ptrStr("Kansas SC"),
			PeakPowerW: ptrFloat64(150000), AvgPowerW: ptrFloat64(120000),
			DeltaSocPct: ptrFloat64(50), TotalEnergyAddedWh: ptrFloat64(40000),
		},
	}
	tool := &queryChargersAlongRoute{src: &fakeCharges{rows: rows}, now: fixedNowFn()}

	rawIn := json.RawMessage(`{
		"vehicle_id": 42,
		"origin_lat": 37.78, "origin_lng": -122.42,
		"dest_lat": 34.05, "dest_lng": -118.24,
		"corridor_km": 30, "lookback_days": 90
	}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(map[string]any)
	chargers := env["chargers"].([]chargerCorridorEnvelope)
	if len(chargers) != 2 {
		t.Fatalf("chargers length = %d, want 2 (got=%v)", len(chargers), chargers)
	}
	// Halfway SC has visit_count=2 so must be first.
	if chargers[0].StartPlace != "Halfway SC" {
		t.Errorf("chargers[0].StartPlace = %q, want Halfway SC", chargers[0].StartPlace)
	}
	if chargers[0].VisitCount != 2 {
		t.Errorf("chargers[0].VisitCount = %d, want 2", chargers[0].VisitCount)
	}
	if chargers[1].StartPlace != "Near LA SC" {
		t.Errorf("chargers[1].StartPlace = %q, want Near LA SC", chargers[1].StartPlace)
	}
	for _, c := range chargers {
		if c.StartPlace == "Kansas SC" {
			t.Errorf("out-of-corridor station leaked: %v", c)
		}
	}
}

// TestQueryChargersAlongRoute_DefaultsApplied proves the tool
// substitutes the canonical defaults when corridor_km or
// lookback_days are zero/missing.
func TestQueryChargersAlongRoute_DefaultsApplied(t *testing.T) {
	t.Parallel()
	tool := &queryChargersAlongRoute{src: &fakeCharges{rows: nil}, now: fixedNowFn()}
	rawIn := json.RawMessage(`{
		"vehicle_id": 42,
		"origin_lat": 37.78, "origin_lng": -122.42,
		"dest_lat": 34.05, "dest_lng": -118.24
	}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(map[string]any)
	if env["corridor_km"].(float64) != tripPlannerLLMAgentDefaultCorridorKm {
		t.Errorf("corridor_km default = %v, want %v",
			env["corridor_km"], tripPlannerLLMAgentDefaultCorridorKm)
	}
	if env["lookback_days"].(int) != tripPlannerLLMAgentDefaultLookbackDays {
		t.Errorf("lookback_days default = %v, want %v",
			env["lookback_days"], tripPlannerLLMAgentDefaultLookbackDays)
	}
}

// TestQueryChargersAlongRoute_NoChargeSource proves a missing
// ChargeSource is reported as an Execute error so a wiring bug
// surfaces clearly.
func TestQueryChargersAlongRoute_NoChargeSource(t *testing.T) {
	t.Parallel()
	tool := &queryChargersAlongRoute{src: nil, now: fixedNowFn()}
	rawIn := json.RawMessage(`{
		"vehicle_id": 42,
		"origin_lat": 0, "origin_lng": 0,
		"dest_lat": 1, "dest_lng": 1
	}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil, want error for nil source")
	}
	if !strings.Contains(err.Error(), "no ChargeSource") {
		t.Errorf("Execute err = %v, want 'no ChargeSource' message", err)
	}
}

// TestQueryChargersAlongRoute_PropagatesSourceError proves the tool
// wraps a ChargeSource error verbatim rather than swallowing it.
func TestQueryChargersAlongRoute_PropagatesSourceError(t *testing.T) {
	t.Parallel()
	tool := &queryChargersAlongRoute{src: &failingCharges{err: errors.New("db down")}, now: fixedNowFn()}
	rawIn := json.RawMessage(`{
		"vehicle_id": 42,
		"origin_lat": 0, "origin_lng": 0,
		"dest_lat": 1, "dest_lng": 1
	}`)
	in, _ := tool.Validate(rawIn)
	_, err := tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil, want error")
	}
	if !strings.Contains(err.Error(), "db down") {
		t.Errorf("Execute err = %v, want 'db down' wrap", err)
	}
}

// TestQueryChargersAlongRoute_PropOnlyContract pins the tool's
// propose-only metadata so a future edit that flips Mutates() to
// true (e.g. a confused refactor) fails this test before reaching
// the dispatcher's confirm hook.
func TestQueryChargersAlongRoute_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &queryChargersAlongRoute{}
	if tool.Name() != "query_chargers_along_route" {
		t.Errorf("Name() = %q", tool.Name())
	}
	if tool.Mutates() {
		t.Errorf("Mutates() = true, want false (propose-only)")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
	if tool.OutputSchema() != nil {
		t.Errorf("OutputSchema() != nil")
	}
}

// ---------------------------------------------------------------------------
// query_user_charge_dwells
// ---------------------------------------------------------------------------

// TestQueryUserChargeDwells_AggregatesByPlace proves the per-place
// aggregation (visit_count, avg_dwell_minutes, avg_delta_soc_pct)
// matches what the LLM should see.
func TestQueryUserChargeDwells_AggregatesByPlace(t *testing.T) {
	t.Parallel()
	sf := time.Date(2024, 11, 1, 8, 0, 0, 0, time.UTC)
	ended := func(t time.Time, mins float64) *time.Time {
		out := t.Add(time.Duration(mins * float64(time.Minute)))
		return &out
	}
	rows := []*chargingmodel.ChargingSession{
		// 2 visits to "Home" — 30min and 50min dwell.
		{
			ID: 1, VehicleID: 42, StartedAt: sf, EndedAt: ended(sf, 30),
			StartPlace:  ptrStr("Home"),
			DeltaSocPct: ptrFloat64(20), TotalEnergyAddedWh: ptrFloat64(15000),
		},
		{
			ID: 2, VehicleID: 42, StartedAt: sf.AddDate(0, 0, 1), EndedAt: ended(sf.AddDate(0, 0, 1), 50),
			StartPlace:  ptrStr("Home"),
			DeltaSocPct: ptrFloat64(30), TotalEnergyAddedWh: ptrFloat64(22000),
		},
		// 1 visit to "Work" — 60min dwell.
		{
			ID: 3, VehicleID: 42, StartedAt: sf.AddDate(0, 0, 2), EndedAt: ended(sf.AddDate(0, 0, 2), 60),
			StartPlace:  ptrStr("Work"),
			DeltaSocPct: ptrFloat64(15), TotalEnergyAddedWh: ptrFloat64(11000),
		},
	}
	tool := &queryUserChargeDwells{src: &fakeCharges{rows: rows}, now: fixedNowFn()}
	rawIn := json.RawMessage(`{"vehicle_id": 42, "lookback_days": 90}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(map[string]any)
	dwells := env["dwells"].([]chargerDwellEnvelope)
	if len(dwells) != 2 {
		t.Fatalf("dwells length = %d, want 2 (got=%v)", len(dwells), dwells)
	}
	// Home (visit_count=2) must be first.
	if dwells[0].StartPlace != "Home" || dwells[0].VisitCount != 2 {
		t.Errorf("dwells[0] = %+v, want Home/2", dwells[0])
	}
	if dwells[0].AvgDwellMinutes != 40 {
		t.Errorf("dwells[0].AvgDwellMinutes = %v, want 40 (avg of 30 + 50)", dwells[0].AvgDwellMinutes)
	}
	if dwells[0].AvgDeltaSocPct != 25 {
		t.Errorf("dwells[0].AvgDeltaSocPct = %v, want 25", dwells[0].AvgDeltaSocPct)
	}
	if dwells[1].StartPlace != "Work" || dwells[1].VisitCount != 1 {
		t.Errorf("dwells[1] = %+v, want Work/1", dwells[1])
	}
}

// TestQueryUserChargeDwells_SkipsNilStartPlace proves sessions with
// a nil StartPlace pointer (typical for unlabelled telemetry) are
// silently skipped — the LLM only sees grouped entries.
func TestQueryUserChargeDwells_SkipsNilStartPlace(t *testing.T) {
	t.Parallel()
	sf := time.Date(2024, 11, 1, 8, 0, 0, 0, time.UTC)
	rows := []*chargingmodel.ChargingSession{
		{ID: 1, VehicleID: 42, StartedAt: sf, StartPlace: nil},
		{ID: 2, VehicleID: 42, StartedAt: sf.AddDate(0, 0, 1), StartPlace: ptrStr("Home")},
	}
	tool := &queryUserChargeDwells{src: &fakeCharges{rows: rows}, now: fixedNowFn()}
	rawIn := json.RawMessage(`{"vehicle_id": 42}`)
	in, _ := tool.Validate(rawIn)
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	dwells := out.(map[string]any)["dwells"].([]chargerDwellEnvelope)
	if len(dwells) != 1 || dwells[0].StartPlace != "Home" {
		t.Errorf("dwells = %v, want only [Home]", dwells)
	}
}

// TestQueryUserChargeDwells_PropOnlyContract pins the tool's
// propose-only metadata.
func TestQueryUserChargeDwells_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &queryUserChargeDwells{}
	if tool.Name() != "query_user_charge_dwells" {
		t.Errorf("Name() = %q", tool.Name())
	}
	if tool.Mutates() {
		t.Errorf("Mutates() = true, want false (propose-only)")
	}
}

// ---------------------------------------------------------------------------
// draft_trip_plan
// ---------------------------------------------------------------------------

// fakeTripPlanComputer is a deterministic TripPlanComputer stub used
// by the draft_trip_plan tests. It records the last request and
// returns a canned envelope.
type fakeTripPlanComputer struct {
	last *TripPlanComputeRequest
	out  *TripPlanComputeResult
	err  error
}

func (f *fakeTripPlanComputer) ComputeTripPlan(_ context.Context, req TripPlanComputeRequest) (*TripPlanComputeResult, error) {
	cp := req
	f.last = &cp
	if f.err != nil {
		return nil, f.err
	}
	return f.out, nil
}

// TestDraftTripPlan_DelegatesAndStampsStatus proves draft_trip_plan
// passes the typed request through to the canonical planner and
// returns the same SI-canonical envelope with a Status stamp.
func TestDraftTripPlan_DelegatesAndStampsStatus(t *testing.T) {
	t.Parallel()
	canned := &TripPlanComputeResult{
		Route: TripPlanRoute{
			TotalDistanceM: 700_000, TotalDurationS: 25_200,
			DrivingDurationS: 21_600, ChargingDurationS: 3_600,
			TotalEnergyWh: 100_000, EstimatedCost: 28.0,
			ArrivalSOC: 22, Feasible: true, IsEstimate: true,
		},
		Legs:        []TripPlanLeg{},
		ChargeStops: []TripPlanChargeStop{{Name: "Halfway SC", IsRecommended: true}},
		SOCCurve:    []TripPlanSOCPoint{},
	}
	planner := &fakeTripPlanComputer{out: canned}
	tool := &draftTripPlan{planner: planner}

	rawIn := json.RawMessage(`{
		"vehicle_id": 42,
		"origin_lat": 37.78, "origin_lng": -122.42,
		"dest_lat": 34.05, "dest_lng": -118.24,
		"current_soc": 80,
		"charge_limit_soc": 90,
		"min_arrival_soc": 20,
		"speed_factor": 1.0
	}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(*draftTripPlanOutput)
	if env.Status != "ok" {
		t.Errorf("Status = %q, want ok", env.Status)
	}
	if env.Plan == nil {
		t.Fatal("Plan is nil")
	}
	if env.Plan.Route.TotalDistanceM != 700_000 {
		t.Errorf("Plan.Route.TotalDistanceM = %v, want 700000", env.Plan.Route.TotalDistanceM)
	}
	if planner.last == nil {
		t.Fatal("planner.last is nil; computePlan never called")
	}
	if planner.last.VehicleID != 42 {
		t.Errorf("planner.last.VehicleID = %d, want 42", planner.last.VehicleID)
	}
}

// TestDraftTripPlan_DefaultsApplied proves zero ChargeLimitSOC /
// MinArrivalSOC / SpeedFactor are clamped to the same defaults the
// baseline *TripPlannerHandler.Plan applies.
func TestDraftTripPlan_DefaultsApplied(t *testing.T) {
	t.Parallel()
	canned := &TripPlanComputeResult{Route: TripPlanRoute{Feasible: true}}
	planner := &fakeTripPlanComputer{out: canned}
	tool := &draftTripPlan{planner: planner}
	// Provide CurrentSOC; omit the optional knobs.
	rawIn := json.RawMessage(`{
		"vehicle_id": 42,
		"origin_lat": 37.78, "origin_lng": -122.42,
		"dest_lat": 34.05, "dest_lng": -118.24,
		"current_soc": 80
	}`)
	in, _ := tool.Validate(rawIn)
	_, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	if planner.last.ChargeLimitSOC != 90 {
		t.Errorf("default ChargeLimitSOC = %v, want 90", planner.last.ChargeLimitSOC)
	}
	if planner.last.MinArrivalSOC != 20 {
		t.Errorf("default MinArrivalSOC = %v, want 20", planner.last.MinArrivalSOC)
	}
	if planner.last.SpeedFactor != 1.0 {
		t.Errorf("default SpeedFactor = %v, want 1.0", planner.last.SpeedFactor)
	}
}

// TestDraftTripPlan_StampsInfeasibleStatus proves a Feasible=false
// envelope from the planner is reported as status="infeasible" so
// the LLM's narration can address it.
func TestDraftTripPlan_StampsInfeasibleStatus(t *testing.T) {
	t.Parallel()
	canned := &TripPlanComputeResult{Route: TripPlanRoute{Feasible: false}}
	planner := &fakeTripPlanComputer{out: canned}
	tool := &draftTripPlan{planner: planner}
	rawIn := json.RawMessage(`{
		"vehicle_id": 42,
		"origin_lat": 0, "origin_lng": 0,
		"dest_lat": 1, "dest_lng": 1,
		"current_soc": 10
	}`)
	in, _ := tool.Validate(rawIn)
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	if out.(*draftTripPlanOutput).Status != "infeasible" {
		t.Errorf("Status = %q, want infeasible", out.(*draftTripPlanOutput).Status)
	}
}

// TestDraftTripPlan_PropagatesComputeError proves the tool wraps a
// TripPlanComputer error verbatim rather than swallowing it.
func TestDraftTripPlan_PropagatesComputeError(t *testing.T) {
	t.Parallel()
	planner := &fakeTripPlanComputer{err: errors.New("planner down")}
	tool := &draftTripPlan{planner: planner}
	rawIn := json.RawMessage(`{
		"vehicle_id": 42,
		"origin_lat": 0, "origin_lng": 0,
		"dest_lat": 1, "dest_lng": 1,
		"current_soc": 10
	}`)
	in, _ := tool.Validate(rawIn)
	_, err := tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil, want error")
	}
	if !strings.Contains(err.Error(), "planner down") {
		t.Errorf("Execute err = %v, want 'planner down' wrap", err)
	}
}

// TestDraftTripPlan_NoPlannerWired proves a missing TripPlanComputer
// is reported as an Execute error so a wiring bug surfaces clearly.
func TestDraftTripPlan_NoPlannerWired(t *testing.T) {
	t.Parallel()
	tool := &draftTripPlan{planner: nil}
	rawIn := json.RawMessage(`{
		"vehicle_id": 42,
		"origin_lat": 0, "origin_lng": 0,
		"dest_lat": 1, "dest_lng": 1,
		"current_soc": 10
	}`)
	in, _ := tool.Validate(rawIn)
	_, err := tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil, want error for nil planner")
	}
	if !strings.Contains(err.Error(), "no TripPlanComputer") {
		t.Errorf("Execute err = %v, want 'no TripPlanComputer' message", err)
	}
}

// TestDraftTripPlan_PropOnlyContract pins the tool's propose-only
// metadata.
func TestDraftTripPlan_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &draftTripPlan{}
	if tool.Name() != "draft_trip_plan" {
		t.Errorf("Name() = %q", tool.Name())
	}
	if tool.Mutates() {
		t.Errorf("Mutates() = true, want false (propose-only)")
	}
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// TestRegisterTripPlannerLLMAgentTools_RegistersAllThree proves the
// public registration entry point installs all three tools by name.
func TestRegisterTripPlannerLLMAgentTools_RegistersAllThree(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	RegisterTripPlannerLLMAgentTools(r, TripPlannerLLMAgentSources{
		Chargers: &fakeCharges{},
		Planner:  &fakeTripPlanComputer{},
	})
	for _, want := range []string{
		"query_chargers_along_route",
		"query_user_charge_dwells",
		"draft_trip_plan",
	} {
		if _, ok := r.Get(want); !ok {
			t.Errorf("registry missing %q after RegisterTripPlannerLLMAgentTools", want)
		}
	}
}

// ---------------------------------------------------------------------------
// failingCharges helper
// ---------------------------------------------------------------------------

// failingCharges errors on every GetByVehicle call so the
// error-propagation tests can prove the tool wraps cleanly without
// swallowing the cause.
type failingCharges struct {
	err error
}

func (f *failingCharges) GetByVehicle(_ context.Context, _ int64, _, _ int, _, _ time.Time) ([]*chargingmodel.ChargingSession, error) {
	return nil, f.err
}

func (f *failingCharges) GetByID(_ context.Context, _ int64) (*chargingmodel.ChargingSession, error) {
	return nil, f.err
}
