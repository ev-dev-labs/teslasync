package aitripplanllm

// Trip planner LLM agent handler.
//
// This LLM-backed one-shot SSE handler drafts trip plans without changing the
// deterministic /trip-planner flow. The JSON body is validated before opening
// SSE so malformed input remains a plain JSON 400.

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
	tripplantool "github.com/ev-dev-labs/teslasync/internal/ai/tools/tripplan"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	apitripplanner "github.com/ev-dev-labs/teslasync/internal/api/tripplanner"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// agentMaxIterations bounds the dispatcher's
// tool-loop. The strategy is at most
// query_chargers_along_route → query_user_charge_dwells →
// draft_trip_plan → answer (with optional retries). A hard ceiling
// of 8 is generous. Mirrors aiAutoTripNamingMaxIterations.
const agentMaxIterations = 8

// draftRequest is the JSON body shape this handler
// accepts. SI-canonical fields throughout — current_soc /
// charge_limit_soc / min_arrival_soc are 0..100 percent; the
// origin/destination are (lat, lng) doubles plus an optional
// human-readable name. The shape mirrors the *typed* surface area
// of POST /api/v1/trip-planner/plan so a SPA call site can construct
// the AI draft request from the same form state.
type draftRequest struct {
	VehicleID      int64         `json:"vehicle_id"`
	Origin         draftLocation `json:"origin"`
	Destination    draftLocation `json:"destination"`
	CurrentSOC     float64       `json:"current_soc"`
	ChargeLimitSOC float64       `json:"charge_limit_soc,omitempty"`
	MinArrivalSOC  float64       `json:"min_arrival_soc,omitempty"`
	SpeedFactor    float64       `json:"speed_factor,omitempty"`
}

// draftLocation mirrors tripplanner.TripPlanLocation (the
// canonical baseline shape) so the SPA can post the same form-state
// payload to the AI endpoint.
type draftLocation struct {
	Lat  float64 `json:"lat"`
	Lng  float64 `json:"lng"`
	Name string  `json:"name,omitempty"`
}

// Handler is the HTTP handler for
// POST /api/v1/ai/trips/plan/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewHandler constructs the handler. All non-pointer
// arguments are required; the constructor panics on a nil so the
// wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	query_chargers_along_route, query_user_charge_dwells AND
//	draft_trip_plan (all three registered by
//	tripplantool.RegisterTripPlannerLLMAgentTools in router.go).
//
// strat:      the trip-planner-llm-agent Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aitripplanllm: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aitripplanllm: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aitripplanllm: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   agentMaxIterations,
	}
}

// parseDraftBody decodes + validates the JSON body.
// Pulled out so the validator-only test can exercise the same
// parsing without constructing a full handler with stub deps. The
// function writes a 400 on failure and returns the (req, ok) pair so
// the caller can early-return.
func parseDraftBody(w http.ResponseWriter, r *http.Request) (*draftRequest, bool) {
	if r.Body == nil {
		httpx.WriteError(w, http.StatusBadRequest, "request body is required")
		return nil, false
	}
	defer r.Body.Close()
	var req draftRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return nil, false
	}
	if req.VehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be > 0")
		return nil, false
	}
	if req.Origin.Lat < -90 || req.Origin.Lat > 90 {
		httpx.WriteError(w, http.StatusBadRequest, "origin.lat must be in [-90, 90]")
		return nil, false
	}
	if req.Origin.Lng < -180 || req.Origin.Lng > 180 {
		httpx.WriteError(w, http.StatusBadRequest, "origin.lng must be in [-180, 180]")
		return nil, false
	}
	if req.Destination.Lat < -90 || req.Destination.Lat > 90 {
		httpx.WriteError(w, http.StatusBadRequest, "destination.lat must be in [-90, 90]")
		return nil, false
	}
	if req.Destination.Lng < -180 || req.Destination.Lng > 180 {
		httpx.WriteError(w, http.StatusBadRequest, "destination.lng must be in [-180, 180]")
		return nil, false
	}
	if req.CurrentSOC < 0 || req.CurrentSOC > 100 {
		httpx.WriteError(w, http.StatusBadRequest, "current_soc must be in [0, 100]")
		return nil, false
	}
	if req.ChargeLimitSOC < 0 || req.ChargeLimitSOC > 100 {
		httpx.WriteError(w, http.StatusBadRequest, "charge_limit_soc must be in [0, 100]")
		return nil, false
	}
	if req.MinArrivalSOC < 0 || req.MinArrivalSOC > 100 {
		httpx.WriteError(w, http.StatusBadRequest, "min_arrival_soc must be in [0, 100]")
		return nil, false
	}
	if req.SpeedFactor < 0 || req.SpeedFactor > 3 {
		httpx.WriteError(w, http.StatusBadRequest, "speed_factor must be in [0, 3]")
		return nil, false
	}
	return &req, true
}

