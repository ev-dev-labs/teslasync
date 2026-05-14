// Phase-50 / 0026 — C1 Smart-charge schedule suggestion.
//
// smart_charge_schedule_suggestion.go ships TWO new propose-only
// tools for the smart-charge-schedule-suggestion LLM strategy:
//
//   - `draft_charge_schedule` — delegates to the canonical
//     *ChargePlannerHandler.computeSchedule path via a narrow
//     [ChargeScheduleComputer] port (production:
//     AIChargeScheduleComputer in
//     internal/api/ai_smart_charge_schedule_handler.go) and returns
//     the same envelope POST /api/v1/charge-planner/optimize
//     produces today (plan_id=0, current_soc, target_soc, kwh_needed,
//     estimated_duration_hours, schedule {start_time, end_time,
//     rate_cents_kwh, estimated_cost, rate_tier}, comparison
//     {charge_now_cost, optimized_cost, savings, savings_percent},
//     alternative_windows, hourly_rates). PROPOSE-only: no DB write
//     — the user reviews the proposed schedule in the AI panel and
//     explicitly clicks the existing canonical Schedule button in
//     the SmartChargePage UI to save / apply.
//
//   - `validate_charge_schedule` — pure-Go sanity check on a draft
//     {start_time, end_time, current_soc, target_soc, depart_by}
//     envelope. Verifies start_time < end_time, end_time <=
//     depart_by, target_soc in (current_soc, 100], and that the
//     window is positive-duration. Returns {status: ok | invalid,
//     validation_error: string}. The LLM calls this AFTER
//     draft_charge_schedule so the narration only quotes a window
//     the planner returned AND that passes the post-hoc consistency
//     check.
//
// Both tools are READ / pure-functional. The dispatcher's deny-all
// confirm gate is never reached in practice — defence in depth in
// case a future edit accidentally adds a write tool. The actual
// schedule save flows through an explicit user confirmation in the
// SmartChargePage UI; the LLM has no tool that writes.
//
// Design constraints (from the slice prompt):
//
//   - "Tools must call existing typed handlers or services; no
//     duplicate write paths." → draft_charge_schedule delegates to
//     a narrow ChargeScheduleComputer port satisfied at boot by an
//     adapter wrapping the existing *api.ChargePlannerHandler — the
//     same code path the deterministic baseline runs.
//
//   - "the LLM never writes raw SQL" → tools have no DB handle.
//     validate_charge_schedule is pure-Go arithmetic on the typed
//     envelope.
//
//   - "no duplicate write paths" → no create_* / update_* /
//     delete_* / save_* tool exists in this slice; both tools are
//     propose-only and draft_charge_schedule reuses the canonical
//     compute path.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// ---------------------------------------------------------------------------
// draft_charge_schedule
// ---------------------------------------------------------------------------

// ChargeScheduleComputeRequest is the typed request envelope
// draft_charge_schedule passes to the [ChargeScheduleComputer] port.
// Mirrors the field-for-field shape of *api.optimizeRequest +
// {currentSOC, departBy parsed time, now} so the production adapter
// (in internal/api/ai_smart_charge_schedule_handler.go) can translate
// without loss, and tests can substitute a deterministic fake without
// pulling internal/api into the tools package.
//
// All fields are SI-or-percent-canonical (SOC in 0..100, kWh, volts,
// amps). The adapter is responsible for any unit conversion if the
// underlying computeSchedule signature ever drifts; today
// computeSchedule mirrors these names so the translation is
// field-for-field.
type ChargeScheduleComputeRequest struct {
	VehicleID       int64
	TargetSOC       int     // 0..100, percent
	DepartBy        string  // RFC3339
	RatePlanID      string  // e.g. "pge-ev2a"
	MaxAmps         int     // optional, default 32 (capped at 80)
	BatteryCapacity float64 // kWh; optional, default 75
	ChargerVoltage  int     // optional, default 240
	PreferOffPeak   bool
	CurrentSOC      int // 0..100, percent
}

// ChargeWindow mirrors *api.chargeWindow. SI-equivalent for time;
// rate fields stay in cents/kWh and $/window to match the rate plan
// data already shipped to the SmartChargePage UI.
type ChargeWindow struct {
	StartTime    time.Time `json:"start_time"`
	EndTime      time.Time `json:"end_time"`
	RateCentsKWh float64   `json:"rate_cents_kwh"`
	EstCost      float64   `json:"estimated_cost"`
	RateTier     string    `json:"rate_tier"`
}

