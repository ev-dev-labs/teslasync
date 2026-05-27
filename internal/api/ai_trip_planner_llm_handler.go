package api

// Phase-50 / 0025 — D5 Trip planner LLM agent.
//
// ai_trip_planner_llm_handler.go implements the LLM-backed handler
// at POST /api/v1/ai/trips/plan/draft. The flow mirrors the
// auto-trip-naming / route-efficiency-suggestions narration handlers
// — same dispatch+stream loop, no persistence (one-shot proposal;
// no conversation to record):
//
//	URL  /api/v1/ai/trips/plan/draft
//	  ↓
//	resolve provider via *provider.Registry.For("trip-planner-llm-agent")
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("trip-planner-llm-agent", …) so when ai_mode='off' or
// the per-feature toggle is off the guard returns 404 BEFORE this
// handler ever sees the request (ADR-015 §I6).
//
// The JSON body (origin, destination, current_soc, optional knobs)
// is parsed BEFORE opening the SSE stream so a malformed input
// surfaces as a plain JSON 400 (rather than a streamed error frame
// the SPA's QueryError will struggle to render meaningfully).
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic /trip-planner page —
//     manual form + canonical Plan button hitting
//     POST /api/v1/trip-planner/plan — is unchanged. This handler is
//     an OPT-IN add-on; off-mode users never see it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("trip-planner-llm-agent").
//   - I9 redaction:       PolicyTripPlannerLLMAgent (allows
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

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	tripplannerllmagent "github.com/ev-dev-labs/teslasync/internal/ai/strategies/trip-planner-llm-agent"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// aiTripPlannerLLMAgentMaxIterations bounds the dispatcher's
// tool-loop. The strategy is at most
// query_chargers_along_route → query_user_charge_dwells →
// draft_trip_plan → answer (with optional retries). A hard ceiling
// of 8 is generous. Mirrors aiAutoTripNamingMaxIterations.
const aiTripPlannerLLMAgentMaxIterations = 8

// aiTripPlannerLLMDraftRequest is the JSON body shape this handler
// accepts. SI-canonical fields throughout — current_soc /
// charge_limit_soc / min_arrival_soc are 0..100 percent; the
// origin/destination are (lat, lng) doubles plus an optional
// human-readable name. The shape mirrors the *typed* surface area
// of POST /api/v1/trip-planner/plan so a SPA call site can construct
// the AI draft request from the same form state.
type aiTripPlannerLLMDraftRequest struct {
	VehicleID      int64                         `json:"vehicle_id"`
	Origin         aiTripPlannerLLMDraftLocation `json:"origin"`
	Destination    aiTripPlannerLLMDraftLocation `json:"destination"`
	CurrentSOC     float64                       `json:"current_soc"`
	ChargeLimitSOC float64                       `json:"charge_limit_soc,omitempty"`
	MinArrivalSOC  float64                       `json:"min_arrival_soc,omitempty"`
	SpeedFactor    float64                       `json:"speed_factor,omitempty"`
}

// aiTripPlannerLLMDraftLocation mirrors tripPlanLocation (the
// canonical baseline shape) so the SPA can post the same form-state
// payload to the AI endpoint.
type aiTripPlannerLLMDraftLocation struct {
	Lat  float64 `json:"lat"`
	Lng  float64 `json:"lng"`
	Name string  `json:"name,omitempty"`
}

// AITripPlannerLLMHandler is the HTTP handler for
// POST /api/v1/ai/trips/plan/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type AITripPlannerLLMHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAITripPlannerLLMHandler constructs the handler. All non-pointer
// arguments are required; the constructor panics on a nil so the
// wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	query_chargers_along_route, query_user_charge_dwells AND
//	draft_trip_plan (all three registered by
//	tools.RegisterTripPlannerLLMAgentTools in router.go).
//
// strat:      the trip-planner-llm-agent Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewAITripPlannerLLMHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AITripPlannerLLMHandler {
	switch {
	case registry == nil:
		panic("api: NewAITripPlannerLLMHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAITripPlannerLLMHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAITripPlannerLLMHandler: nil strategy.Strategy")
	}
	return &AITripPlannerLLMHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiTripPlannerLLMAgentMaxIterations,
	}
}

