package api

// Phase-50 / 0041 — X2 Lifetime stats Q&A.
//
// ai_lifetime_stats_qa_handler.go implements the LLM-backed handler
// at POST /api/v1/ai/analytics/lifetime/qa. The flow mirrors
// ai_vampire_drain_handler.go (same dispatch+stream loop, no
// persistence — one-shot read-only Q&A):
//
//	URL  /api/v1/ai/analytics/lifetime/qa
//	  ↓
//	resolve provider via *provider.Registry.For("lifetime-stats-qa")
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("lifetime-stats-qa", …) so when ai_mode='off' or the
// per-feature toggle is off the guard returns 404 BEFORE this
// handler ever sees the request (ADR-015 §I6).
//
// The JSON body (vehicle_id + question) is parsed BEFORE opening
// the SSE stream so a malformed input surfaces as a plain JSON 400
// (rather than a streamed error frame the SPA's QueryError will
// struggle to render meaningfully).
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic /lifetime-stats page
//     (and its alias /analytics/lifetime added by this slice) — hero
//     card, key stats grid, achievements gallery, fun-facts cards,
//     personal-records panel, ownership timeline hitting GET
//     /api/v1/analytics/lifetime — is unchanged. This handler is
//     an OPT-IN add-on; off-mode users never see it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("lifetime-stats-qa").
//   - I9 redaction:       PolicyChatbot (deny-by-default; every PII
//     class redacted to a round-trip tag including vehicle name)
//     is installed by dispatch.Run from the strategy.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline JSON shape
//     is added or modified by this slice. The tool envelope's
//     fields live in the AI-only typed envelope returned by
//     query_lifetime_stats, not on the baseline /analytics/lifetime
//     response.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	lifetimestatsqa "github.com/ev-dev-labs/teslasync/internal/ai/strategies/lifetime-stats-qa"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/lifetime"
	apilifetime "github.com/ev-dev-labs/teslasync/internal/api/lifetime"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// aiLifetimeStatsQAMaxIterations bounds the dispatcher's tool-loop.
// The strategy is at most query_lifetime_stats → (optional)
// retrieve_analytics_chunks → answer (with optional retries). A
// hard ceiling of 8 is generous, matching the other narrator
// handlers (aiVampireDrainMaxIterations,
// aiPeriodCompareNarrationMaxIterations).
const aiLifetimeStatsQAMaxIterations = 8

// aiLifetimeStatsQAMaxQuestionChars caps the user-supplied
// natural-language question at the parser boundary so a giant
// payload cannot exhaust the dispatcher's token budget before any
// SSE stream is opened. The cap mirrors the
// retrieve_analytics_chunks tool's input cap — the LLM cannot ask
// for context wider than its own retrieval-tool input cap.
const aiLifetimeStatsQAMaxQuestionChars = 1024

// aiLifetimeStatsQARequest is the JSON body shape this handler
// accepts. The shape is purpose-built for Q&A: vehicle_id is the
// always-required scope (the SPA ALWAYS passes the active vehicle
// from page state, never the URL); question is the user's natural-
// language prompt to be answered.
type aiLifetimeStatsQARequest struct {
	VehicleID int64  `json:"vehicle_id"`
	Question  string `json:"question"`
}

// AILifetimeStatsQAHandler is the HTTP handler for
// POST /api/v1/ai/analytics/lifetime/qa.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type AILifetimeStatsQAHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAILifetimeStatsQAHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on a
// nil so the wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	query_lifetime_stats AND retrieve_analytics_chunks
//	(registered by lifetime.RegisterLifetimeStatsQATools in
//	router.go).
//
// strat:      the lifetime-stats-qa Strategy (one per process).
// headerName: forward-auth header name; used to extract subject for audit.
func NewAILifetimeStatsQAHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AILifetimeStatsQAHandler {
	switch {
	case registry == nil:
		panic("api: NewAILifetimeStatsQAHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAILifetimeStatsQAHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAILifetimeStatsQAHandler: nil strategy.Strategy")
	}
	return &AILifetimeStatsQAHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiLifetimeStatsQAMaxIterations,
	}
}

