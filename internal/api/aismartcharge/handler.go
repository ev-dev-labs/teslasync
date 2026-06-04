package aismartcharge

// Handler for smart-charge schedule suggestions.
//
// POST /api/v1/ai/charging/schedule/draft streams a propose-only schedule draft grounded in the canonical charge planner. The AI-gated route validates the form-shaped JSON body before opening SSE, never persists changes, and leaves the deterministic /smart-charge flow unchanged.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	smartchargeschedulesuggestion "github.com/ev-dev-labs/teslasync/internal/ai/strategies/smart-charge-schedule-suggestion"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/schedule"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// maxIterations bounds the dispatcher's
// tool-loop. The strategy is at most draft_charge_schedule →
// validate_charge_schedule → answer (with optional retries). A
// hard ceiling of 8 is generous. Mirrors
// aiTripPlannerLLMAgentMaxIterations.
const maxIterations = 8

// draftRequest is the JSON body shape this
// handler accepts. SOC fields are 0..100 percent; time fields are
// RFC3339; rate fields stay in their canonical units. The shape
// mirrors the *typed* surface area of POST
// /api/v1/charge-planner/optimize so a SPA call site can construct
// the AI draft request from the same form state.
type draftRequest struct {
	VehicleID       int64   `json:"vehicle_id"`
	TargetSOC       int     `json:"target_soc"`
	DepartBy        string  `json:"depart_by"` // RFC3339
	RatePlanID      string  `json:"rate_plan_id"`
	MaxAmps         int     `json:"max_amps,omitempty"`
	BatteryCapacity float64 `json:"battery_capacity_kwh,omitempty"`
	ChargerVoltage  int     `json:"charger_voltage,omitempty"`
	PreferOffPeak   bool    `json:"prefer_off_peak,omitempty"`
	CurrentSOC      int     `json:"current_soc"`
}

// Handler is the HTTP handler for
// POST /api/v1/ai/charging/schedule/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once at
// boot.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on a
// nil so the wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	draft_charge_schedule AND validate_charge_schedule (both
//	registered by schedule.RegisterSmartChargeScheduleSuggestionTools
//	in router.go).
//
// strat:      the smart-charge-schedule-suggestion Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aismartcharge: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aismartcharge: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aismartcharge: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// denyAllConfirm is a defence-in-depth confirm hook for propose-only AI tools.
func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// parseDraftBody decodes + validates the JSON
// body. Pulled out so the validator-only test can exercise the
// same parsing without constructing a full handler with stub deps.
// The function writes a 400 on failure and returns the (req, ok)
// pair so the caller can early-return.
func parseDraftBody(w http.ResponseWriter, r *http.Request) (*draftRequest, bool) {
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "request body is required")
		return nil, false
	}
	defer r.Body.Close()
	var req draftRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return nil, false
	}
	if req.VehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id must be > 0")
		return nil, false
	}
	if req.TargetSOC < 1 || req.TargetSOC > 100 {
		writeError(w, http.StatusBadRequest, "target_soc must be in [1, 100]")
		return nil, false
	}
	if req.CurrentSOC < 0 || req.CurrentSOC > 100 {
		writeError(w, http.StatusBadRequest, "current_soc must be in [0, 100]")
		return nil, false
	}
	if req.DepartBy == "" {
		writeError(w, http.StatusBadRequest, "depart_by is required")
		return nil, false
	}
	if _, err := time.Parse(time.RFC3339, req.DepartBy); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("depart_by must be RFC3339: %v", err))
		return nil, false
	}
	if req.RatePlanID == "" {
		writeError(w, http.StatusBadRequest, "rate_plan_id is required")
		return nil, false
	}
	if req.MaxAmps < 0 || req.MaxAmps > 80 {
		writeError(w, http.StatusBadRequest, "max_amps must be in [0, 80]")
		return nil, false
	}
	if req.BatteryCapacity < 0 || req.BatteryCapacity > 200 {
		writeError(w, http.StatusBadRequest, "battery_capacity_kwh must be in [0, 200]")
		return nil, false
	}
	if req.ChargerVoltage < 0 || req.ChargerVoltage > 600 {
		writeError(w, http.StatusBadRequest, "charger_voltage must be in [0, 600]")
		return nil, false
	}
	return &req, true
}