// CostComparison mirrors *api.costComparison.
type CostComparison struct {
	ChargeNowCost float64 `json:"charge_now_cost"`
	OptimizedCost float64 `json:"optimized_cost"`
	Savings       float64 `json:"savings"`
	SavingsPct    float64 `json:"savings_percent"`
}

// HourlyRate mirrors *api.hourlyRate.
type HourlyRate struct {
	Hour      int     `json:"hour"`
	RateCents float64 `json:"rate_cents"`
	Tier      string  `json:"tier"`
}

// ChargeScheduleComputeResult is the typed result envelope
// draft_charge_schedule returns. Mirrors *api.optimizeResponse
// field-for-field, except PlanID is always 0 because this tool
// path never persists.
type ChargeScheduleComputeResult struct {
	PlanID           int64          `json:"plan_id"`
	CurrentSOC       int            `json:"current_soc"`
	TargetSOC        int            `json:"target_soc"`
	KWhNeeded        float64        `json:"kwh_needed"`
	EstDurationHours float64        `json:"estimated_duration_hours"`
	Schedule         ChargeWindow   `json:"schedule"`
	Comparison       CostComparison `json:"comparison"`
	Alternatives     []ChargeWindow `json:"alternative_windows"`
	HourlyRates      []HourlyRate   `json:"hourly_rates"`
}

// ChargeScheduleComputer is the narrow port the
// draft_charge_schedule tool delegates to. In production it is
// satisfied by *api.AIChargeScheduleComputer (wraps
// *api.ChargePlannerHandler); tests substitute deterministic fakes
// so the tool unit tests stay hermetic.
//
// The interface MUST stay read-only — adding a Save / Update method
// here would defeat the propose-only contract that ADR-015 §I3 +
// the slice prompt mandate.
type ChargeScheduleComputer interface {
	// ComputeChargeSchedule delegates to the canonical
	// *ChargePlannerHandler.computeSchedule path and returns
	// the same envelope the deterministic baseline produces.
	// Returns a non-nil error for user-input / feasibility
	// problems (already-at-target SOC, no-valid-window) — the
	// tool surfaces these to the LLM as a typed
	// {status: "invalid", validation_error: "..."} envelope
	// rather than crashing the dispatcher.
	ComputeChargeSchedule(ctx context.Context, req ChargeScheduleComputeRequest) (*ChargeScheduleComputeResult, error)
}

// draftChargeScheduleInput is the typed input shape for
// draft_charge_schedule. SOC fields are percent (0..100); time
// fields are RFC3339; rate fields stay in their canonical units.
type draftChargeScheduleInput struct {
	VehicleID  int64  `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID."`
	TargetSOC  int    `json:"target_soc" validate:"required,gte=1,lte=100" desc:"Target state-of-charge percent (1..100)."`
	DepartBy   string `json:"depart_by" validate:"required" desc:"Latest departure timestamp in RFC3339 format (UTC)."`
	RatePlanID string `json:"rate_plan_id" validate:"required" desc:"Rate plan ID, e.g. pge-ev2a, sce-tou-d-prime."`
	// MaxAmps / BatteryCapacity / ChargerVoltage are optional;
	// defaults applied in Execute when zero so the AI-side
	// default is byte-identical to the canonical Optimize
	// handler.
	MaxAmps         int     `json:"max_amps,omitempty" validate:"gte=0,lte=80" desc:"Charger amperage cap (1..80); default 32 when zero."`
	BatteryCapacity float64 `json:"battery_capacity_kwh,omitempty" validate:"gte=0,lte=200" desc:"Battery capacity in kWh; default 75 when zero."`
	ChargerVoltage  int     `json:"charger_voltage,omitempty" validate:"gte=0,lte=600" desc:"Charger voltage; default 240 when zero."`
	PreferOffPeak   bool    `json:"prefer_off_peak,omitempty" desc:"Hint to prefer off-peak tiers when costs are tied."`
	// CurrentSOC is the starting battery state. Required +
	// 0..100 — a zero SOC is treated as a programming error
	// rather than a "no info" hint so the tool's behaviour is
	// deterministic.
	CurrentSOC int `json:"current_soc" validate:"gte=0,lte=100" desc:"Starting SOC percent (0..100)."`
}

// draftChargeScheduleOutput is the JSON envelope
// draft_charge_schedule returns. The Schedule field is
// byte-equivalent (modulo JSON-tag spelling) to what
// *ChargePlannerHandler.computeSchedule returns; Status / Source
// give the LLM breadcrumbs to attribute the decision to the
// canonical planner rather than its own reasoning.
type draftChargeScheduleOutput struct {
	Schedule        *ChargeScheduleComputeResult `json:"schedule"`
	Status          string                       `json:"status"`
	Source          string                       `json:"source"`
	ValidationError string                       `json:"validation_error,omitempty"`
}