// denyAllConfirm is the dispatcher's user-confirm hook. Trip-planner LLM
// tools are propose-only, but deny by default if a future edit adds a
// mutating tool to the strategy allowlist.
func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// ServeHTTP implements [http.Handler]. The body is decoded, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes a
// structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, ok := parseDraftBody(w, r)
	if !ok {
		return
	}

	// Resolve before opening SSE so provider failures remain JSON errors.
	if _, err := h.registry.For(r.Context(), tripplannerllmagent.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai trip-planner-llm-agent: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, tripplannerllmagent.FeatureID)

	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(tripplannerllmagent.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai trip-planner-llm-agent: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	prov, err := h.registry.For(ctx, tripplannerllmagent.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai trip-planner-llm-agent: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// Non-conversational by design: force the propose-only trip-planning tool sequence.
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

var _ http.Handler = (*Handler)(nil)

// AITripPlanComputer is the production tripplantool.TripPlanComputer. It
// delegates to the canonical tripplanner ComputePlan path so a plan proposed
// by the AI tool is byte-equivalent to a plan returned by
// POST /api/v1/trip-planner/plan.
//
// The struct holds a non-nil *tripplanner.TripPlannerHandler reference
// (panics at construction on nil) so a wiring bug surfaces at boot.
type AITripPlanComputer struct {
	planner *apitripplanner.TripPlannerHandler
}

// NewAITripPlanComputer constructs the adapter. Panics on nil so a
// wiring mistake surfaces at boot.
func NewAITripPlanComputer(planner *apitripplanner.TripPlannerHandler) *AITripPlanComputer {
	if planner == nil {
		panic("aitripplanllm: NewAITripPlanComputer: nil *tripplanner.TripPlannerHandler")
	}
	return &AITripPlanComputer{planner: planner}
}

// ComputeTripPlan implements tripplantool.TripPlanComputer. Translates the
// typed [tripplantool.TripPlanComputeRequest] into a canonical
// *tripplanner.TripPlanRequest, delegates to the same in-process ComputePlan
// method the deterministic POST /api/v1/trip-planner/plan handler
// uses, and translates the *tripplanner.TripPlanResponse back into a typed
// [tripplantool.TripPlanComputeResult]. SI-canonical end-to-end:
// total_distance_m, total_duration_s, total_energy_wh, arrival_soc.
//
// The compute call is bounded by ctx; a context-cancel from the SPA
// closing the SSE connection terminates the computation cleanly.
func (a *AITripPlanComputer) ComputeTripPlan(ctx context.Context, req tripplantool.TripPlanComputeRequest) (*tripplantool.TripPlanComputeResult, error) {
	baselineReq := &apitripplanner.TripPlanRequest{
		VehicleID: req.VehicleID,
		Origin: apitripplanner.TripPlanLocation{
			Lat:  req.OriginLat,
			Lng:  req.OriginLng,
			Name: req.OriginName,
		},
		Destination: apitripplanner.TripPlanLocation{
			Lat:  req.DestLat,
			Lng:  req.DestLng,
			Name: req.DestName,
		},
		CurrentSOC:     req.CurrentSOC,
		ChargeLimitSOC: req.ChargeLimitSOC,
		MinArrivalSOC:  req.MinArrivalSOC,
		Preferences: apitripplanner.TripPlanPreferences{
			SpeedFactor: req.SpeedFactor,
		},
	}
	resp, err := a.planner.ComputePlan(ctx, baselineReq)
	if err != nil {
		return nil, fmt.Errorf("ai trip-planner-llm-agent: ComputePlan: %w", err)
	}
	if resp == nil {
		return nil, errors.New("ai trip-planner-llm-agent: ComputePlan returned nil response")
	}
	out := &tripplantool.TripPlanComputeResult{
		Route: tripplantool.TripPlanRoute{
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
		Legs:        make([]tripplantool.TripPlanLeg, 0, len(resp.Legs)),
		ChargeStops: make([]tripplantool.TripPlanChargeStop, 0, len(resp.ChargeStops)),
		SOCCurve:    make([]tripplantool.TripPlanSOCPoint, 0, len(resp.SOCCurve)),
	}
	for _, leg := range resp.Legs {
		out.Legs = append(out.Legs, tripplantool.TripPlanLeg{
			From: tripplantool.TripPlanLocation{
				Lat: leg.From.Lat, Lng: leg.From.Lng, Name: leg.From.Name,
			},
			To: tripplantool.TripPlanLocation{
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
		out.ChargeStops = append(out.ChargeStops, tripplantool.TripPlanChargeStop{
			Name: cs.Name,
			Location: tripplantool.TripPlanLocation{
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
		out.SOCCurve = append(out.SOCCurve, tripplantool.TripPlanSOCPoint{
			DistanceM: p.DistanceM,
			SOC:       p.SOC,
		})
	}
	return out, nil
}

var _ tripplantool.TripPlanComputer = (*AITripPlanComputer)(nil)