// parseLifetimeStatsQABody decodes + validates the JSON body. Pulled
// out so the validator-only test can exercise the same parsing
// without constructing a full handler with stub deps. The function
// writes a 400 on failure and returns the (req, ok) pair so the
// caller can early-return.
func parseLifetimeStatsQABody(w http.ResponseWriter, r *http.Request) (*aiLifetimeStatsQARequest, bool) {
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "request body is required")
		return nil, false
	}
	defer r.Body.Close()

	var req aiLifetimeStatsQARequest
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
	if req.Question == "" {
		writeError(w, http.StatusBadRequest, "question is required")
		return nil, false
	}
	if len(req.Question) > aiLifetimeStatsQAMaxQuestionChars {
		writeError(w, http.StatusBadRequest, fmt.Sprintf(
			"question length %d exceeds cap %d",
			len(req.Question), aiLifetimeStatsQAMaxQuestionChars))
		return nil, false
	}
	return &req, true
}

// ServeHTTP implements [http.Handler]. The body is decoded, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes
// a structured frame onto the SSE stream (when the writer has been
// opened) or a plain JSON 4xx/5xx (before it has).
func (h *AILifetimeStatsQAHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the JSON body.
	body, ok := parseLifetimeStatsQABody(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), lifetimestatsqa.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai lifetime-stats-qa: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, lifetimestatsqa.FeatureID)

	// 4) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(lifetimestatsqa.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai lifetime-stats-qa: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-annotated)
	// context.
	prov, err := h.registry.For(ctx, lifetimestatsqa.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai lifetime-stats-qa: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Lifetime-stats Q&A is NOT
	// conversational here — there is no chat history. We hand the
	// LLM a deterministic prompt that scopes the user's question
	// to the in-scope vehicle and instructs the tool sequence
	// EXACTLY: query_lifetime_stats first, then OPTIONALLY
	// retrieve_analytics_chunks, then answer.
	userMsg := fmt.Sprintf(
		"Answer the following question about vehicle %d's all-time stats. "+
			"Question: %q. "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call query_lifetime_stats with vehicle_id=%d to fetch the deterministic envelope "+
			"(total_drives, total_distance_km, total_driving_hours, longest_drive_km, "+
			"highest_speed_kmh, avg_efficiency_wh_km, total_charge_sessions, total_energy_kwh, "+
			"total_charging_hours, total_charging_cost, gas_equivalent_cost, total_savings, "+
			"co2_offset_kg, trees_equivalent, earth_circumferences, moon_trips, days_on_road, "+
			"homes_equivalent_days, first_drive_date, ownership_days, most_active_day_of_week, "+
			"most_active_hour, the personal-records, and the achievements list). "+
			"(2) OPTIONALLY call retrieve_analytics_chunks with vehicle_id-scoped natural-language "+
			"queries restricted to allowed source_types (analytics_lifetime, drive_summary, "+
			"charge_session) if you need additional per-event context — answer gracefully when "+
			"zero chunks are returned. "+
			"Answer in 1-3 sentences grounded strictly in the tool reply, addressing the user's "+
			"question directly. "+
			"Remember: you NEVER invent numbers — you ANSWER from the deterministic envelope. "+
			"If total_drives is 0 or total_charge_sessions is 0 or the field relevant to the "+
			"question is zero, say so plainly rather than inventing an estimate. "+
			"Refuse politely if the user's question targets a different vehicle than %d.",
		body.VehicleID, body.Question, body.VehicleID, body.VehicleID,
	)

	// 8) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("vehicle_id", body.VehicleID).
			Int("question_len", len(body.Question)).
			Msg("ai lifetime-stats-qa: dispatcher returned error")
	}
}