// parseTripPlannerLLMDraftBody decodes + validates the JSON body.
// Pulled out so the validator-only test can exercise the same
// parsing without constructing a full handler with stub deps. The
// function writes a 400 on failure and returns the (req, ok) pair so
// the caller can early-return.
func parseTripPlannerLLMDraftBody(w http.ResponseWriter, r *http.Request) (*aiTripPlannerLLMDraftRequest, bool) {
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "request body is required")
		return nil, false
	}
	defer r.Body.Close()
	var req aiTripPlannerLLMDraftRequest
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
	if req.Origin.Lat < -90 || req.Origin.Lat > 90 {
		writeError(w, http.StatusBadRequest, "origin.lat must be in [-90, 90]")
		return nil, false
	}
	if req.Origin.Lng < -180 || req.Origin.Lng > 180 {
		writeError(w, http.StatusBadRequest, "origin.lng must be in [-180, 180]")
		return nil, false
	}
	if req.Destination.Lat < -90 || req.Destination.Lat > 90 {
		writeError(w, http.StatusBadRequest, "destination.lat must be in [-90, 90]")
		return nil, false
	}
	if req.Destination.Lng < -180 || req.Destination.Lng > 180 {
		writeError(w, http.StatusBadRequest, "destination.lng must be in [-180, 180]")
		return nil, false
	}
	if req.CurrentSOC < 0 || req.CurrentSOC > 100 {
		writeError(w, http.StatusBadRequest, "current_soc must be in [0, 100]")
		return nil, false
	}
	if req.ChargeLimitSOC < 0 || req.ChargeLimitSOC > 100 {
		writeError(w, http.StatusBadRequest, "charge_limit_soc must be in [0, 100]")
		return nil, false
	}
	if req.MinArrivalSOC < 0 || req.MinArrivalSOC > 100 {
		writeError(w, http.StatusBadRequest, "min_arrival_soc must be in [0, 100]")
		return nil, false
	}
	if req.SpeedFactor < 0 || req.SpeedFactor > 3 {
		writeError(w, http.StatusBadRequest, "speed_factor must be in [0, 3]")
		return nil, false
	}
	return &req, true
}

// ServeHTTP implements [http.Handler]. The body is decoded, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes a
// structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *AITripPlannerLLMHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the JSON body.
	body, ok := parseTripPlannerLLMDraftBody(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), tripplannerllmagent.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai trip-planner-llm-agent: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, tripplannerllmagent.FeatureID)

	// 4) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(tripplannerllmagent.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai trip-planner-llm-agent: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context.
	prov, err := h.registry.For(ctx, tripplannerllmagent.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai trip-planner-llm-agent: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Trip-planning is NOT
	// conversational here — there is no chat history. We hand the
	// LLM a deterministic prompt that asks it to call the three
	// propose-only tools in order and narrate the result.
	userMsg := fmt.Sprintf(
		"Draft a trip plan for vehicle %d from (%.6f, %.6f) %q to (%.6f, %.6f) %q. "+
			"Starting SOC is %.1f%% (charge_limit=%.1f%%, min_arrival=%.1f%%, speed_factor=%.2f). "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call query_chargers_along_route with these origin/destination coordinates to see "+
			"which corridor chargers the user has actually used; "+
			"(2) call query_user_charge_dwells to learn the user's typical dwell behaviour at each "+
			"charger; "+
			"(3) call draft_trip_plan with the same origin/destination/SOC arguments to delegate to "+
			"the canonical planner. "+
			"Narrate the resulting plan in 2-3 sentences grounded strictly in the tool replies, "+
			"calling out total_distance_m, arrival_soc, and the chosen charger stop(s) by name. "+
			"Remember: you NEVER save anything; the user reviews the structured proposal and clicks "+
			"the canonical Plan button to save. If the canonical planner returns Feasible=false, say "+
			"so plainly rather than inventing alternate routes.",
		body.VehicleID,
		body.Origin.Lat, body.Origin.Lng, body.Origin.Name,
		body.Destination.Lat, body.Destination.Lng, body.Destination.Name,
		body.CurrentSOC, body.ChargeLimitSOC, body.MinArrivalSOC, body.SpeedFactor,
	)

	// 8) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("vehicle_id", body.VehicleID).
			Msg("ai trip-planner-llm-agent: dispatcher returned error")
	}
}

