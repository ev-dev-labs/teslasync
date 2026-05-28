// Phase-50 / 0031 — T1 Preheat and precool recommender.
//
// preheat_precool_recommender.go ships TWO new propose-only
// tools for the preheat-precool-recommender LLM strategy:
//
//   - `draft_climate_schedule` — delegates to a narrow
//     [ClimateScheduleAdvisor] port (production:
//     AIClimateScheduleAdvisor in
//     internal/api/ai_climate_schedule_handler.go) which runs a
//     deterministic departure-heuristic over the caller-supplied
//     vehicle_id, depart_by, current_cabin_temp_c, outside_temp_c,
//     and target_cabin_temp_c. Returns a typed schedule envelope
//     {start_time, end_time, mode (preheat | precool),
//     target_cabin_temp_c, current_cabin_temp_c, outside_temp_c,
//     depart_by, vehicle_id, status, source}. PROPOSE-only: no DB
//     write — the user reviews the proposed schedule in the AI
//     panel and explicitly clicks the existing canonical climate
//     controls UI to save / apply.
//
//   - `validate_climate_schedule` — pure-Go sanity check on a
//     drafted {start_time, end_time, depart_by, mode,
//     current_cabin_temp_c, target_cabin_temp_c} envelope.
//     Verifies start_time < end_time, end_time <= depart_by,
//     target_cabin_temp_c is in a safe range [10°C, 32°C], and
//     mode (preheat | precool) matches the direction of the
//     temperature delta. Returns {status: ok | invalid,
//     validation_error: string}. The LLM calls this AFTER
//     draft_climate_schedule so the narration only quotes a window
//     the drafter returned AND that passes the post-hoc consistency
//     check.
//
// Both tools are READ / pure-functional. The dispatcher's deny-all
// confirm gate is never reached in practice — defence in depth in
// case a future edit accidentally adds a write tool. The actual
// schedule save flows through an explicit user confirmation in the
// existing canonical climate controls UI; the LLM has no tool that
// writes.
//
// Design constraints (from the slice prompt):
//
//   - "Tools must call existing typed handlers or services; no
//     duplicate write paths." → draft_climate_schedule delegates to
//     a narrow ClimateScheduleAdvisor port satisfied at boot by an
//     adapter implementing the same deterministic departure
//     heuristic the SPA's manual climate-controls baseline runs —
//     no parallel SQL path, no parallel write path.
//
//   - "the LLM never writes raw SQL" → tools have no DB handle.
//     validate_climate_schedule is pure-Go arithmetic on the typed
//     envelope.
//
//   - "no duplicate write paths" → no create_* / update_* /
//     delete_* / save_* tool exists in this slice; both tools are
//     propose-only and draft_climate_schedule reuses the canonical
//     deterministic heuristic.

package schedule

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// ---------------------------------------------------------------------------
// draft_climate_schedule
// ---------------------------------------------------------------------------

// ClimateScheduleDraftRequest is the typed request envelope
// draft_climate_schedule passes to the [ClimateScheduleAdvisor] port.
//
// All temperatures are in Celsius (SI canonical — Phase-48). All
// timestamps are RFC3339. SOC is unused by the deterministic
// heuristic today (cabin temperature delta + outside temperature
// determine the warm-up / cool-down rate, not battery state) but
// is reserved as a future signal so the port can grow without a
// breaking change.
type ClimateScheduleDraftRequest struct {
	VehicleID         int64
	DepartBy          string  // RFC3339
	CurrentCabinTempC float64 // °C
	OutsideTempC      float64 // °C
	TargetCabinTempC  float64 // °C
	Now               string  // RFC3339; optional override (tests inject a stable wall clock)
}

// ClimateScheduleDraftResult is the typed result envelope
// draft_climate_schedule returns. Mirrors the shape the AI panel
// renders so the LLM narration can quote any field by name.
//
// Mode is a string ("preheat" | "precool") rather than a typed
// enum so the JSON payload stays self-describing in the SSE
// stream (the SPA's `useAiStream` consumer reads this verbatim).
type ClimateScheduleDraftResult struct {
	VehicleID         int64     `json:"vehicle_id"`
	StartTime         time.Time `json:"start_time"`
	EndTime           time.Time `json:"end_time"`
	Mode              string    `json:"mode"`
	TargetCabinTempC  float64   `json:"target_cabin_temp_c"`
	CurrentCabinTempC float64   `json:"current_cabin_temp_c"`
	OutsideTempC      float64   `json:"outside_temp_c"`
	DepartBy          time.Time `json:"depart_by"`
}