// draftChargeSchedule is the propose-only tool that delegates to
// the canonical *ChargePlannerHandler.computeSchedule path.
// PROPOSE-only: the returned envelope is rendered to the user for
// review; no DB write occurs. The user saves / applies via the
// existing POST /api/v1/charge-planner/optimize +
// /api/v1/charge-planner/apply paths by clicking the canonical
// Schedule button in the SmartChargePage UI.
type draftChargeSchedule struct {
	planner ChargeScheduleComputer
}

// Name implements [Tool].
func (t *draftChargeSchedule) Name() string { return "draft_charge_schedule" }

// Description implements [Tool].
func (t *draftChargeSchedule) Description() string {
	return "Build a typed charge-schedule proposal by delegating to the canonical ChargePlannerHandler.computeSchedule path. " +
		"PROPOSE-ONLY: the schedule is NOT saved; the user reviews the draft in the UI before clicking the " +
		"canonical Schedule button. Returns {schedule: {plan_id=0, current_soc, target_soc, kwh_needed, " +
		"estimated_duration_hours, schedule {start_time, end_time, rate_cents_kwh, estimated_cost, rate_tier}, " +
		"comparison, alternative_windows, hourly_rates}, status, source}. " +
		"Call this FIRST in the tool sequence, before validate_charge_schedule."
}

// InputSchema implements [Tool].
func (t *draftChargeSchedule) InputSchema() json.RawMessage {
	return cachedSchema(draftChargeScheduleInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *draftChargeSchedule) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
func (t *draftChargeSchedule) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *draftChargeSchedule) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *draftChargeSchedule) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[draftChargeScheduleInput](raw)
}

// Execute implements [Tool]. Delegates to the
// ChargeScheduleComputer port.
func (t *draftChargeSchedule) Execute(ctx context.Context, in any) (any, error) {
	input := in.(draftChargeScheduleInput)
	if t.planner == nil {
		return nil, errors.New("draft_charge_schedule: no ChargeScheduleComputer wired")
	}
	// Mirror *ChargePlannerHandler.Optimize defaults so the
	// AI-side default is byte-identical to the baseline.
	maxAmps := input.MaxAmps
	if maxAmps <= 0 {
		maxAmps = 32
	}
	if maxAmps > 80 {
		maxAmps = 80
	}
	batteryCap := input.BatteryCapacity
	if batteryCap <= 0 {
		batteryCap = 75.0
	}
	voltage := input.ChargerVoltage
	if voltage <= 0 {
		voltage = 240
	}

	req := ChargeScheduleComputeRequest{
		VehicleID:       input.VehicleID,
		TargetSOC:       input.TargetSOC,
		DepartBy:        input.DepartBy,
		RatePlanID:      input.RatePlanID,
		MaxAmps:         maxAmps,
		BatteryCapacity: batteryCap,
		ChargerVoltage:  voltage,
		PreferOffPeak:   input.PreferOffPeak,
		CurrentSOC:      input.CurrentSOC,
	}

	plan, err := t.planner.ComputeChargeSchedule(ctx, req)
	if err != nil {
		// Surface user-input / feasibility errors to the LLM
		// as a typed {status:"invalid"} envelope so the model
		// can narrate the refusal honestly rather than the
		// dispatcher killing the stream.
		return &draftChargeScheduleOutput{
			Schedule:        nil,
			Status:          "invalid",
			Source:          "compute: internal/api/charge_planner_handler.go ChargePlannerHandler.computeSchedule",
			ValidationError: err.Error(),
		}, nil
	}
	if plan == nil {
		return nil, errors.New("draft_charge_schedule: planner returned nil envelope")
	}
	return &draftChargeScheduleOutput{
		Schedule: plan,
		Status:   "ok",
		Source:   "compute: internal/api/charge_planner_handler.go ChargePlannerHandler.computeSchedule",
	}, nil
}

// ---------------------------------------------------------------------------
// validate_charge_schedule
// ---------------------------------------------------------------------------

// validateChargeScheduleInput is the typed input shape for
// validate_charge_schedule. SOC fields are percent (0..100); time
// fields are RFC3339. The LLM is expected to copy these from the
// draft_charge_schedule output verbatim so the validator can prove
// post-hoc consistency.
type validateChargeScheduleInput struct {
	StartTime  string `json:"start_time" validate:"required" desc:"Proposed window start in RFC3339."`
	EndTime    string `json:"end_time" validate:"required" desc:"Proposed window end in RFC3339."`
	CurrentSOC int    `json:"current_soc" validate:"gte=0,lte=100" desc:"Starting SOC percent (0..100)."`
	TargetSOC  int    `json:"target_soc" validate:"required,gte=1,lte=100" desc:"Target SOC percent (1..100)."`
	DepartBy   string `json:"depart_by" validate:"required" desc:"Latest departure timestamp in RFC3339."`
}

