package aimlchargcv

// Phase-50 / 0064 — ML charging-curve clustering narration.
// This opt-in AI handler streams one-shot cluster narration for the charging
// curves page; guard.Wrap enforces ADR-015 off-mode and per-feature gating before
// any provider or trainer path runs.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	mlchargingcurveclustering "github.com/ev-dev-labs/teslasync/internal/ai/strategies/ml-charging-curve-clustering"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
	mlchargingcurves "github.com/ev-dev-labs/teslasync/internal/ml/chargingcurves"
)

// maxIterations bounds the dispatcher's tool-loop.
// Cluster narration is two-tool-calls-then-answer
// (train_charge_curve_clusters FIRST, then
// query_charge_curve_clusters); a hard ceiling of 6 is generous for
// a model that occasionally retries a tool call once before
// settling. Mirrors aiRangeMaxIterations from slice 0063.
const maxIterations = 6

// defaultLookbackDays mirrors
// mlchargingcurves.DefaultLookbackDays. Kept as a separate const
// so the HTTP-input default is independently readable from the
// trainer default — a future change that shifts the trainer window
// won't silently shift the AI-handler window.
const defaultLookbackDays = 90

// maxLookbackDays is the upper bound that mirrors the
// tool's validate tag (lte=365) and
// mlchargingcurves.MaxLookbackDays. HTTP-side validation bounces
// obvious bad input before we ever invoke the LLM.
const maxLookbackDays = 365

// Handler is the HTTP handler for
// POST /api/v1/ai/ml/charging-curves/cluster.
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
//	train_charge_curve_clusters + query_charge_curve_clusters
//	(registered by charge.RegisterChargeCurveClustersTools in
//	router.go).
//
// strat:      the ml-charging-curve-clustering Strategy (one per
//
//	process).
//
// headerName: forward-auth header name; used to extract subject for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aimlchargcv: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aimlchargcv: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aimlchargcv: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// clusterRequest is the wire shape for
// POST /api/v1/ai/ml/charging-curves/cluster.
//
// VehicleID is required and must be > 0. LookbackDays is optional;
// when absent or zero, defaults to defaultLookbackDays.
// LookbackDays must be in 1..maxLookbackDays when
// explicitly set, mirroring the train_charge_curve_clusters tool's
// validate tag.
type clusterRequest struct {
	VehicleID    int64 `json:"vehicle_id"`
	LookbackDays int   `json:"lookback_days,omitempty"`
}

func parseClusterRequest(w http.ResponseWriter, r *http.Request) (*clusterRequest, bool) {
	var body clusterRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return nil, false
	}
	if body.VehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required and must be > 0")
		return nil, false
	}
	if body.LookbackDays < 0 || body.LookbackDays > maxLookbackDays {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("lookback_days must be in 0..%d (0 = default)", maxLookbackDays))
		return nil, false
	}
	return &body, true
}

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// ServeHTTP implements [http.Handler]. The request is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes
// a structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, ok := parseClusterRequest(w, r)
	if !ok {
		return
	}
	days := body.LookbackDays
	if days == 0 {
		days = defaultLookbackDays
	}

	// Resolve before opening SSE so provider failures remain ordinary JSON 502s.
	if _, err := h.registry.For(r.Context(), mlchargingcurveclustering.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai ml-charging-curve-clustering: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// SubjectFromRequest returns "" if the header is absent;
	// that's the open-mode value the audit log treats as
	// "anonymous".
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, mlchargingcurveclustering.FeatureID)

	// The child ctx cancels on consumer stalls, stopping upstream provider work.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(mlchargingcurveclustering.FeatureID))
	if err != nil {
		// Non-flushable response writer (test recorder, etc.).
		// Emit a plain JSON 500 — the SSE headers were not sent.
		log.Error().Err(err).Msg("ai ml-charging-curve-clustering: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// Resolve again with subject and feature annotations for decorators.
	prov, err := h.registry.For(ctx, mlchargingcurveclustering.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai ml-charging-curve-clustering: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// Deny-all confirmation keeps future accidental mutating tools read-only.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// Cluster narration is non-conversational; force the two-tool sequence.
	userMsg := fmt.Sprintf(
		"Explain the learned charging clusters for vehicle %d over the last %d days. "+
			"Call train_charge_curve_clusters FIRST with vehicle_id=%d lookback_days=%d, then call query_charge_curve_clusters with vehicle_id=%d, then narrate the diff strictly from the tool replies.",
		body.VehicleID, days, body.VehicleID, days, body.VehicleID,
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
			Int64("vehicle_id", body.VehicleID).
			Int("lookback_days", days).
			Msg("ai ml-charging-curve-clustering: dispatcher returned error")
	}
}

// Compile-time assertion: Handler satisfies
// http.Handler.
var _ http.Handler = (*Handler)(nil)

// ChargingSessionSource is the production *chargingdb.ChargingRepo-backed
// adapter that satisfies mlchargingcurves.SessionSource. It
// delegates to the existing GetByVehicle method on the repo (the
// SAME `charging_sessions` rows the deterministic ChargingCurvePage
// renders); no new SQL semantics are added here.
//
// The mlchargingcurves.SessionSource interface signature is
// (ctx, vehicleID, limit, start, end) — note: NO offset. The
// underlying ChargingRepo.GetByVehicle takes (ctx, vehicleID,
// limit, offset, start, end); we always pass offset=0 since the
// trainer wants the most-recent rows up to the limit.
type ChargingSessionSource struct {
	repo *chargingdb.ChargingRepo
}

// NewChargingSessionSource constructs the adapter. Panics on a
// nil repo so the wiring bug surfaces at boot, not at first
// request.
func NewChargingSessionSource(repo *chargingdb.ChargingRepo) *ChargingSessionSource {
	if repo == nil {
		panic("aimlchargcv: NewChargingSessionSource: nil *chargingdb.ChargingRepo")
	}
	return &ChargingSessionSource{repo: repo}
}

// SessionsForVehicle implements mlchargingcurves.SessionSource.
// Returns the per-vehicle charging session slice for [start, end].
//
// Implementation notes:
//
//   - vehicleID <= 0 yields an empty slice (caller error rather
//     than DB round-trip — the AI handler's validator already
//     bounces this).
//   - offset is always 0; the trainer wants the most-recent rows
//     up to limit. The underlying repo applies its own ORDER BY
//     started_at DESC.
//   - start / end form the inclusive lookback window the trainer
//     computed from time.Now() - lookbackDays * 24h.
func (s *ChargingSessionSource) SessionsForVehicle(ctx context.Context, vehicleID int64, limit int, start, end time.Time) ([]*chargingmodel.ChargingSession, error) {
	if vehicleID <= 0 {
		return []*chargingmodel.ChargingSession{}, nil
	}
	rows, err := s.repo.GetByVehicle(ctx, vehicleID, limit, 0, start, end)
	if err != nil {
		return nil, fmt.Errorf("ChargingSessionSource: vehicle %d window [%s,%s]: %w", vehicleID, start.Format(time.RFC3339), end.Format(time.RFC3339), err)
	}
	return rows, nil
}

// Compile-time assertion: ChargingSessionSource satisfies
// mlchargingcurves.SessionSource.
var _ mlchargingcurves.SessionSource = (*ChargingSessionSource)(nil)
