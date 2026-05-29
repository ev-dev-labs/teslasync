package aitempimpact

// Phase-50 / 0032 — T2 cabin temperature impact narrative.
//
// This opt-in AI handler streams a read-only narration over the same
// deterministic aggregates rendered by /temperature-impact. The body is
// validated before SSE opens so malformed input stays a plain JSON 400.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	cabintemperatureimpactnarrative "github.com/ev-dev-labs/teslasync/internal/ai/strategies/cabin-temperature-impact-narrative"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/forecast"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// maxIterations bounds the dispatcher's
// tool-loop. The strategy is at most query_temperature_impact →
// answer (with optional retries). A hard ceiling of 8 is
// generous, matching aiCostForecastNarrationMaxIterations /
// aiBatteryHealthMaxIterations.
const maxIterations = 8

// minDrives is the minimum drive count
// (across all temperature buckets) the deterministic aggregator
// needs to produce a meaningful temperature-impact narrative.
// Below this threshold has_enough_data flips false and the
// narrator says so plainly. The bound mirrors the chart's
// implicit threshold — fewer than ~10 drives produces noisy
// buckets where best/worst flip on a single outlier.
const minDrives = 10

const (
	driveStatsMetersPerMile  = 1609.344
	driveStatsTwoMilesMeters = 2.0 * driveStatsMetersPerMile
)

// request is the JSON body shape this
// handler accepts. The shape mirrors the
// /api/v1/analytics/temperature-impact?vehicle_id= query-string
// contract — vehicle_id is required, no other params — kept as a
// JSON body so the SPA can post from the same form state the
// temperature-impact page already uses.
type request struct {
	VehicleID int64 `json:"vehicle_id"`
}

