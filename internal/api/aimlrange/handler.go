package aimlrange

// Phase-50 / 0063 — ML2 Range-prediction model.
//
// handler.go implements the LLM-backed handler at
// POST /api/v1/ai/ml/range/train. The flow mirrors the
// learned-per-vehicle-anomaly-baselines handler from slice 0062 —
// same dispatch+stream loop, no persistence (one-shot narration; no
// conversation to record).
//
//   request JSON {vehicle_id, days?}
//     ↓
//   resolve provider via *provider.Registry.For("range-prediction-model")
//     ↓
//   open SSE writer (internal/ai/stream.New) to the HTTP response
//     ↓
//   run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("range-prediction-model", …) so when ai_mode='off' or
// the per-feature toggle is off the guard returns 404 BEFORE this
// handler ever sees the request (ADR-015 §I6).
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic Projected Range page
//     served by GET /api/v1/vehicles/{id}/range/projection (rendered
//     via the SPA route /projected-range) is unchanged. This handler
//     is an OPT-IN add-on; off-mode users never see it.
//   - I4 zero egress:    when ai_mode='off' the guard returns 404
//                        before any provider call is made; the
//                        deterministic trainer at internal/ml/range
//                        is reachable only via the AI tool path.
//   - I7 per-feature:    the route is gated by
//                        guard.Wrap("range-prediction-model").
//   - I9 redaction:      PolicyChatbot (deny-all tagged redaction) is
//                        installed by dispatch.Run from the strategy.
//   - I10 type system:   the AI surface lives entirely under
//                        /api/v1/ai/*; no field on the existing
//                        baseline JSON shape is added or modified by
//                        this slice.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	rangepredictionmodel "github.com/ev-dev-labs/teslasync/internal/ai/strategies/range-prediction-model"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
	mlrange "github.com/ev-dev-labs/teslasync/internal/ml/range"
)

// maxIterations bounds the dispatcher's tool-loop. Range
// narration is two-tool-calls-then-answer (train_range_model FIRST,
// then query_range_prediction); a hard ceiling of 6 is generous for
// a model that occasionally retries a tool call once before
// settling. Mirrors aiLearnedAnomalyMaxIterations from slice 0062.
const maxIterations = 6

// defaultDays mirrors mlrange.DefaultDays. Kept as a separate
// const so the HTTP-input default is independently readable from the
// trainer default — a future change that shifts the trainer window
// won't silently shift the AI-handler window.
const defaultDays = 14

// maxDays is the upper bound that mirrors the tool's validate
// tag (lte=30) and mlrange.MaxDays. HTTP-side validation bounces
// obvious bad input (e.g. days=365) before we ever invoke the LLM.
const maxDays = 30

// Handler is the HTTP handler for
// POST /api/v1/ai/ml/range/train.
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

// NewHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on a
// nil so the wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	train_range_model + query_range_prediction (registered
//	by predict.RegisterRangePredictorTools in router.go).
//
// strat:      the range-prediction-model Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aimlrange: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aimlrange: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aimlrange: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// rangeRequest is the wire shape for
// POST /api/v1/ai/ml/range/train.
//
// VehicleID is required and must be > 0. Days is optional; when
// absent or zero, defaults to defaultDays. Days must be in
// 1..maxDays when explicitly set, mirroring the
// train_range_model tool's validate tag.
type rangeRequest struct {
	VehicleID int64 `json:"vehicle_id"`
	Days      int   `json:"days,omitempty"`
}

// parseRangeRequest decodes + validates the JSON body and returns
// the effective training lookback days. The parser writes a JSON 400
// on failure and returns ok=false so callers can exit before opening
// the SSE stream or resolving a provider.
func parseRangeRequest(w http.ResponseWriter, r *http.Request) (*rangeRequest, int, bool) {
	var body rangeRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return nil, 0, false
	}
	if body.VehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required and must be > 0")
		return nil, 0, false
	}
	if body.Days < 0 || body.Days > maxDays {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("days must be in 0..%d (0 = default)", maxDays))
		return nil, 0, false
	}
	days := body.Days
	if days == 0 {
		days = defaultDays
	}
	return &body, days, true
}

