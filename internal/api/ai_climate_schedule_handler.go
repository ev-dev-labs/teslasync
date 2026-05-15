package api

// Phase-50 / 0031 — T1 Preheat and precool recommender.
//
// ai_climate_schedule_handler.go implements the LLM-backed
// handler at POST /api/v1/ai/climate/schedule/draft. The flow
// mirrors ai_smart_charge_schedule_handler.go (same dispatch+stream
// loop, no persistence — one-shot proposal):
//
//	URL  /api/v1/ai/climate/schedule/draft
//	  ↓
//	resolve provider via *provider.Registry.For("preheat-precool-recommender")
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("preheat-precool-recommender", …) so when
// ai_mode='off' or the per-feature toggle is off the guard returns
// 404 BEFORE this handler ever sees the request (ADR-015 §I6).
//
// The JSON body (vehicle_id, depart_by, current_cabin_temp_c,
// outside_temp_c, target_cabin_temp_c) is parsed BEFORE opening the
// SSE stream so a malformed input surfaces as a plain JSON 400
// (rather than a streamed error frame the SPA's QueryError will
// struggle to render meaningfully).
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic /climate /
//     /climate-control page — HVAC banner, status cards, manual
//     departure-time heuristic — is unchanged. This handler is an
//     OPT-IN add-on; off-mode users never see it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("preheat-precool-recommender").
//   - I8 propose-only:    the schedule is rendered in the AI panel
//     and the user must click the existing manual climate-controls
//     UI to apply. The AI never persists.
//   - I9 redaction:       PolicyPreheatPrecoolRecommender (allows
//     ClassVehicleName only; lat/long, addresses, and place names
//     stay tagged) is installed by dispatch.Run from the strategy.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline JSON shape
//     is added or modified by this slice.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	preheatprecoolrecommender "github.com/ev-dev-labs/teslasync/internal/ai/strategies/preheat-precool-recommender"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// aiClimateScheduleMaxIterations bounds the dispatcher's
// tool-loop. The strategy is at most draft_climate_schedule →
// validate_climate_schedule → answer (with optional retries). A
// hard ceiling of 8 is generous. Mirrors
// aiSmartChargeScheduleMaxIterations.
const aiClimateScheduleMaxIterations = 8

// preheatRateCelsiusPerMinute is the deterministic warm-up rate
// the AIClimateScheduleAdvisor uses to draft a preheat window.
// 0.5°C / minute matches the empirical Tesla cabin warm-up rate
// from a cold soak (-2°C outside, 4°C cabin → 21°C cabin in ~30
// minutes). Kept as a single named constant so a future revision
// can update both the SPA's manual heuristic and the AI
// proposal in lockstep.
const preheatRateCelsiusPerMinute = 0.5

// precoolRateCelsiusPerMinute is the deterministic cool-down
// rate the AIClimateScheduleAdvisor uses to draft a precool
// window. 0.6°C / minute matches the empirical Tesla cabin
// cool-down rate from a hot soak (34°C outside, 38°C cabin →
// 22°C cabin in ~25 minutes). Kept separate from the preheat
// rate because Tesla's HVAC compressor is more efficient than
// the resistive heater under typical conditions.
const precoolRateCelsiusPerMinute = 0.6

// climateScheduleMinWindowMinutes is the minimum window the
// drafter will propose. Matches the Tesla mobile app's smallest
// schedulable preheat duration so the AI proposal can be applied
// via the manual controls without rounding.
const climateScheduleMinWindowMinutes = 5

// climateScheduleMaxWindowMinutes is the maximum window the
// drafter will propose. Cabin warm-up plateaus around 60 minutes
// regardless of delta; quoting longer would suggest the AI is
// inventing a schedule rather than computing one. Kept as a
// constant so the goldens can pin the bound.
const climateScheduleMaxWindowMinutes = 60

// climateTargetMinC is the lower safety bound for the
// drafter's accepted target cabin temperature, matching the
// Tesla app's lower control limit (10°C / 50°F).
const climateTargetMinC = 10.0

// climateTargetMaxC is the upper safety bound for the drafter's
// accepted target cabin temperature, matching the Tesla app's
// upper control limit (32°C / ~89°F).
const climateTargetMaxC = 32.0

// aiClimateScheduleDraftRequest is the JSON body shape this
// handler accepts. Temperatures are Celsius (SI canonical —
// Phase-48); time fields are RFC3339. The shape mirrors the
// *typed* surface area of the existing manual climate-controls
// form so a SPA call site can construct the AI draft request from
// the same form state.
type aiClimateScheduleDraftRequest struct {
	VehicleID         int64   `json:"vehicle_id"`
	DepartBy          string  `json:"depart_by"` // RFC3339
	CurrentCabinTempC float64 `json:"current_cabin_temp_c"`
	OutsideTempC      float64 `json:"outside_temp_c"`
	TargetCabinTempC  float64 `json:"target_cabin_temp_c"`
}

