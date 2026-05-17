package api

// Phase-50 / 0062 — ML1 Learned per-vehicle anomaly baselines.
//
// ai_ml_anomaly_baseline_handler.go implements the LLM-backed handler
// at POST /api/v1/ai/ml/anomaly-baselines/train. The flow mirrors
// the U4 anomaly-explanations handler — same dispatch+stream loop,
// no persistence (one-shot narration; no conversation to record).
//
//   request JSON {vehicle_id, days?}
//     ↓
//   resolve provider via *provider.Registry.For("learned-per-vehicle-anomaly-baselines")
//     ↓
//   open SSE writer (internal/ai/stream.New) to the HTTP response
//     ↓
//   run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("learned-per-vehicle-anomaly-baselines", …) so when
// ai_mode='off' or the per-feature toggle is off the guard returns
// 404 BEFORE this handler ever sees the request (ADR-015 §I6).
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic Z-score detector + static
//     safeRanges-based explanation served by
//     GET /api/v1/analytics/anomalies (rendered via the SPA route
//     /anomaly-detection) is unchanged. This handler is an OPT-IN
//     add-on; off-mode users never see it.
//   - I4 zero egress:    when ai_mode='off' the guard returns 404
//                        before any provider call is made; the
//                        deterministic trainer at internal/ml/anomaly
//                        is reachable only via the AI tool path.
//   - I7 per-feature:    the route is gated by
//                        guard.Wrap("learned-per-vehicle-anomaly-baselines").
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
	learnedanomalybaselines "github.com/ev-dev-labs/teslasync/internal/ai/strategies/learned-per-vehicle-anomaly-baselines"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/ml/anomaly"
)

// aiLearnedAnomalyMaxIterations bounds the dispatcher's tool-loop.
// Learned-baseline narration is two-tool-calls-then-answer
// (train_anomaly_baseline FIRST, then query_anomaly_baseline); a
// hard ceiling of 6 is generous for a model that occasionally
// retries a tool call once before settling. Mirrors aiAnomalyMaxIterations
// from slice 0014 with a +2 budget for the second tool call.
const aiLearnedAnomalyMaxIterations = 6

// aiLearnedAnomalyDefaultDays mirrors anomaly.DefaultDays. Kept as a
// separate const so the HTTP-input default is independently
// readable from the trainer default — a future change that shifts
// the trainer window won't silently shift the AI-handler window.
const aiLearnedAnomalyDefaultDays = 7

// aiLearnedAnomalyMaxDays is the upper bound that mirrors the tool's
// validate tag (lte=30) and anomaly.MaxDays. HTTP-side validation
// bounces obvious bad input (e.g. days=365) before we ever invoke
// the LLM.
const aiLearnedAnomalyMaxDays = 30

// AILearnedAnomalyBaselineHandler is the HTTP handler for
// POST /api/v1/ai/ml/anomaly-baselines/train.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type AILearnedAnomalyBaselineHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAILearnedAnomalyBaselineHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on a
// nil so the wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//             train_anomaly_baseline + query_anomaly_baseline
//             (registered by tools.RegisterLearnedAnomalyBaselineTools
//             in router.go).
// strat:      the learned-per-vehicle-anomaly-baselines Strategy
//             (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewAILearnedAnomalyBaselineHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AILearnedAnomalyBaselineHandler {
	switch {
	case registry == nil:
		panic("api: NewAILearnedAnomalyBaselineHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAILearnedAnomalyBaselineHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAILearnedAnomalyBaselineHandler: nil strategy.Strategy")
	}
	return &AILearnedAnomalyBaselineHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiLearnedAnomalyMaxIterations,
	}
}

// aiLearnedAnomalyRequest is the wire shape for
// POST /api/v1/ai/ml/anomaly-baselines/train.
//
// VehicleID is required and must be > 0. Days is optional; when
// absent or zero, defaults to aiLearnedAnomalyDefaultDays. Days
// must be in 1..aiLearnedAnomalyMaxDays when explicitly set,
// mirroring the train_anomaly_baseline tool's validate tag.
type aiLearnedAnomalyRequest struct {
	VehicleID int64 `json:"vehicle_id"`
	Days      int   `json:"days,omitempty"`
}