// ServeHTTP implements [http.Handler]. The request is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes a
// structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Decode + validate request body.
	body, days, ok := parseRangeRequest(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), rangepredictionmodel.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai range-prediction: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	// SubjectFromRequest returns "" if the header is absent; that's
	// the open-mode value the audit log treats as "anonymous".
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, rangepredictionmodel.FeatureID)

	// 4) Open the SSE writer. Stream.New writes the SSE response
	// headers, starts the consumer goroutine, and returns a child
	// ctx that cancels on stall — we pass that ctx to the
	// dispatcher so a stalled consumer kills the upstream call.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(rangepredictionmodel.FeatureID))
	if err != nil {
		// Non-flushable response writer (test recorder, etc.).
		// Emit a plain JSON 500 — the SSE headers were not sent.
		log.Error().Err(err).Msg("ai range-prediction: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context. The decorator chain reads the subject + feature-id
	// off the ctx for audit + rate limit accounting.
	prov, err := h.registry.For(ctx, rangepredictionmodel.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai range-prediction: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook. The
	// range-prediction-model strategy declares only read-only tools,
	// so the confirm hook never fires — but defence-in-depth: if a
	// future strategy edit adds a mutating tool by mistake, the
	// dispatcher will REJECT it instead of silently mutating fleet
	// state.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Range narration is NOT
	// conversational — there is no chat history. We hand the LLM a
	// deterministic prompt that asks it to call the two tools in
	// the prescribed order and narrate the diff.
	userMsg := fmt.Sprintf(
		"Explain the learned range model for vehicle %d over the last %d days. "+
			"Call train_range_model FIRST with vehicle_id=%d days=%d, then call query_range_prediction with vehicle_id=%d, then narrate the diff strictly from the tool replies.",
		body.VehicleID, days, body.VehicleID, days, body.VehicleID,
	)

	// 8) Run the dispatcher. The deferred WriteDone in dispatch.Run
	// closes the SSE stream cleanly on any path.
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
			Int("days", days).
			Msg("ai range-prediction: dispatcher returned error")
	}
}

// Compile-time assertion: Handler satisfies http.Handler.
var _ http.Handler = (*Handler)(nil)

// denyAllConfirm rejects every mutating tool as defence-in-depth for
// this read-only range-prediction narration surface.
func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// DriveStatsSource is the production *database.DB-backed adapter
// that satisfies mlrange.DriveStatsSource. It runs ONE pgx query
// scoped to the requested vehicle and lookback cutoff; rows are
// converted in-memory into the DriveSample slice the trainer
// expects (Wh/km, km/h, °C). No new SQL semantics — the same SI
// columns the deterministic RangeProjectionHandler at
// internal/api/range_projection_handler.go already reads
// (distance_m, energy_used_wh, avg_speed_mps, ambient_temp_c_avg
// per migration 000185).
type DriveStatsSource struct {
	db *database.DB
}

// NewDriveStatsSource constructs the adapter. Panics on a nil DB
// so the wiring bug surfaces at boot, not at first request.
func NewDriveStatsSource(db *database.DB) *DriveStatsSource {
	if db == nil {
		panic("aimlrange: NewDriveStatsSource: nil *database.DB")
	}
	return &DriveStatsSource{db: db}
}

// SamplesForVehicle implements mlrange.DriveStatsSource. Returns
// drive sample slice (Wh/km, km/h, °C) for the requested vehicle
// scoped to the lookback cutoff.
//
// Implementation notes:
//
//   - Filter `distance_m > 8046.72` (5 miles) drops sub-5-mile
//     drives whose Wh/km is dominated by climate preconditioning
//     and not representative of the steady-state efficiency we
//     want to learn. Mirrors the existing RangeProjectionHandler's
//     scenario-projection floor.
//   - Filter `start_soc_pct > end_soc_pct` drops drives where the
//     vehicle gained net charge (e.g. regenerative-only short
//     downhill) which would produce negative Wh/km after the
//     `energy_used_wh / distance_km` math.
//   - Filter `energy_used_wh > 0` and `avg_speed_mps IS NOT NULL`
//     and `ambient_temp_c_avg IS NOT NULL` ensures the trainer's
//     per-bucket math has all three SI inputs.
//   - Conversion: avg_speed_mps × 3.6 = km/h; energy_used_wh /
//     (distance_m / 1000.0) = Wh/km.
//   - The cutoff time is computed by the trainer (Go-side
//     `time.Now().UTC() - days*24h`); we pass it through verbatim
//     so the test fake's deterministic clock seam stays tight.
func (s *DriveStatsSource) SamplesForVehicle(ctx context.Context, vehicleID int64, cutoff time.Time) ([]mlrange.DriveSample, error) {
	if vehicleID <= 0 {
		return []mlrange.DriveSample{}, nil
	}
	rows, err := s.db.Pool.Query(ctx, `
		SELECT energy_used_wh, distance_m, avg_speed_mps, ambient_temp_c_avg
		FROM drives
		WHERE vehicle_id = $1
		  AND started_at > $2
		  AND distance_m > 8046.72
		  AND start_soc_pct > end_soc_pct
		  AND energy_used_wh IS NOT NULL AND energy_used_wh > 0
		  AND avg_speed_mps IS NOT NULL
		  AND ambient_temp_c_avg IS NOT NULL`,
		vehicleID, cutoff)
	if err != nil {
		return nil, fmt.Errorf("DriveStatsSource: vehicle %d cutoff %s: %w", vehicleID, cutoff.Format(time.RFC3339), err)
	}
	defer rows.Close()
	out := make([]mlrange.DriveSample, 0, 32)
	for rows.Next() {
		var energyWh, distanceM, avgSpeedMps, ambientC float64
		if err := rows.Scan(&energyWh, &distanceM, &avgSpeedMps, &ambientC); err != nil {
			return nil, fmt.Errorf("DriveStatsSource: scan: %w", err)
		}
		if distanceM <= 0 {
			// Defence: the WHERE clause already filters
			// distance_m > 8046.72, but a future schema change
			// must not slip a zero through.
			continue
		}
		distanceKm := distanceM / 1000.0
		whPerKm := energyWh / distanceKm
		out = append(out, mlrange.DriveSample{
			WhPerKm:     whPerKm,
			AvgSpeedKmh: avgSpeedMps * 3.6,
			AmbientTemp: ambientC,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("DriveStatsSource: rows.Err: %w", err)
	}
	return out, nil
}

// Compile-time assertion: DriveStatsSource satisfies mlrange.DriveStatsSource.
var _ mlrange.DriveStatsSource = (*DriveStatsSource)(nil)