// AIClimateScheduleHandler is the HTTP handler for
// POST /api/v1/ai/climate/schedule/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once at
// boot.
type AIClimateScheduleHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAIClimateScheduleHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on a
// nil so the wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	draft_climate_schedule AND validate_climate_schedule (both
//	registered by tools.RegisterPreheatPrecoolRecommenderTools
//	in router.go).
//
// strat:      the preheat-precool-recommender Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewAIClimateScheduleHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AIClimateScheduleHandler {
	switch {
	case registry == nil:
		panic("api: NewAIClimateScheduleHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAIClimateScheduleHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAIClimateScheduleHandler: nil strategy.Strategy")
	}
	return &AIClimateScheduleHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiClimateScheduleMaxIterations,
	}
}

// parseClimateScheduleDraftBody decodes + validates the JSON
// body. Pulled out so the validator-only test can exercise the
// same parsing without constructing a full handler with stub deps.
// The function writes a 400 on failure and returns the (req, ok)
// pair so the caller can early-return.
func parseClimateScheduleDraftBody(w http.ResponseWriter, r *http.Request) (*aiClimateScheduleDraftRequest, bool) {
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "request body is required")
		return nil, false
	}
	defer r.Body.Close()
	var req aiClimateScheduleDraftRequest
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
	if req.DepartBy == "" {
		writeError(w, http.StatusBadRequest, "depart_by is required")
		return nil, false
	}
	if _, err := time.Parse(time.RFC3339, req.DepartBy); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("depart_by must be RFC3339: %v", err))
		return nil, false
	}
	if req.CurrentCabinTempC < -40 || req.CurrentCabinTempC > 80 {
		writeError(w, http.StatusBadRequest, "current_cabin_temp_c must be in [-40, 80] °C")
		return nil, false
	}
	if req.OutsideTempC < -50 || req.OutsideTempC > 60 {
		writeError(w, http.StatusBadRequest, "outside_temp_c must be in [-50, 60] °C")
		return nil, false
	}
	if req.TargetCabinTempC < climateTargetMinC || req.TargetCabinTempC > climateTargetMaxC {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("target_cabin_temp_c must be in [%.0f, %.0f] °C", climateTargetMinC, climateTargetMaxC))
		return nil, false
	}
	return &req, true
}

// ServeHTTP implements [http.Handler]. The body is decoded, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes
// a structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *AIClimateScheduleHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the JSON body.
	body, ok := parseClimateScheduleDraftBody(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), preheatprecoolrecommender.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai preheat-precool-recommender: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, preheatprecoolrecommender.FeatureID)

	// 4) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(preheatprecoolrecommender.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai preheat-precool-recommender: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context.
	prov, err := h.registry.For(ctx, preheatprecoolrecommender.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai preheat-precool-recommender: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Climate-scheduling is NOT
	// conversational here — there is no chat history. We hand the
	// LLM a deterministic prompt that asks it to call the two
	// propose-only tools in order and narrate the result.
	userMsg := fmt.Sprintf(
		"Draft a preheat or precool schedule for vehicle %d. "+
			"depart_by is %q, current_cabin_temp_c is %.1f°C, outside_temp_c is %.1f°C, "+
			"target_cabin_temp_c is %.1f°C. "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call draft_climate_schedule with these arguments to delegate to the canonical "+
			"deterministic departure heuristic; "+
			"(2) call validate_climate_schedule with the start_time/end_time/depart_by/mode/"+
			"current_cabin_temp_c/target_cabin_temp_c the draft returned to confirm internal "+
			"consistency. "+
			"Narrate the resulting schedule in 2-3 sentences grounded strictly in the tool replies, "+
			"calling out start_time, end_time, mode (preheat | precool), and target_cabin_temp_c. "+
			"Remember: you NEVER save anything; the user reviews the structured proposal and clicks "+
			"the existing manual climate controls UI to save. End the narration with an explicit "+
			"\"review the proposal and click Apply on the climate controls below to save it\" line. "+
			"If draft_climate_schedule returns status='invalid', say so plainly rather than inventing "+
			"an alternate schedule.",
		body.VehicleID,
		body.DepartBy,
		body.CurrentCabinTempC, body.OutsideTempC,
		body.TargetCabinTempC,
	)

	// 8) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("vehicle_id", body.VehicleID).
			Msg("ai preheat-precool-recommender: dispatcher returned error")
	}
}