// Compile-time assertion: AILifetimeStatsQAHandler satisfies http.Handler.
var _ http.Handler = (*AILifetimeStatsQAHandler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the tool interface declared by
// internal/ai/tools/lifetime_stats_qa.go. Kept in the same file as
// the handler so the wiring intent is local to the slice; mirrors
// the period-compare-narration slice's AIPeriodCompareSource pattern
// and the vampire-drain-explanation slice's AIVampireDrainSource
// pattern.
// ---------------------------------------------------------------------

// AILifetimeStatsSource is the production lifetime.LifetimeStatsSource.
// It delegates to the SHARED api.ComputeLifetimeStats helper that
// also backs the canonical baseline GET /api/v1/analytics/lifetime
// handler so the AI Q&A is grounded in the SAME deterministic
// envelope the chart and metric cards on /lifetime-stats render.
// No new SQL is added by this slice.
//
// Refactoring the existing LifetimeHandler.GetLifetimeStats to pull
// its core into the package-level ComputeLifetimeStats helper (and
// having both call sites use it) was the deliberate choice over
// duplicating the SQL/math here.
//
// The struct holds *database.DB; the constructor panics on a nil so
// a wiring bug surfaces at boot.
type AILifetimeStatsSource struct {
	db *database.DB
}

// NewAILifetimeStatsSource constructs the adapter. Panics on a nil
// *database.DB so a wiring mistake surfaces at boot rather than as
// a nil-deref on first AI request.
func NewAILifetimeStatsSource(db *database.DB) *AILifetimeStatsSource {
	if db == nil {
		panic("api: NewAILifetimeStatsSource: nil *database.DB")
	}
	return &AILifetimeStatsSource{db: db}
}

// LifetimeStats implements lifetime.LifetimeStatsSource. Composes the
// SAME api.ComputeLifetimeStats helper LifetimeHandler.GetLifetimeStats
// uses so the returned envelope is numerically identical to what
// GET /api/v1/analytics/lifetime produces — the AI surface is
// grounded in the SAME deterministic model the chart renders.
//
// The function does NOT recompute or override anything the canonical
// handler computes; it only reshapes the existing typed
// LifetimeStatsResult into the typed [lifetime.LifetimeStatsEnvelope]
// the LLM can quote. The achievements list returned here NEVER
// carries an UnlockedAt timestamp because the canonical handler is
// the only path that records unlocks and emits SSE celebration
// events (the read-only AI tool path must not have side effects).
func (a *AILifetimeStatsSource) LifetimeStats(ctx context.Context, vehicleID int64) (*lifetime.LifetimeStatsEnvelope, error) {
	if vehicleID <= 0 {
		return nil, errors.New("api ai lifetime-stats-qa: vehicle_id must be > 0")
	}

	stats, err := apilifetime.ComputeLifetimeStats(ctx, a.db, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("api ai lifetime-stats-qa: ComputeLifetimeStats: %w", err)
	}
	if stats == nil {
		return nil, errors.New("api ai lifetime-stats-qa: ComputeLifetimeStats returned nil envelope")
	}

	achievements := make([]lifetime.LifetimeStatsAchievement, 0, len(stats.Achievements))
	for _, a := range stats.Achievements {
		achievements = append(achievements, lifetime.LifetimeStatsAchievement{
			ID:          a.ID,
			Name:        a.Name,
			Description: a.Description,
			Icon:        a.Icon,
			Unlocked:    a.Unlocked,
			UnlockedAt:  nil, // never populated on the AI tool path
			Progress:    a.Progress,
			Target:      a.Target,
			Current:     a.Current,
		})
	}

	return &lifetime.LifetimeStatsEnvelope{
		TotalDrives:       stats.TotalDrives,
		TotalDistanceKm:   stats.TotalDistanceKm,
		TotalDrivingHours: stats.TotalDrivingHours,
		LongestDriveKm:    stats.LongestDriveKm,
		HighestSpeedKmh:   stats.HighestSpeedKmh,
		AvgEfficiencyWhKm: stats.AvgEfficiencyWhKm,

		TotalChargeSessions: stats.TotalChargeSessions,
		TotalEnergyKwh:      stats.TotalEnergyKwh,
		TotalChargingHours:  stats.TotalChargingHours,
		TotalChargingCost:   stats.TotalChargingCost,

		GasEquivalentCost: stats.GasEquivalentCost,
		TotalSavings:      stats.TotalSavings,
		CO2OffsetKg:       stats.CO2OffsetKg,
		TreesEquivalent:   stats.TreesEquivalent,

		EarthCircumferences: stats.EarthCircumferences,
		MoonTrips:           stats.MoonTrips,
		DaysOnRoad:          stats.DaysOnRoad,
		HomesEquivalentDays: stats.HomesEquivalentDays,

		FirstDriveDate:      stats.FirstDriveDate,
		OwnershipDays:       stats.OwnershipDays,
		MostActiveDayOfWeek: stats.MostActiveDayOfWeek,
		MostActiveHour:      stats.MostActiveHour,

		LongestDriveRecord: lifetime.LifetimeStatsRecord{Value: stats.LongestDriveRecord.Value, Date: stats.LongestDriveRecord.Date},
		HighestSpeedRecord: lifetime.LifetimeStatsRecord{Value: stats.HighestSpeedRecord.Value, Date: stats.HighestSpeedRecord.Date},
		MaxChargeRecord:    lifetime.LifetimeStatsRecord{Value: stats.MaxChargeRecord.Value, Date: stats.MaxChargeRecord.Date},

		Achievements: achievements,
	}, nil
}

// Compile-time assertion: AILifetimeStatsSource satisfies
// lifetime.LifetimeStatsSource.
var _ lifetime.LifetimeStatsSource = (*AILifetimeStatsSource)(nil)