// ClimateScheduleAdvisor is the narrow port the
// draft_climate_schedule tool delegates to. In production it is
// satisfied by *api.AIClimateScheduleAdvisor; tests substitute
// deterministic fakes so the tool unit tests stay hermetic.
//
// The interface MUST stay read-only — adding a Save / Apply method
// here would defeat the propose-only contract that ADR-015 §I3 +
// the slice prompt mandate.
type ClimateScheduleAdvisor interface {
	// DraftClimateSchedule runs the deterministic departure
	// heuristic and returns a typed envelope describing the
	// proposed preheat or precool window. Returns a non-nil
	// error for user-input / feasibility problems
	// (target_cabin_temp_c out of safe range, depart_by in the
	// past, current and target cabin temperatures already
	// equal) — the tool surfaces these to the LLM as a typed
	// {status: "invalid", validation_error: "..."} envelope
	// rather than crashing the dispatcher.
	DraftClimateSchedule(ctx context.Context, req ClimateScheduleDraftRequest) (*ClimateScheduleDraftResult, error)
}

// draftClimateScheduleInput is the typed input shape for
// draft_climate_schedule. Temperatures are Celsius; time fields
// are RFC3339. The LLM is expected to copy these from the
// caller-supplied prompt verbatim; the strategy's system prompt
// pins the call shape.
type draftClimateScheduleInput struct {
	VehicleID         int64   `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID."`
	DepartBy          string  `json:"depart_by" validate:"required" desc:"Latest departure timestamp in RFC3339 format (UTC)."`
	CurrentCabinTempC float64 `json:"current_cabin_temp_c" validate:"gte=-40,lte=80" desc:"Current cabin temperature in Celsius (-40..80)."`
	OutsideTempC      float64 `json:"outside_temp_c" validate:"gte=-50,lte=60" desc:"Current outside temperature in Celsius (-50..60)."`
	TargetCabinTempC  float64 `json:"target_cabin_temp_c" validate:"required,gte=10,lte=32" desc:"Target cabin temperature in Celsius (10..32)."`
}

// draftClimateScheduleOutput is the JSON envelope
// draft_climate_schedule returns. Schedule is non-nil iff Status
// == "ok"; ValidationError is set only when Status == "invalid".
// Source gives the LLM a breadcrumb to attribute the decision to
// the canonical advisor rather than its own reasoning.
type draftClimateScheduleOutput struct {
	Schedule        *ClimateScheduleDraftResult `json:"schedule"`
	Status          string                      `json:"status"`
	Source          string                      `json:"source"`
	ValidationError string                      `json:"validation_error,omitempty"`
}

// draftClimateSchedule is the propose-only tool that delegates to
// the canonical deterministic departure heuristic.
// PROPOSE-only: the returned envelope is rendered to the user for
// review; no DB write occurs. The user saves / applies via the
// existing manual climate controls UI by clicking the canonical
// Apply button on the ClimateControlPage.
type draftClimateSchedule struct {
	advisor ClimateScheduleAdvisor
}

// Name implements [Tool].
func (t *draftClimateSchedule) Name() string { return "draft_climate_schedule" }

// Description implements [Tool].
func (t *draftClimateSchedule) Description() string {
	return "Build a typed preheat/precool schedule proposal by delegating to the canonical deterministic departure heuristic. " +
		"PROPOSE-ONLY: the schedule is NOT saved; the user reviews the draft in the UI before clicking the " +
		"canonical Apply button on the climate controls. Returns {schedule: {vehicle_id, start_time, end_time, " +
		"mode (preheat|precool), target_cabin_temp_c, current_cabin_temp_c, outside_temp_c, depart_by}, " +
		"status, source}. Call this FIRST in the tool sequence, before validate_climate_schedule."
}