// Compile-time assertion: AIClimateScheduleHandler satisfies http.Handler.
var _ http.Handler = (*AIClimateScheduleHandler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the tool interface declared by
// internal/ai/tools/preheat_precool_recommender.go. Kept in the same
// file as the handler so the wiring intent is local to the slice;
// mirrors the smart-charge-schedule-suggestion slice's
// AIChargeScheduleComputer pattern.
//
// The advisor is a PURE-GO deterministic departure heuristic — it
// does not touch the database, does not call Tesla Fleet API, and
// does not consume any signal_log row. The slice prompt's
// "Selection mechanism: ClimateScheduleAdvisor is selected by
// ai_mode plus preheat-precool-recommender toggle; manual schedule
// remains baseline" mandate is satisfied by the absence of any
// write path: the user must click the canonical manual
// climate-controls Apply button to persist.
// ---------------------------------------------------------------------

// AIClimateScheduleAdvisor is the production
// tools.ClimateScheduleAdvisor. It runs a pure-Go deterministic
// departure heuristic over the typed inputs and returns a
// proposed window.
//
// Wall clock is injected via the Now field so tests can pin a
// stable timestamp without monkey-patching time.Now. Production
// uses time.Now().UTC() implicitly via the zero-value sentinel
// (Now.IsZero() ⇒ time.Now().UTC()).
type AIClimateScheduleAdvisor struct {
	// Now is the wall-clock function. Defaults to
	// time.Now().UTC() when nil; tests inject a stable clock.
	Now func() time.Time
}

// NewAIClimateScheduleAdvisor constructs the production advisor.
// The constructor takes no required arguments (the heuristic is
// pure-Go) — present for symmetry with NewAIChargeScheduleComputer.
func NewAIClimateScheduleAdvisor() *AIClimateScheduleAdvisor {
	return &AIClimateScheduleAdvisor{}
}

// DraftClimateSchedule implements tools.ClimateScheduleAdvisor.
//
// The deterministic heuristic:
//
//  1. Compute Δ = target_cabin_temp_c - current_cabin_temp_c.
//     |Δ| < 0.5°C ⇒ no schedule needed (return invalid envelope).
//  2. Mode = "preheat" iff Δ > 0; "precool" iff Δ < 0.
//  3. Window-minutes = ceil(|Δ| / rate(mode)) clamped to
//     [climateScheduleMinWindowMinutes, climateScheduleMaxWindowMinutes].
//  4. End-time = depart_by; start-time = end-time - window.
//  5. start-time MUST be >= now; otherwise the schedule is in the
//     past — return invalid envelope.
//
// Errors are returned as Go errors; the tool wraps them into the
// {status: "invalid"} envelope.
func (a *AIClimateScheduleAdvisor) DraftClimateSchedule(_ context.Context, req tools.ClimateScheduleDraftRequest) (*tools.ClimateScheduleDraftResult, error) {
	depart, err := time.Parse(time.RFC3339, req.DepartBy)
	if err != nil {
		return nil, fmt.Errorf("ai preheat-precool-recommender: depart_by parse: %w", err)
	}
	now := a.now()
	if !depart.After(now) {
		return nil, errors.New("depart_by is in the past or equal to now")
	}
	if req.TargetCabinTempC < climateTargetMinC || req.TargetCabinTempC > climateTargetMaxC {
		return nil, fmt.Errorf("target_cabin_temp_c (%.1f) must be in safe range [%.0f, %.0f]°C",
			req.TargetCabinTempC, climateTargetMinC, climateTargetMaxC)
	}
	delta := req.TargetCabinTempC - req.CurrentCabinTempC
	mode := ""
	rate := 0.0
	switch {
	case delta > 0.5:
		mode = "preheat"
		rate = preheatRateCelsiusPerMinute
	case delta < -0.5:
		mode = "precool"
		rate = precoolRateCelsiusPerMinute
	default:
		return nil, fmt.Errorf("cabin already within 0.5°C of target (current=%.1f, target=%.1f); no schedule needed",
			req.CurrentCabinTempC, req.TargetCabinTempC)
	}
	abs := delta
	if abs < 0 {
		abs = -abs
	}
	minutes := abs / rate
	// ceil to integer minutes so the proposed window is always
	// at least as long as the heuristic estimates.
	intMinutes := int(minutes)
	if float64(intMinutes) < minutes {
		intMinutes++
	}
	if intMinutes < climateScheduleMinWindowMinutes {
		intMinutes = climateScheduleMinWindowMinutes
	}
	if intMinutes > climateScheduleMaxWindowMinutes {
		intMinutes = climateScheduleMaxWindowMinutes
	}
	end := depart
	start := end.Add(-time.Duration(intMinutes) * time.Minute)
	if start.Before(now) {
		// User asked for a depart_by that doesn't leave room for the heuristic
		// window between now and depart_by. Surface honestly rather than
		// quietly slipping the start before the present moment.
		return nil, fmt.Errorf("depart_by (%s) is too soon — the proposed %d-minute %s window would start in the past",
			depart.UTC().Format(time.RFC3339), intMinutes, mode)
	}
	return &tools.ClimateScheduleDraftResult{
		VehicleID:         req.VehicleID,
		StartTime:         start.UTC(),
		EndTime:           end.UTC(),
		Mode:              mode,
		TargetCabinTempC:  req.TargetCabinTempC,
		CurrentCabinTempC: req.CurrentCabinTempC,
		OutsideTempC:      req.OutsideTempC,
		DepartBy:          depart.UTC(),
	}, nil
}

// now returns the wall clock with the tests-inject-a-stable-clock
// fallback. Kept private so external callers cannot bypass it.
func (a *AIClimateScheduleAdvisor) now() time.Time {
	if a.Now != nil {
		return a.Now().UTC()
	}
	return time.Now().UTC()
}

// Compile-time assertion: AIClimateScheduleAdvisor satisfies tools.ClimateScheduleAdvisor.
var _ tools.ClimateScheduleAdvisor = (*AIClimateScheduleAdvisor)(nil)
