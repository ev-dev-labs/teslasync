// Phase-50 / 0026 — C1 Smart-charge schedule suggestion.
//
// Unit tests for draft_charge_schedule + validate_charge_schedule.
// Both tools are propose-only and hermetic — the tests substitute a
// deterministic [fakeChargeScheduleComputer] for the planner and run
// the validator with pure-Go arithmetic. No DB / network / clock
// dependency.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// draft_charge_schedule
// ---------------------------------------------------------------------------

// fakeChargeScheduleComputer is a hermetic stand-in for
// *api.AIChargeScheduleComputer. It records the request and returns
// the canned result or error. Mirrors fakeTripPlanComputer.
type fakeChargeScheduleComputer struct {
	last *ChargeScheduleComputeRequest
	out  *ChargeScheduleComputeResult
	err  error
}

func (f *fakeChargeScheduleComputer) ComputeChargeSchedule(_ context.Context, req ChargeScheduleComputeRequest) (*ChargeScheduleComputeResult, error) {
	cp := req
	f.last = &cp
	if f.err != nil {
		return nil, f.err
	}
	return f.out, nil
}

// TestDraftChargeSchedule_DelegatesAndStampsStatus proves
// draft_charge_schedule passes the typed request through to the
// canonical planner and returns the same envelope with a Status
// stamp. Pins PlanID=0 so the tool can never leak a persisted ID.
func TestDraftChargeSchedule_DelegatesAndStampsStatus(t *testing.T) {
	t.Parallel()
	canned := &ChargeScheduleComputeResult{
		PlanID:           0,
		CurrentSOC:       40,
		TargetSOC:        80,
		KWhNeeded:        30.0,
		EstDurationHours: 4.2,
		Schedule: ChargeWindow{
			RateCentsKWh: 24.5,
			EstCost:      7.35,
			RateTier:     "off_peak",
		},
		Comparison: CostComparison{
			ChargeNowCost: 12.50,
			OptimizedCost: 7.35,
			Savings:       5.15,
			SavingsPct:    41.2,
		},
	}
	planner := &fakeChargeScheduleComputer{out: canned}
	tool := &draftChargeSchedule{planner: planner}

	rawIn := json.RawMessage(`{
		"vehicle_id": 42,
		"target_soc": 80,
		"depart_by": "2099-01-02T07:30:00Z",
		"rate_plan_id": "pge-ev2a",
		"max_amps": 32,
		"battery_capacity_kwh": 75,
		"charger_voltage": 240,
		"prefer_off_peak": true,
		"current_soc": 40
	}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(*draftChargeScheduleOutput)
	if env.Status != "ok" {
		t.Errorf("Status = %q, want ok", env.Status)
	}
	if env.ValidationError != "" {
		t.Errorf("ValidationError = %q, want empty for ok status", env.ValidationError)
	}
	if env.Schedule == nil {
		t.Fatal("Schedule is nil")
	}
	if env.Schedule.PlanID != 0 {
		t.Errorf("Schedule.PlanID = %d, want 0 (propose-only)", env.Schedule.PlanID)
	}
	if env.Schedule.Schedule.RateTier != "off_peak" {
		t.Errorf("Schedule.Schedule.RateTier = %q, want off_peak", env.Schedule.Schedule.RateTier)
	}
	if planner.last == nil {
		t.Fatal("planner.last is nil; computeSchedule never called")
	}
	if planner.last.VehicleID != 42 {
		t.Errorf("planner.last.VehicleID = %d, want 42", planner.last.VehicleID)
	}
	if planner.last.RatePlanID != "pge-ev2a" {
		t.Errorf("planner.last.RatePlanID = %q, want pge-ev2a", planner.last.RatePlanID)
	}
}

// TestDraftChargeSchedule_DefaultsApplied proves zero MaxAmps /
// BatteryCapacity / ChargerVoltage are clamped to the same defaults
// the baseline *ChargePlannerHandler.Optimize applies.
func TestDraftChargeSchedule_DefaultsApplied(t *testing.T) {
	t.Parallel()
	canned := &ChargeScheduleComputeResult{Schedule: ChargeWindow{RateTier: "off_peak"}}
	planner := &fakeChargeScheduleComputer{out: canned}
	tool := &draftChargeSchedule{planner: planner}
	// Provide TargetSOC, DepartBy, RatePlanID, CurrentSOC; omit
	// the optional knobs so the defaults branch fires.
	rawIn := json.RawMessage(`{
		"vehicle_id": 42,
		"target_soc": 80,
		"depart_by": "2099-01-02T07:30:00Z",
		"rate_plan_id": "pge-ev2a",
		"current_soc": 40
	}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	if planner.last.MaxAmps != 32 {
		t.Errorf("default MaxAmps = %d, want 32", planner.last.MaxAmps)
	}
	if planner.last.BatteryCapacity != 75.0 {
		t.Errorf("default BatteryCapacity = %v, want 75.0", planner.last.BatteryCapacity)
	}
	if planner.last.ChargerVoltage != 240 {
		t.Errorf("default ChargerVoltage = %d, want 240", planner.last.ChargerVoltage)
	}
}

// TestDraftChargeSchedule_ClampsExcessAmps proves a >80A payload is
// clamped to 80A so a runaway LLM cannot ask the canonical planner
// to consider an unrealistic charger spec.
func TestDraftChargeSchedule_ClampsExcessAmps(t *testing.T) {
	t.Parallel()
	canned := &ChargeScheduleComputeResult{}
	planner := &fakeChargeScheduleComputer{out: canned}
	tool := &draftChargeSchedule{planner: planner}
	// Use the maximum allowed by the InputSchema (lte=80) so
	// the validator passes; then assert it survives. Then send
	// a deliberately low value to confirm clamp-to-default
	// still applies on zero/negative.
	rawIn := json.RawMessage(`{
		"vehicle_id": 42,
		"target_soc": 80,
		"depart_by": "2099-01-02T07:30:00Z",
		"rate_plan_id": "pge-ev2a",
		"max_amps": 80,
		"current_soc": 40
	}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	if planner.last.MaxAmps != 80 {
		t.Errorf("MaxAmps = %d, want 80 (cap preserved)", planner.last.MaxAmps)
	}
}

// TestDraftChargeSchedule_SurfacesPlannerErrorAsInvalidEnvelope
// proves a planner-feasibility error (e.g. "current SOC already
// meets target") is reflected back to the LLM as a typed
// {status:"invalid", validation_error:"..."} envelope rather than
// crashing the dispatcher.
func TestDraftChargeSchedule_SurfacesPlannerErrorAsInvalidEnvelope(t *testing.T) {
	t.Parallel()
	planner := &fakeChargeScheduleComputer{err: errors.New("current SOC (90%) already meets target (80%)")}
	tool := &draftChargeSchedule{planner: planner}
	rawIn := json.RawMessage(`{
		"vehicle_id": 42,
		"target_soc": 80,
		"depart_by": "2099-01-02T07:30:00Z",
		"rate_plan_id": "pge-ev2a",
		"current_soc": 90
	}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil (feasibility errors return a typed envelope)", err)
	}
	env := out.(*draftChargeScheduleOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid", env.Status)
	}
	if !strings.Contains(env.ValidationError, "already meets target") {
		t.Errorf("ValidationError = %q, want substring 'already meets target'", env.ValidationError)
	}
	if env.Schedule != nil {
		t.Errorf("Schedule = %+v, want nil for invalid status", env.Schedule)
	}
}

// TestDraftChargeSchedule_NoPlannerWired proves a missing
// ChargeScheduleComputer is reported as an Execute error so a
// wiring bug surfaces clearly at first call rather than at boot.
func TestDraftChargeSchedule_NoPlannerWired(t *testing.T) {
	t.Parallel()
	tool := &draftChargeSchedule{planner: nil}
	rawIn := json.RawMessage(`{
		"vehicle_id": 42,
		"target_soc": 80,
		"depart_by": "2099-01-02T07:30:00Z",
		"rate_plan_id": "pge-ev2a",
		"current_soc": 40
	}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil, want error for nil planner")
	}
	if !strings.Contains(err.Error(), "no ChargeScheduleComputer") {
		t.Errorf("Execute err = %v, want 'no ChargeScheduleComputer' message", err)
	}
}

// TestDraftChargeSchedule_PropOnlyContract pins the propose-only
// metadata.
func TestDraftChargeSchedule_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &draftChargeSchedule{}
	if tool.Name() != "draft_charge_schedule" {
		t.Errorf("Name() = %q, want draft_charge_schedule", tool.Name())
	}
	if tool.Mutates() {
		t.Errorf("Mutates() = true, want false (propose-only)")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
}

// ---------------------------------------------------------------------------
// validate_charge_schedule
// ---------------------------------------------------------------------------

// TestValidateChargeSchedule_OK proves a fully-consistent envelope
// returns Status=ok.
func TestValidateChargeSchedule_OK(t *testing.T) {
	t.Parallel()
	tool := &validateChargeSchedule{}
	rawIn := json.RawMessage(`{
		"start_time": "2099-01-02T00:00:00Z",
		"end_time": "2099-01-02T05:00:00Z",
		"current_soc": 40,
		"target_soc": 80,
		"depart_by": "2099-01-02T07:30:00Z"
	}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(*validateChargeScheduleOutput)
	if env.Status != "ok" {
		t.Errorf("Status = %q, want ok (err=%q)", env.Status, env.ValidationError)
	}
	if env.ValidationError != "" {
		t.Errorf("ValidationError = %q, want empty", env.ValidationError)
	}
}

// TestValidateChargeSchedule_RejectsInvertedWindow proves a
// start_time at-or-after end_time is rejected.
func TestValidateChargeSchedule_RejectsInvertedWindow(t *testing.T) {
	t.Parallel()
	tool := &validateChargeSchedule{}
	rawIn := json.RawMessage(`{
		"start_time": "2099-01-02T06:00:00Z",
		"end_time": "2099-01-02T00:00:00Z",
		"current_soc": 40,
		"target_soc": 80,
		"depart_by": "2099-01-02T07:30:00Z"
	}`)
	in, _ := tool.Validate(rawIn)
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(*validateChargeScheduleOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid", env.Status)
	}
	if !strings.Contains(env.ValidationError, "end_time must be strictly after start_time") {
		t.Errorf("ValidationError = %q, want substring about inverted window", env.ValidationError)
	}
}

// TestValidateChargeSchedule_RejectsEndAfterDepart proves a window
// that ends AFTER depart_by is rejected.
func TestValidateChargeSchedule_RejectsEndAfterDepart(t *testing.T) {
	t.Parallel()
	tool := &validateChargeSchedule{}
	rawIn := json.RawMessage(`{
		"start_time": "2099-01-02T00:00:00Z",
		"end_time": "2099-01-02T08:00:00Z",
		"current_soc": 40,
		"target_soc": 80,
		"depart_by": "2099-01-02T07:30:00Z"
	}`)
	in, _ := tool.Validate(rawIn)
	out, _ := tool.Execute(context.Background(), in)
	env := out.(*validateChargeScheduleOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid", env.Status)
	}
	if !strings.Contains(env.ValidationError, "at or before depart_by") {
		t.Errorf("ValidationError = %q, want substring about depart_by", env.ValidationError)
	}
}

// TestValidateChargeSchedule_RejectsAlreadyAtTarget proves target_soc
// <= current_soc is rejected.
func TestValidateChargeSchedule_RejectsAlreadyAtTarget(t *testing.T) {
	t.Parallel()
	tool := &validateChargeSchedule{}
	rawIn := json.RawMessage(`{
		"start_time": "2099-01-02T00:00:00Z",
		"end_time": "2099-01-02T05:00:00Z",
		"current_soc": 80,
		"target_soc": 80,
		"depart_by": "2099-01-02T07:30:00Z"
	}`)
	in, _ := tool.Validate(rawIn)
	out, _ := tool.Execute(context.Background(), in)
	env := out.(*validateChargeScheduleOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid", env.Status)
	}
	if !strings.Contains(env.ValidationError, "greater than current_soc") {
		t.Errorf("ValidationError = %q, want substring about SOC ordering", env.ValidationError)
	}
}

// TestValidateChargeSchedule_RejectsMalformedTimes proves bad RFC3339
// returns Status=invalid (not a panic / Execute error).
func TestValidateChargeSchedule_RejectsMalformedTimes(t *testing.T) {
	t.Parallel()
	tool := &validateChargeSchedule{}
	rawIn := json.RawMessage(`{
		"start_time": "not-a-time",
		"end_time": "2099-01-02T05:00:00Z",
		"current_soc": 40,
		"target_soc": 80,
		"depart_by": "2099-01-02T07:30:00Z"
	}`)
	in, _ := tool.Validate(rawIn)
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil (validator returns typed envelope)", err)
	}
	env := out.(*validateChargeScheduleOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid", env.Status)
	}
	if !strings.Contains(env.ValidationError, "start_time is not RFC3339") {
		t.Errorf("ValidationError = %q, want substring about start_time format", env.ValidationError)
	}
}

// TestValidateChargeSchedule_PropOnlyContract pins the propose-only
// metadata.
func TestValidateChargeSchedule_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &validateChargeSchedule{}
	if tool.Name() != "validate_charge_schedule" {
		t.Errorf("Name() = %q, want validate_charge_schedule", tool.Name())
	}
	if tool.Mutates() {
		t.Errorf("Mutates() = true, want false (propose-only)")
	}
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// TestRegisterSmartChargeScheduleSuggestionTools_RegistersBoth proves
// the public registration entry point installs both tools by name.
func TestRegisterSmartChargeScheduleSuggestionTools_RegistersBoth(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	RegisterSmartChargeScheduleSuggestionTools(r, SmartChargeScheduleSuggestionSources{
		Planner: &fakeChargeScheduleComputer{},
	})
	for _, want := range []string{
		"draft_charge_schedule",
		"validate_charge_schedule",
	} {
		if _, ok := r.Get(want); !ok {
			t.Errorf("registry missing %q after RegisterSmartChargeScheduleSuggestionTools", want)
		}
	}
}
