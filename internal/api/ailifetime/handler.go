package ailifetime

// Phase-50 / 0041 — X2 Lifetime stats Q&A.
//
// POST /api/v1/ai/analytics/lifetime/qa streams one-shot read-only Q&A
// grounded in deterministic lifetime stats. The body is validated before
// SSE starts so bad input stays a normal JSON 400; ADR-015 guard wrapping
// keeps the route hidden in off-mode without changing the baseline page.

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
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
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

// aiLifetimeStatsQAMaxQuestionChars bounds user input before SSE starts and
// matches the retrieval tool's own query cap.
const aiLifetimeStatsQAMaxQuestionChars = 1024

// aiLifetimeStatsQARequest scopes a natural-language question to one vehicle.
type aiLifetimeStatsQARequest struct {
	VehicleID int64  `json:"vehicle_id"`
	Question  string `json:"question"`
}

func writeError(w http.ResponseWriter, status int, msg string) {
	httpx.WriteError(w, status, msg)
}

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// Handler is the HTTP handler for
// POST /api/v1/ai/analytics/lifetime/qa.
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

// NewHandler constructs the handler and panics on nil dependencies so
// wiring bugs fail at boot instead of the first AI request. toolReg must
// contain query_lifetime_stats and retrieve_analytics_chunks.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("api: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
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
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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

	prov, err := h.registry.For(ctx, lifetimestatsqa.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai lifetime-stats-qa: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

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

// Compile-time assertion: Handler satisfies http.Handler.
var _ http.Handler = (*Handler)(nil)

// Production wiring for the lifetime.LifetimeStatsSource adapter.

// LifetimeStatsSource is the production lifetime.LifetimeStatsSource.
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
type LifetimeStatsSource struct {
	db *database.DB
}

// NewLifetimeStatsSource panics on nil DB so wiring mistakes fail at boot.
func NewLifetimeStatsSource(db *database.DB) *LifetimeStatsSource {
	if db == nil {
		panic("api: NewLifetimeStatsSource: nil *database.DB")
	}
	return &LifetimeStatsSource{db: db}
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
func (a *LifetimeStatsSource) LifetimeStats(ctx context.Context, vehicleID int64) (*lifetime.LifetimeStatsEnvelope, error) {
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

// Compile-time assertion: LifetimeStatsSource satisfies
// lifetime.LifetimeStatsSource.
var _ lifetime.LifetimeStatsSource = (*LifetimeStatsSource)(nil)
