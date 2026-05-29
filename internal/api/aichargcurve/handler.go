package aichargcurve

// Handler for charging-curve fingerprint clustering.
//
// Serves the opt-in SSE narrator for charging-curve clusters. The guard
// returns 404 before this handler runs when AI mode or this feature is off;
// request validation happens before opening SSE so bad input stays a JSON 400.
// The deterministic charging-curve page and response shape remain unchanged.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	chargingcurvefingerprintclustering "github.com/ev-dev-labs/teslasync/internal/ai/strategies/charging-curve-fingerprint-clustering"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// maxIterations bounds the read-only tool loop with room for retries.
const maxIterations = 8

// explainRequest keeps the AI body aligned with deterministic charging-curve filters.
type explainRequest struct {
	VehicleID int64 `json:"vehicle_id"`
}

// Handler is the HTTP handler for
// POST /api/v1/ai/charging/curves/clusters/explain.
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

// NewHandler wires required AI dependencies and panics on nil so boot fails fast.
// toolReg must contain retrieve_charge_curve_chunks and query_charge_curve_features.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aichargcurve: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aichargcurve: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aichargcurve: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// parseExplainBody validates input before SSE headers are written.
func parseExplainBody(w http.ResponseWriter, r *http.Request) (*explainRequest, bool) {
	if r.Body == nil {
		httpx.WriteError(w, http.StatusBadRequest, "request body is required")
		return nil, false
	}
	defer r.Body.Close()
	var req explainRequest
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
	return &req, true
}

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// ServeHTTP implements [http.Handler]. The body is decoded, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes a
// structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, ok := parseExplainBody(w, r)
	if !ok {
		return
	}

	// Resolve before SSE so provider failures remain plain JSON.
	if _, err := h.registry.For(r.Context(), chargingcurvefingerprintclustering.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai charging-curve-fingerprint-clustering: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, chargingcurvefingerprintclustering.FeatureID)

	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(chargingcurvefingerprintclustering.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai charging-curve-fingerprint-clustering: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	prov, err := h.registry.For(ctx, chargingcurvefingerprintclustering.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai charging-curve-fingerprint-clustering: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// Deny-all confirm is defense-in-depth if a mutating tool is ever added.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// No chat history exists here; this prompt forces the deterministic tool sequence.
	userMsg := fmt.Sprintf(
		"Name and explain the charging-curve fingerprint clusters for vehicle %d. "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call retrieve_charge_curve_chunks with a focused natural-language query "+
			"and source_types=[\"charge_curve\",\"charge_session\"] to ground your narration in "+
			"the user's own charging history, "+
			"(2) call query_charge_curve_features with vehicle_id=%d to get the deterministic "+
			"per-cluster envelope. "+
			"For each cluster the tool returns, give a short human-readable name (e.g. "+
			"\"Overnight L2 home charging\", \"Supercharger road-trip stops\") and ONE OR TWO "+
			"sentences explaining what makes the sessions in it cohere — quoting "+
			"session_count, peak_power_w_avg, dominant_charger_type, ramp_shape, and "+
			"total_energy_wh_avg from the tool reply, never inventing numbers. "+
			"Do NOT recompute, override, or contradict the cluster bucketing the tool returned. "+
			"If has_enough_data is false, say so plainly rather than inventing a cluster.",
		body.VehicleID, body.VehicleID,
	)

	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("vehicle_id", body.VehicleID).
			Msg("ai charging-curve-fingerprint-clustering: dispatcher returned error")
	}
}

var _ http.Handler = (*Handler)(nil)