// InputSchema implements [Tool].
func (t *draftClimateSchedule) InputSchema() json.RawMessage {
	return tools.CachedSchema(draftClimateScheduleInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *draftClimateSchedule) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
func (t *draftClimateSchedule) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *draftClimateSchedule) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *draftClimateSchedule) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[draftClimateScheduleInput](raw)
}

// Execute implements [Tool]. Delegates to the
// ClimateScheduleAdvisor port.
func (t *draftClimateSchedule) Execute(ctx context.Context, in any) (any, error) {
	input := in.(draftClimateScheduleInput)
	if t.advisor == nil {
		return nil, errors.New("draft_climate_schedule: no ClimateScheduleAdvisor wired")
	}
	req := ClimateScheduleDraftRequest{
		VehicleID:         input.VehicleID,
		DepartBy:          input.DepartBy,
		CurrentCabinTempC: input.CurrentCabinTempC,
		OutsideTempC:      input.OutsideTempC,
		TargetCabinTempC:  input.TargetCabinTempC,
	}
	plan, err := t.advisor.DraftClimateSchedule(ctx, req)
	if err != nil {
		// Surface user-input / feasibility errors to the LLM
		// as a typed {status:"invalid"} envelope so the model
		// can narrate the refusal honestly rather than the
		// dispatcher killing the stream.
		return &draftClimateScheduleOutput{
			Schedule:        nil,
			Status:          "invalid",
			Source:          "compute: internal/api/ai_climate_schedule_handler.go AIClimateScheduleAdvisor.DraftClimateSchedule",
			ValidationError: err.Error(),
		}, nil
	}
	if plan == nil {
		return nil, errors.New("draft_climate_schedule: advisor returned nil envelope")
	}
	return &draftClimateScheduleOutput{
		Schedule: plan,
		Status:   "ok",
		Source:   "compute: internal/api/ai_climate_schedule_handler.go AIClimateScheduleAdvisor.DraftClimateSchedule",
	}, nil
}

// ---------------------------------------------------------------------------
// validate_climate_schedule
// ---------------------------------------------------------------------------

// validateClimateScheduleInput is the typed input shape for
// validate_climate_schedule. Temperatures are Celsius; time fields
// are RFC3339. The LLM is expected to copy these from the
// draft_climate_schedule output verbatim so the validator can prove
// post-hoc consistency.
type validateClimateScheduleInput struct {
	StartTime         string  `json:"start_time" validate:"required" desc:"Proposed window start in RFC3339."`
	EndTime           string  `json:"end_time" validate:"required" desc:"Proposed window end in RFC3339."`
	DepartBy          string  `json:"depart_by" validate:"required" desc:"Latest departure timestamp in RFC3339."`
	Mode              string  `json:"mode" validate:"required,oneof=preheat precool" desc:"Schedule mode: preheat | precool."`
	CurrentCabinTempC float64 `json:"current_cabin_temp_c" validate:"gte=-40,lte=80" desc:"Current cabin temperature in Celsius."`
	TargetCabinTempC  float64 `json:"target_cabin_temp_c" validate:"required,gte=10,lte=32" desc:"Target cabin temperature in Celsius (10..32)."`
}

// validateClimateScheduleOutput is the JSON envelope
// validate_climate_schedule returns. Status is "ok" iff every
// invariant passes; otherwise "invalid" and ValidationError carries
// a single line describing the first violation.
type validateClimateScheduleOutput struct {
	Status          string `json:"status"`
	ValidationError string `json:"validation_error,omitempty"`
}

// validateClimateSchedule is the propose-only tool that runs the
// pure-Go sanity check. No DB / network / clock state is consulted
// (the check is purely about whether the timestamps + temperatures
// are internally consistent).
type validateClimateSchedule struct{}

// Name implements [Tool].
func (t *validateClimateSchedule) Name() string { return "validate_climate_schedule" }

// Description implements [Tool].
func (t *validateClimateSchedule) Description() string {
	return "Validate that a drafted climate-schedule envelope is internally consistent: start_time < end_time, " +
		"end_time <= depart_by, target_cabin_temp_c in [10,32]°C, and mode (preheat | precool) matches the " +
		"direction of the temperature delta (preheat ⇒ target > current, precool ⇒ target < current). " +
		"PROPOSE-ONLY: never persists. Returns {status: ok|invalid, validation_error: string}. " +
		"Call this SECOND in the tool sequence, after draft_climate_schedule."
}