// Handler is the HTTP handler for
// POST /api/v1/ai/climate/temperature-impact/narrate.
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
// non-pointer arguments are required; the constructor panics on a
// nil so the wiring bug surfaces at boot, not at first request.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aitempimpact: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aitempimpact: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aitempimpact: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// parseCabinTemperatureImpactBody decodes + validates the JSON
// body. Pulled out so the validator-only test can exercise the
// same parsing without constructing a full handler with stub
// deps. The function writes a 400 on failure and returns the
// (req, ok) pair so the caller can early-return.
func parseCabinTemperatureImpactBody(w http.ResponseWriter, r *http.Request) (*request, bool) {
	if r.Body == nil {
		httpx.WriteError(w, http.StatusBadRequest, "request body is required")
		return nil, false
	}
	defer r.Body.Close()
	var req request
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

// ServeHTTP implements [http.Handler]. The body is decoded, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes
// a structured frame onto the SSE stream (when the writer has
// been opened) or a plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, ok := parseCabinTemperatureImpactBody(w, r)
	if !ok {
		return
	}

	// Resolve provider via the registry (pre-stream check).
	if _, err := h.registry.For(r.Context(), cabintemperatureimpactnarrative.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai cabin-temperature-impact-narrative: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// Subject + feature-id annotations for audit/rate-limit.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, cabintemperatureimpactnarrative.FeatureID)

	// Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(cabintemperatureimpactnarrative.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai cabin-temperature-impact-narrative: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// Resolve the per-feature provider from the
	// (now-annotated) context.
	prov, err := h.registry.For(ctx, cabintemperatureimpactnarrative.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai cabin-temperature-impact-narrative: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// Build the dispatcher with the deny-all confirm hook.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// Synthesise the user message. Cabin-temperature-impact
	// narration is NOT conversational here — there is no chat
	// history. We hand the LLM a deterministic prompt that
	// asks it to call the single read-only tool in scope and
	// narrate the result, with explicit honest-method cues so
	// the narration discloses the descriptive-aggregate
	// nature of the surface.
	userMsg := fmt.Sprintf(
		"Narrate the cabin temperature impact on driving efficiency for vehicle %d. "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call query_temperature_impact with vehicle_id=%d to fetch the deterministic "+
			"temperature-impact envelope. "+
			"Narrate the result in 2-3 sentences grounded strictly in the tool reply, calling out the "+
			"best and worst temperature buckets (label + avg_battery_pct_per_100km), the seasonal "+
			"monthly trend if material, and the most relevant deterministic insight. "+
			"ALWAYS surface the method honestly: this is a descriptive aggregate of recent drives "+
			"grouped by ambient temperature, NOT a forecast or regression model. "+
			"Remember: you NEVER change the aggregates or invent percentages — you EXPLAIN them. "+
			"If has_enough_data is false, say so plainly rather than inventing a percentage drop or "+
			"a best/worst bucket.",
		body.VehicleID, body.VehicleID,
	)

	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("vehicle_id", body.VehicleID).
			Msg("ai cabin-temperature-impact-narrative: dispatcher returned error")
	}
}

var _ http.Handler = (*Handler)(nil)

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// AITemperatureImpactSource reuses the canonical aggregates charted by the baseline page.
type AITemperatureImpactSource struct {
	db *database.DB
}

// NewAITemperatureImpactSource constructs the adapter. Panics on
// a nil *database.DB so a wiring mistake surfaces at boot rather
// than as a nil-deref on first AI request.
func NewAITemperatureImpactSource(db *database.DB) *AITemperatureImpactSource {
	if db == nil {
		panic("aitempimpact: NewAITemperatureImpactSource: nil *database.DB")
	}
	return &AITemperatureImpactSource{db: db}
}

// QueryTemperatureImpact returns a transparent bucketed/correlation envelope
// without route geometry, addresses, VINs, or place names.
func (a *AITemperatureImpactSource) QueryTemperatureImpact(ctx context.Context, vehicleID int64) (*forecast.TemperatureImpact, error) {
	if vehicleID <= 0 {
		return nil, errors.New("api ai cabin-temperature-impact-narrative: vehicle_id must be > 0")
	}

	envelope := &forecast.TemperatureImpact{
		VehicleID:         vehicleID,
		MinRequiredDrives: minDrives,
		Method:            "Bucket aggregate of recent drives grouped by ambient cabin temperature; rolling 12-month seasonal trend",
		Assumptions: []string{
			"Buckets are descriptive aggregates of recent drives grouped by ambient temperature (Below 0°C, 0-10°C, 10-20°C, 20-30°C, Above 30°C); they are NOT a forecast or a regression model.",
			"Monthly trend is a rolling 12-month average of avg_temp_c paired with avg_efficiency.",
			fmt.Sprintf("Minimum sample size for a meaningful narrative is %d drives across all buckets; below this threshold has_enough_data is false.", minDrives),
		},
		Buckets:      []forecast.TemperatureImpactBucket{},
		MonthlyTrend: []forecast.TemperatureImpactMonth{},
		Insights:     []string{},
	}

	// Bucketed efficiency aggregates. Mirrors the SQL in
	// TempImpactHandler.Get exactly so the numbers match the
	// chart 1:1.
	bucketRows, err := a.db.Pool.Query(ctx, `
		SELECT
		  CASE
		    WHEN ambient_temp_c_avg < 0 THEN 'Below 0°C'
		    WHEN ambient_temp_c_avg < 10 THEN '0-10°C'
		    WHEN ambient_temp_c_avg < 20 THEN '10-20°C'
		    WHEN ambient_temp_c_avg < 30 THEN '20-30°C'
		    ELSE 'Above 30°C'
		  END as temp_bucket,
		  COUNT(*) as drive_count,
		  AVG(distance_m / 1000.0) as avg_distance_km,
		  AVG(duration_s) as avg_duration_s,
		  AVG(CASE WHEN distance_m > 0
		           THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100
		           ELSE 0 END) as avg_battery_pct_per_100km,
		  AVG(ambient_temp_c_avg) as avg_temp
		FROM drives
		WHERE vehicle_id = $1 AND distance_m > $3 AND ambient_temp_c_avg IS NOT NULL
		GROUP BY temp_bucket
		ORDER BY MIN(ambient_temp_c_avg)`, vehicleID, driveStatsMetersPerMile, driveStatsTwoMilesMeters)
	if err != nil {
		return nil, fmt.Errorf("api ai cabin-temperature-impact-narrative: bucket query: %w", err)
	}
	defer bucketRows.Close()

	totalDrives := 0
	for bucketRows.Next() {
		var b forecast.TemperatureImpactBucket
		var avgDist, avgDur, avgBat, avgTemp *float64
		if err := bucketRows.Scan(&b.Label, &b.DriveCount, &avgDist, &avgDur, &avgBat, &avgTemp); err != nil {
			return nil, fmt.Errorf("api ai cabin-temperature-impact-narrative: bucket scan: %w", err)
		}
		if avgDist != nil {
			b.AvgDistanceKm = math.Round(*avgDist*100) / 100
		}
		if avgDur != nil {
			b.AvgDurationS = math.Round(*avgDur*100) / 100
		}
		if avgBat != nil {
			b.AvgBatteryPer100Km = math.Round(*avgBat*100) / 100
		}
		if avgTemp != nil {
			b.AvgTempC = math.Round(*avgTemp*10) / 10
		}
		totalDrives += b.DriveCount
		envelope.Buckets = append(envelope.Buckets, b)
	}
	if err := bucketRows.Err(); err != nil {
		return nil, fmt.Errorf("api ai cabin-temperature-impact-narrative: bucket iteration: %w", err)
	}

	envelope.SampleSize = totalDrives
	envelope.HasEnoughData = totalDrives >= minDrives

	// Seasonal monthly trend (rolling 12 months). Mirrors the
	// SQL in TempImpactHandler.Get.
	trendRows, err := a.db.Pool.Query(ctx, `
		SELECT DATE_TRUNC('month', started_at) as month,
		       AVG(ambient_temp_c_avg) as avg_temp,
		       AVG(CASE WHEN distance_m > 0
		                THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100
		                ELSE 0 END) as avg_efficiency,
		       COUNT(*) as drive_count,
		       SUM(distance_m / 1000.0) as total_distance
		FROM drives
		WHERE vehicle_id = $1 AND distance_m > $3 AND ambient_temp_c_avg IS NOT NULL
		  AND started_at > NOW() - interval '12 months'
		GROUP BY month
		ORDER BY month`, vehicleID, driveStatsMetersPerMile, driveStatsTwoMilesMeters)
	if err != nil {
		return nil, fmt.Errorf("api ai cabin-temperature-impact-narrative: trend query: %w", err)
	}
	defer trendRows.Close()

	for trendRows.Next() {
		var m forecast.TemperatureImpactMonth
		var monthTime interface{}
		var avgTemp, avgEff, totalDist *float64
		if err := trendRows.Scan(&monthTime, &avgTemp, &avgEff, &m.DriveCount, &totalDist); err != nil {
			return nil, fmt.Errorf("api ai cabin-temperature-impact-narrative: trend scan: %w", err)
		}
		if mt, ok := monthTime.(interface{ Format(string) string }); ok {
			m.Month = mt.Format("2006-01")
		}
		if avgTemp != nil {
			m.AvgTempC = math.Round(*avgTemp*10) / 10
		}
		if avgEff != nil {
			m.AvgEfficiency = math.Round(*avgEff*100) / 100
		}
		if totalDist != nil {
			m.TotalDistanceKm = math.Round(*totalDist*10) / 10
		}
		envelope.MonthlyTrend = append(envelope.MonthlyTrend, m)
	}
	if err := trendRows.Err(); err != nil {
		return nil, fmt.Errorf("api ai cabin-temperature-impact-narrative: trend iteration: %w", err)
	}

	// Best/worst bucket and deterministic insights — pure
	// derivations from the bucket aggregate. The chart's
	// "optimal range" panel does the same in JS on the SPA.
	envelope.BestBucket, envelope.WorstBucket = pickBestWorstBuckets(envelope.Buckets, envelope.HasEnoughData)
	envelope.Insights = buildTemperatureImpactInsights(envelope)

	return envelope, nil
}

// pickBestWorstBuckets returns the lowest- and highest-efficiency buckets.
func pickBestWorstBuckets(buckets []forecast.TemperatureImpactBucket, hasEnoughData bool) (*forecast.TemperatureImpactBucket, *forecast.TemperatureImpactBucket) {
	if !hasEnoughData || len(buckets) == 0 {
		return nil, nil
	}
	candidates := make([]forecast.TemperatureImpactBucket, 0, len(buckets))
	for _, b := range buckets {
		if b.DriveCount > 0 && b.AvgBatteryPer100Km > 0 {
			candidates = append(candidates, b)
		}
	}
	if len(candidates) == 0 {
		return nil, nil
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		return candidates[i].AvgBatteryPer100Km < candidates[j].AvgBatteryPer100Km
	})
	best := candidates[0]
	worst := candidates[len(candidates)-1]
	return &best, &worst
}