// ServeHTTP implements [http.Handler]. The body is decoded, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes
// a structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the JSON body.
	body, ok := parseDraftBody(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), smartchargeschedulesuggestion.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai smart-charge-schedule-suggestion: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, smartchargeschedulesuggestion.FeatureID)

	// 4) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(smartchargeschedulesuggestion.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai smart-charge-schedule-suggestion: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context.
	prov, err := h.registry.For(ctx, smartchargeschedulesuggestion.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai smart-charge-schedule-suggestion: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Charge-scheduling is NOT
	// conversational here — there is no chat history. We hand the
	// LLM a deterministic prompt that asks it to call the two
	// propose-only tools in order and narrate the result.
	userMsg := fmt.Sprintf(
		"Draft a charge schedule for vehicle %d. Target SOC is %d%%, current SOC is %d%%, "+
			"depart_by is %q, rate_plan_id is %q "+
			"(max_amps=%d, battery_capacity_kwh=%.1f, charger_voltage=%d, prefer_off_peak=%t). "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call draft_charge_schedule with these arguments to delegate to the canonical "+
			"ChargePlannerHandler.computeSchedule path; "+
			"(2) call validate_charge_schedule with the start_time/end_time/SOCs/depart_by the "+
			"draft returned to confirm internal consistency. "+
			"Narrate the resulting schedule in 2-3 sentences grounded strictly in the tool replies, "+
			"calling out start_time, end_time, rate_tier, estimated_cost, and savings. "+
			"Remember: you NEVER save anything; the user reviews the structured proposal and clicks "+
			"the canonical Schedule button to save. If draft_charge_schedule returns "+
			"status='invalid', say so plainly rather than inventing an alternate schedule.",
		body.VehicleID,
		body.TargetSOC, body.CurrentSOC,
		body.DepartBy, body.RatePlanID,
		body.MaxAmps, body.BatteryCapacity, body.ChargerVoltage, body.PreferOffPeak,
	)

	// 8) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("vehicle_id", body.VehicleID).
			Msg("ai smart-charge-schedule-suggestion: dispatcher returned error")
	}
}

// Compile-time assertion: Handler satisfies http.Handler.
var _ http.Handler = (*Handler)(nil)

// AIChargeScheduleComputer is the production schedule.ChargeScheduleComputer
// wrapper used by the smart-charge schedule suggestion tools. It
// delegates to the canonical charge planner implementation supplied by
// router.go and keeps the AI tool surface propose-only.
type AIChargeScheduleComputer struct {
	planner schedule.ChargeScheduleComputer
}

// NewAIChargeScheduleComputer constructs the adapter. Panics on nil so a
// wiring mistake surfaces at boot.
func NewAIChargeScheduleComputer(planner schedule.ChargeScheduleComputer) *AIChargeScheduleComputer {
	if planner == nil {
		panic("aismartcharge: NewAIChargeScheduleComputer: nil schedule.ChargeScheduleComputer")
	}
	return &AIChargeScheduleComputer{planner: planner}
}

// ComputeChargeSchedule implements schedule.ChargeScheduleComputer by
// delegating to the canonical charge planner.
func (a *AIChargeScheduleComputer) ComputeChargeSchedule(ctx context.Context, req schedule.ChargeScheduleComputeRequest) (*schedule.ChargeScheduleComputeResult, error) {
	return a.planner.ComputeChargeSchedule(ctx, req)
}

// Compile-time assertion: AIChargeScheduleComputer satisfies schedule.ChargeScheduleComputer.
var _ schedule.ChargeScheduleComputer = (*AIChargeScheduleComputer)(nil)
