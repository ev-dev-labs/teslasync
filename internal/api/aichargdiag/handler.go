package aichargdiag

// Handler for per-charging-session diagnosis.
//
// This LLM-backed one-shot SSE handler adds POST
// /api/v1/ai/charging/{sessionID}/diagnose without changing the deterministic
// charging detail page. The route is gated by guard.Wrap("charging-diagnosis"),
// uses the URL sessionID as its only input, and relies on ADR-015 redaction and
// per-feature controls.

import (
	"context"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	chargingdiagnosis "github.com/ev-dev-labs/teslasync/internal/ai/strategies/charging-diagnosis"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// maxIterations bounds the dispatcher's
// tool-loop. Charging diagnosis is at most two-tool-calls-then-
// answer; a hard ceiling of 6 is generous for a model that
// occasionally retries one of the tool calls before settling.
// Mirrors aiDriveCoachMaxIterations from slice 0018.
const maxIterations = 6

// Handler is the HTTP handler for
// POST /api/v1/ai/charging/{sessionID}/diagnose.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once
// at boot.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on
// a nil so the wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	query_charge_session AND query_charging_aggregation
//	(both registered by diagnosis.RegisterChargingDiagnosisTools
//	in router.go).
//
// strat:      the charging-diagnosis Strategy (one per process).
// headerName: forward-auth header name; used to extract subject
//
//	for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aichargdiag: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aichargdiag: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aichargdiag: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// parseChargingDiagnosisURL extracts and validates the sessionID
// URL parameter. Pulled out so the off-mode test and the
// validator-only test can exercise the same parsing without
// constructing a full handler with stub deps. The function writes
// a 400 on failure and returns the (id, ok) pair so the caller
// can early-return.
//
// sessionID MUST be a positive integer; zero or negative values
// are rejected with a 400 because they cannot identify a real
// charging session row.
func parseChargingDiagnosisURL(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := chi.URLParam(r, "sessionID")
	if raw == "" {
		httpx.WriteError(w, http.StatusBadRequest, "sessionID URL parameter is required")
		return 0, false
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("sessionID must be a positive integer (got %q)", raw))
		return 0, false
	}
	if id <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "sessionID must be > 0")
		return 0, false
	}
	return id, true
}

// ServeHTTP implements [http.Handler]. The sessionID is parsed
// from the URL, the dispatcher is invoked, and the SSE stream is
// closed via the dispatcher's deferred WriteDone. Every error
// path either writes a structured frame onto the SSE stream
// (when the writer has been opened) or a plain JSON 4xx/5xx
// (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Body is intentionally ignored; the URL sessionID is the only input.
	sessionID, ok := parseChargingDiagnosisURL(w, r)
	if !ok {
		return
	}

	// Resolve before opening SSE so provider failures remain JSON errors.
	if _, err := h.registry.For(r.Context(), chargingdiagnosis.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai charging diagnosis: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// Missing subject is the open-mode "anonymous" audit value.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, chargingdiagnosis.FeatureID)

	// Stream.New returns a stall-canceling child context for the dispatcher.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(chargingdiagnosis.FeatureID))
	if err != nil {
		// Non-flushable response writer (test recorder, etc.).
		// Emit a plain JSON 500 — the SSE headers were not sent.
		log.Error().Err(err).Msg("ai charging diagnosis: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// Resolve again with annotated context for audit and rate-limit decorators.
	prov, err := h.registry.For(ctx, chargingdiagnosis.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai charging diagnosis: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// Deny-all is defence-in-depth if a future strategy adds a mutating tool.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// Keep vehicle_id out of the prompt; the scoped session tool reply is the
	// authoritative source and avoids user-controlled cross-tenant hints.
	userMsg := fmt.Sprintf(
		"Diagnose charging session %d. Call query_charge_session and "+
			"query_charging_aggregation first, then explain any flags raised "+
			"(trickle, expensive, low-power, interrupted) strictly from their replies "+
			"in 2-4 short paragraphs.",
		sessionID,
	)

	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		// Errors are also surfaced on the SSE wire by the
		// dispatcher's terminal frame (WriteError or
		// EmitLimitError on the underlying writer); we just log.
		log.Error().Err(err).
			Int64("session_id", sessionID).
			Msg("ai charging diagnosis: dispatcher returned error")
	}
}

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

var _ http.Handler = (*Handler)(nil)