// buildTemperatureImpactInsights generates 0-3 deterministic
// short insight strings the narrator may quote. Mirrors the
// chart's "optimal range" panel + tips section semantics. The
// insights are pure derivations of the bucket aggregate; they
// never invent numbers.
func buildTemperatureImpactInsights(env *forecast.TemperatureImpact) []string {
	if env == nil || !env.HasEnoughData || env.BestBucket == nil || env.WorstBucket == nil {
		return []string{}
	}
	insights := make([]string, 0, 3)
	insights = append(insights,
		fmt.Sprintf("Best efficiency in the %s bucket at %.2f%% battery per 100 km (over %d drives).",
			env.BestBucket.Label, env.BestBucket.AvgBatteryPer100Km, env.BestBucket.DriveCount))
	insights = append(insights,
		fmt.Sprintf("Worst efficiency in the %s bucket at %.2f%% battery per 100 km (over %d drives).",
			env.WorstBucket.Label, env.WorstBucket.AvgBatteryPer100Km, env.WorstBucket.DriveCount))
	if env.BestBucket.AvgBatteryPer100Km > 0 {
		ratio := env.WorstBucket.AvgBatteryPer100Km / env.BestBucket.AvgBatteryPer100Km
		if ratio > 1 {
			pct := (ratio - 1) * 100
			insights = append(insights,
				fmt.Sprintf("The worst bucket consumes about %.0f%% more energy per 100 km than the best bucket.", pct))
		}
	}
	return insights
}

var _ forecast.TemperatureImpactSource = (*AITemperatureImpactSource)(nil)