// InputSchema implements [Tool].
func (t *validateClimateSchedule) InputSchema() json.RawMessage {
	return tools.CachedSchema(validateClimateScheduleInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *validateClimateSchedule) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
func (t *validateClimateSchedule) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *validateClimateSchedule) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *validateClimateSchedule) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[validateClimateScheduleInput](raw)
}

// Execute implements [Tool]. Pure-Go sanity check.
func (t *validateClimateSchedule) Execute(_ context.Context, in any) (any, error) {
	input := in.(validateClimateScheduleInput)
	start, err := time.Parse(time.RFC3339, input.StartTime)
	if err != nil {
		return &validateClimateScheduleOutput{
			Status:          "invalid",
			ValidationError: fmt.Sprintf("start_time is not RFC3339: %v", err),
		}, nil
	}
	end, err := time.Parse(time.RFC3339, input.EndTime)
	if err != nil {
		return &validateClimateScheduleOutput{
			Status:          "invalid",
			ValidationError: fmt.Sprintf("end_time is not RFC3339: %v", err),
		}, nil
	}
	depart, err := time.Parse(time.RFC3339, input.DepartBy)
	if err != nil {
		return &validateClimateScheduleOutput{
			Status:          "invalid",
			ValidationError: fmt.Sprintf("depart_by is not RFC3339: %v", err),
		}, nil
	}
	if !end.After(start) {
		return &validateClimateScheduleOutput{
			Status:          "invalid",
			ValidationError: "end_time must be strictly after start_time",
		}, nil
	}
	if end.After(depart) {
		return &validateClimateScheduleOutput{
			Status:          "invalid",
			ValidationError: "end_time must be at or before depart_by",
		}, nil
	}
	if input.TargetCabinTempC < 10 || input.TargetCabinTempC > 32 {
		return &validateClimateScheduleOutput{
			Status:          "invalid",
			ValidationError: fmt.Sprintf("target_cabin_temp_c (%.1f) must be in safe range [10, 32]°C", input.TargetCabinTempC),
		}, nil
	}
	switch input.Mode {
	case "preheat":
		if input.TargetCabinTempC <= input.CurrentCabinTempC {
			return &validateClimateScheduleOutput{
				Status: "invalid",
				ValidationError: fmt.Sprintf(
					"preheat requires target_cabin_temp_c (%.1f) > current_cabin_temp_c (%.1f)",
					input.TargetCabinTempC, input.CurrentCabinTempC),
			}, nil
		}
	case "precool":
		if input.TargetCabinTempC >= input.CurrentCabinTempC {
			return &validateClimateScheduleOutput{
				Status: "invalid",
				ValidationError: fmt.Sprintf(
					"precool requires target_cabin_temp_c (%.1f) < current_cabin_temp_c (%.1f)",
					input.TargetCabinTempC, input.CurrentCabinTempC),
			}, nil
		}
	default:
		return &validateClimateScheduleOutput{
			Status:          "invalid",
			ValidationError: fmt.Sprintf("mode %q must be preheat or precool", input.Mode),
		}, nil
	}
	return &validateClimateScheduleOutput{Status: "ok"}, nil
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// PreheatPrecoolRecommenderSources bundles the narrow advisor
// interface RegisterPreheatPrecoolRecommenderTools needs.
// Mirrors [SmartChargeScheduleSuggestionSources].
//
// Production wiring (router.go) instantiates the production adapter
// (*api.AIClimateScheduleAdvisor); tests substitute deterministic
// fakes.
type PreheatPrecoolRecommenderSources struct {
	Advisor ClimateScheduleAdvisor
}

// RegisterPreheatPrecoolRecommenderTools installs the
// preheat-precool-recommender slice's tools on r. Called from
// router.go AFTER the vampire-drain-explanation tool registration
// so the registry's alphabetical Names list grows deterministically
// without disturbing earlier registrations or any builtin-names
// pin tests.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first
// request.
func RegisterPreheatPrecoolRecommenderTools(r *tools.Registry, s PreheatPrecoolRecommenderSources) {
	r.Register(&draftClimateSchedule{advisor: s.Advisor})
	r.Register(&validateClimateSchedule{})
}
