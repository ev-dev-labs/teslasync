package aianomaly

// Handler for natural-language anomaly explanation narration.
//
// This opt-in POST /api/v1/ai/anomalies/explain surface streams a one-shot
// LLM explanation through the shared dispatcher. The guard in ai_routes.go
// enforces ADR-015 off-mode/per-feature gating before this handler runs, so
// the deterministic /api/v1/analytics/anomalies baseline remains unchanged.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	anomalyexplanations "github.com/ev-dev-labs/teslasync/internal/ai/strategies/anomaly-explanations"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// maxIterations leaves room for one retry while keeping one-shot anomaly
// narration bounded.
const maxIterations = 4

// defaultDays intentionally stays separate from tool defaults so dashboard
// window changes do not silently shift the AI narration window.
const defaultDays = 7

// maxDays is the upper bound that mirrors the tool's
// validate tag (lte=30). HTTP-side validation bounces obvious bad
// input (e.g. days=365) before we ever invoke the LLM.
const maxDays = 30

// Handler is the HTTP handler for
// POST /api/v1/ai/anomalies/explain.
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

// NewHandler constructs the handler and panics on nil dependencies so wiring
// bugs fail at boot instead of on the first request. toolReg must include
// query_anomaly_context from tools.RegisterAnomalyTools.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aianomaly: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aianomaly: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aianomaly: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// request is the wire shape for
// POST /api/v1/ai/anomalies/explain.
//
// VehicleID is required and must be > 0. Days is optional; when
// absent or zero, defaults to defaultDays. Days must be in
// 1..maxDays when explicitly set, mirroring the tool's
// validate tag.
type request struct {
	VehicleID int64 `json:"vehicle_id"`
	Days      int   `json:"days,omitempty"`
}

// ServeHTTP implements [http.Handler]. The request is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes a
// structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var body request
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.VehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id is required and must be > 0")
		return
	}
	if body.Days < 0 || body.Days > maxDays {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("days must be in 0..%d (0 = default)", maxDays))
		return
	}
	days := body.Days
	if days == 0 {
		days = defaultDays
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), anomalyexplanations.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai anomaly: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// Empty subject is the open-mode audit value.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, anomalyexplanations.FeatureID)

	// The stream context cancels upstream provider work if the client stalls.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(anomalyexplanations.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai anomaly: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context. The decorator chain reads the subject + feature-id
	// off the ctx for audit + rate limit accounting.
	prov, err := h.registry.For(ctx, anomalyexplanations.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai anomaly: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// Deny-all confirmation is defense in depth if a future strategy adds a
	// mutating tool by mistake.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// Use a deterministic one-shot prompt; this surface has no chat history.
	userMsg := fmt.Sprintf(
		"Explain anomalies for vehicle %d over the last %d days. "+
			"Call query_anomaly_context first, then narrate the result strictly from its reply.",
		body.VehicleID, days,
	)

	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		// The dispatcher has already emitted the terminal SSE frame.
		log.Error().Err(err).
			Int64("vehicle_id", body.VehicleID).
			Int("days", days).
			Msg("ai anomaly: dispatcher returned error")
	}
}

// Compile-time assertion: Handler satisfies http.Handler.
var _ http.Handler = (*Handler)(nil)

func writeError(w http.ResponseWriter, status int, msg string) {
	httpx.WriteError(w, status, msg)
}

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}