// Compile-time assertion: AITripPlannerLLMHandler satisfies http.Handler.
var _ http.Handler = (*AITripPlannerLLMHandler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the tool interface declared by
// internal/ai/tools/trip_planner_llm_agent.go. Kept in the same file
// as the handler so the wiring intent is local to the slice; mirrors
// the auto-trip-naming slice's AITripNameValidator pattern.
// ---------------------------------------------------------------------

// AITripPlanComputer is the production tools.TripPlanComputer. It
// delegates to the canonical *TripPlannerHandler.computePlan path so
// a plan proposed by the AI tool is byte-equivalent to a plan
// returned by POST /api/v1/trip-planner/plan.
//
// The struct holds a non-nil *TripPlannerHandler reference (panics
// at construction on nil) so a wiring bug surfaces at boot.
type AITripPlanComputer struct {
	planner *TripPlannerHandler
}

// NewAITripPlanComputer constructs the adapter. Panics on nil so a
// wiring mistake surfaces at boot.
func NewAITripPlanComputer(planner *TripPlannerHandler) *AITripPlanComputer {
	if planner == nil {
		panic("api: NewAITripPlanComputer: nil *TripPlannerHandler")
	}
	return &AITripPlanComputer{planner: planner}
}

// ComputeTripPlan implements tools.TripPlanComputer. Translates the
// typed [tools.TripPlanComputeRequest] into a canonical
// *tripPlanRequest, delegates to the same in-process computePlan
// method the deterministic POST /api/v1/trip-planner/plan handler
// uses, and translates the *tripPlanResponse back into a typed
// [tools.TripPlanComputeResult]. SI-canonical end-to-end:
// total_distance_m, total_duration_s, total_energy_wh, arrival_soc.
//
// The compute call is bounded by ctx; a context-cancel from the SPA
// closing the SSE connection terminates the computation cleanly.
func (a *AITripPlanComputer) ComputeTripPlan(ctx context.Context, req tools.TripPlanComputeRequest) (*tools.TripPlanComputeResult, error) {
	baselineReq := &tripPlanRequest{
		VehicleID: req.VehicleID,
		Origin: tripPlanLocation{
			Lat:  req.OriginLat,
			Lng:  req.OriginLng,
			Name: req.OriginName,
		},
		Destination: tripPlanLocation{
			Lat:  req.DestLat,
			Lng:  req.DestLng,
			Name: req.DestName,
		},
		CurrentSOC:     req.CurrentSOC,
		ChargeLimitSOC: req.ChargeLimitSOC,
		MinArrivalSOC:  req.MinArrivalSOC,
		Preferences: tripPlanPreferences{
			SpeedFactor: req.SpeedFactor,
		},
	}
	resp, err := a.planner.computePlan(ctx, baselineReq)
	if err != nil {
		return nil, fmt.Errorf("ai trip-planner-llm-agent: computePlan: %w", err)
	}
	if resp == nil {
		return nil, errors.New("ai trip-planner-llm-agent: computePlan returned nil response")
	}
	out := &tools.TripPlanComputeResult{
		Route: tools.TripPlanRoute{
			TotalDistanceM:    resp.Route.TotalDistanceM,
			TotalDurationS:    resp.Route.TotalDurationS,
			DrivingDurationS:  resp.Route.DrivingDurationS,
			ChargingDurationS: resp.Route.ChargingDurationS,
			TotalEnergyWh:     resp.Route.TotalEnergyWh,
			EstimatedCost:     resp.Route.EstimatedCost,
			ArrivalSOC:        resp.Route.ArrivalSOC,
			Feasible:          resp.Route.Feasible,
			IsEstimate:        resp.Route.IsEstimate,
		},
		Legs:        make([]tools.TripPlanLeg, 0, len(resp.Legs)),
		ChargeStops: make([]tools.TripPlanChargeStop, 0, len(resp.ChargeStops)),
		SOCCurve:    make([]tools.TripPlanSOCPoint, 0, len(resp.SOCCurve)),
	}
	for _, leg := range resp.Legs {
		out.Legs = append(out.Legs, tools.TripPlanLeg{
			From: tools.TripPlanLocation{
				Lat: leg.From.Lat, Lng: leg.From.Lng, Name: leg.From.Name,
			},
			To: tools.TripPlanLocation{
				Lat: leg.To.Lat, Lng: leg.To.Lng, Name: leg.To.Name,
			},
			DistanceM:  leg.DistanceM,
			DurationS:  leg.DurationS,
			EnergyWh:   leg.EnergyWh,
			StartSOC:   leg.StartSOC,
			ArrivalSOC: leg.ArrivalSOC,
		})
	}
	for _, cs := range resp.ChargeStops {
		out.ChargeStops = append(out.ChargeStops, tools.TripPlanChargeStop{
			Name: cs.Name,
			Location: tools.TripPlanLocation{
				Lat: cs.Location.Lat, Lng: cs.Location.Lng, Name: cs.Location.Name,
			},
			ChargeFromSOC:   cs.ChargeFromSOC,
			ChargeToSOC:     cs.ChargeToSOC,
			ChargeDurationS: cs.ChargeDurationS,
			EnergyWh:        cs.EnergyWh,
			Cost:            cs.Cost,
			IsRecommended:   cs.IsRecommended,
		})
	}
	for _, p := range resp.SOCCurve {
		out.SOCCurve = append(out.SOCCurve, tools.TripPlanSOCPoint{
			DistanceM: p.DistanceM,
			SOC:       p.SOC,
		})
	}
	return out, nil
}

// Compile-time assertion: AITripPlanComputer satisfies the tool port.
var _ tools.TripPlanComputer = (*AITripPlanComputer)(nil)