// validateChargeScheduleOutput is the JSON envelope
// validate_charge_schedule returns. Status is "ok" iff every
// invariant passes; otherwise "invalid" and ValidationError carries
// a single line describing the first violation.
type validateChargeScheduleOutput struct {
	Status          string `json:"status"`
	ValidationError string `json:"validation_error,omitempty"`
}

// validateChargeSchedule is the propose-only tool that runs the
// pure-Go sanity check. No DB / network / clock state is consulted
// (the check is purely about whether the four timestamps + two SOCs
// are internally consistent).
type validateChargeSchedule struct{}

// Name implements [Tool].
func (t *validateChargeSchedule) Name() string { return "validate_charge_schedule" }

// Description implements [Tool].
func (t *validateChargeSchedule) Description() string {
	return "Validate that a drafted charge-schedule envelope is internally consistent: start_time < end_time, " +
		"end_time <= depart_by, target_soc > current_soc, and window-duration is positive. " +
		"PROPOSE-ONLY: never persists. Returns {status: ok|invalid, validation_error: string}. " +
		"Call this SECOND in the tool sequence, after draft_charge_schedule."
}

// InputSchema implements [Tool].
func (t *validateChargeSchedule) InputSchema() json.RawMessage {
	return cachedSchema(validateChargeScheduleInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *validateChargeSchedule) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
func (t *validateChargeSchedule) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *validateChargeSchedule) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *validateChargeSchedule) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[validateChargeScheduleInput](raw)
}

// Execute implements [Tool]. Pure-Go sanity check.
func (t *validateChargeSchedule) Execute(_ context.Context, in any) (any, error) {
	input := in.(validateChargeScheduleInput)
	start, err := time.Parse(time.RFC3339, input.StartTime)
	if err != nil {
		return &validateChargeScheduleOutput{
			Status:          "invalid",
			ValidationError: fmt.Sprintf("start_time is not RFC3339: %v", err),
		}, nil
	}
	end, err := time.Parse(time.RFC3339, input.EndTime)
	if err != nil {
		return &validateChargeScheduleOutput{
			Status:          "invalid",
			ValidationError: fmt.Sprintf("end_time is not RFC3339: %v", err),
		}, nil
	}
	depart, err := time.Parse(time.RFC3339, input.DepartBy)
	if err != nil {
		return &validateChargeScheduleOutput{
			Status:          "invalid",
			ValidationError: fmt.Sprintf("depart_by is not RFC3339: %v", err),
		}, nil
	}
	if !end.After(start) {
		return &validateChargeScheduleOutput{
			Status:          "invalid",
			ValidationError: "end_time must be strictly after start_time",
		}, nil
	}
	if end.After(depart) {
		return &validateChargeScheduleOutput{
			Status:          "invalid",
			ValidationError: "end_time must be at or before depart_by",
		}, nil
	}
	if input.TargetSOC <= input.CurrentSOC {
		return &validateChargeScheduleOutput{
			Status:          "invalid",
			ValidationError: fmt.Sprintf("target_soc (%d) must be greater than current_soc (%d)", input.TargetSOC, input.CurrentSOC),
		}, nil
	}
	return &validateChargeScheduleOutput{Status: "ok"}, nil
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// SmartChargeScheduleSuggestionSources bundles the narrow compute
// interface RegisterSmartChargeScheduleSuggestionTools needs.
// Mirrors [TripPlannerLLMAgentSources].
//
// Production wiring (router.go) instantiates the production adapter
// (*api.AIChargeScheduleComputer); tests substitute deterministic
// fakes.
type SmartChargeScheduleSuggestionSources struct {
	Planner ChargeScheduleComputer
}

// RegisterSmartChargeScheduleSuggestionTools installs the
// smart-charge-schedule-suggestion slice's tools on r. Called from
// router.go AFTER the trip-planner-llm-agent tool registration so
// the registry's alphabetical Names list grows deterministically
// without disturbing earlier registrations or any builtin-names
// pin tests.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first
// request.
func RegisterSmartChargeScheduleSuggestionTools(r *Registry, s SmartChargeScheduleSuggestionSources) {
	r.Register(&draftChargeSchedule{planner: s.Planner})
	r.Register(&validateChargeSchedule{})
}