// ServeHTTP implements [http.Handler]. The request is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes a
// structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *AILearnedAnomalyBaselineHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Decode + validate request body.
	var body aiLearnedAnomalyRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.VehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id is required and must be > 0")
		return
	}
	if body.Days < 0 || body.Days > aiLearnedAnomalyMaxDays {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("days must be in 0..%d (0 = default)", aiLearnedAnomalyMaxDays))
		return
	}
	days := body.Days
	if days == 0 {
		days = aiLearnedAnomalyDefaultDays
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), learnedanomalybaselines.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai learned-anomaly: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	// SubjectFromRequest returns "" if the header is absent; that's
	// the open-mode value the audit log treats as "anonymous".
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, learnedanomalybaselines.FeatureID)

	// 4) Open the SSE writer. Stream.New writes the SSE response
	// headers, starts the consumer goroutine, and returns a child
	// ctx that cancels on stall — we pass that ctx to the
	// dispatcher so a stalled consumer kills the upstream call.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(learnedanomalybaselines.FeatureID))
	if err != nil {
		// Non-flushable response writer (test recorder, etc.).
		// Emit a plain JSON 500 — the SSE headers were not sent.
		log.Error().Err(err).Msg("ai learned-anomaly: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context. The decorator chain reads the subject + feature-id
	// off the ctx for audit + rate limit accounting.
	prov, err := h.registry.For(ctx, learnedanomalybaselines.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai learned-anomaly: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook. The
	// learned-anomaly strategy declares only read-only tools, so
	// the confirm hook never fires — but defence-in-depth: if a
	// future strategy edit adds a mutating tool by mistake, the
	// dispatcher will REJECT it instead of silently mutating fleet
	// state.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Learned-baseline narration is
	// NOT conversational — there is no chat history. We hand the
	// LLM a deterministic prompt that asks it to call the two
	// tools in the prescribed order and narrate the diff.
	userMsg := fmt.Sprintf(
		"Explain the learned anomaly baseline for vehicle %d over the last %d days. "+
			"Call train_anomaly_baseline FIRST with vehicle_id=%d days=%d, then call query_anomaly_baseline with vehicle_id=%d, then narrate the diff strictly from the tool replies.",
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
			Msg("ai learned-anomaly: dispatcher returned error")
	}
}

// Compile-time assertion: AILearnedAnomalyBaselineHandler satisfies http.Handler.
var _ http.Handler = (*AILearnedAnomalyBaselineHandler)(nil)

// AISignalSampleSource is the production *database.DB-backed adapter
// that satisfies anomaly.SignalSampleSource. It runs ONE pgx query
// scoped to the requested vehicle, lookback days, and signal
// allowlist; rows are bucketed in-memory into the per-signal
// observation slices the trainer expects. No new SQL semantics —
// the same signal_log columns the deterministic detector at
// internal/api/anomaly_handler.go already reads.
type AISignalSampleSource struct {
	db *database.DB
}

// NewAISignalSampleSource constructs the adapter. Panics on a nil
// DB so the wiring bug surfaces at boot, not at first request.
func NewAISignalSampleSource(db *database.DB) *AISignalSampleSource {
	if db == nil {
		panic("api: NewAISignalSampleSource: nil *database.DB")
	}
	return &AISignalSampleSource{db: db}
}

// SamplesForVehicle implements anomaly.SignalSampleSource. Returns
// per-signal observation slices for the requested vehicle scoped to
// the lookback window and the signal allowlist.
//
// Implementation note: a single SELECT with a `field = ANY($3)` IN
// list is much cheaper than one round-trip per signal — the
// signal_log hypertable's primary index is (vehicle_id, ts), so
// the selectivity comes from the time predicate; the field
// allowlist is a final-stage filter.
func (s *AISignalSampleSource) SamplesForVehicle(ctx context.Context, vehicleID int64, days int, signals []string) (map[string][]float64, error) {
	out := make(map[string][]float64, len(signals))
	for _, sig := range signals {
		out[sig] = nil
	}
	if vehicleID <= 0 || days <= 0 || len(signals) == 0 {
		return out, nil
	}
	since := time.Now().UTC().Add(-time.Duration(days) * 24 * time.Hour)
	rows, err := s.db.Pool.Query(ctx, `
		SELECT field, COALESCE(float_value, int_value::float8) AS v
		FROM signal_log
		WHERE vehicle_id = $1
		  AND ts > $2
		  AND field = ANY($3)
		  AND (float_value IS NOT NULL OR int_value IS NOT NULL)`,
		vehicleID, since, signals)
	if err != nil {
		return nil, fmt.Errorf("AISignalSampleSource: vehicle %d days %d: %w", vehicleID, days, err)
	}
	defer rows.Close()
	for rows.Next() {
		var field string
		var v float64
		if err := rows.Scan(&field, &v); err != nil {
			return nil, fmt.Errorf("AISignalSampleSource: scan: %w", err)
		}
		out[field] = append(out[field], v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("AISignalSampleSource: rows.Err: %w", err)
	}
	return out, nil
}

// Compile-time assertion: AISignalSampleSource satisfies anomaly.SignalSampleSource.
var _ anomaly.SignalSampleSource = (*AISignalSampleSource)(nil)
