package batterydegradation

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"

	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

const (
	defaultBatteryCapacityWh  = 75_000.0
	batteryHealthTimeout      = 8 * time.Second
	batteryHealthCacheTTL     = 5 * time.Minute
	batteryHealthSlowRequest  = 1500 * time.Millisecond
	batteryHistoryLimit       = 180
	batteryMinSOCSwing        = 20.0
	batteryRecentSessionLimit = 100
	batteryHealthCacheMaxSize = 1024
)

// Handler handles battery degradation prediction HTTP requests.
//
// Point-in-time fallback reads use signal.StateReader (ADR-002), while bounded
// historical capacity trends come from cagg_battery_daily.
type Handler struct {
	db                *database.DB
	state             signal.StateReader
	now               func() time.Time
	healthCacheMu     sync.RWMutex
	healthCache       map[int64]batteryHealthCacheEntry
	healthLoadLocksMu sync.Mutex
	healthLoadLocks   map[int64]*batteryHealthLoadLock
	healthLoader      func(context.Context, int64) (*batteryHealthResponse, batteryHealthTimings, error)
}

type batteryHealthCacheEntry struct {
	response  *batteryHealthResponse
	expiresAt time.Time
}

type batteryHealthLoadLock struct {
	mu   sync.Mutex
	refs int
}

type batteryHealthTimings struct {
	history  time.Duration
	summary  time.Duration
	charging time.Duration
	total    time.Duration
}

func NewHandler(db *database.DB, state signal.StateReader) *Handler {
	h := &Handler{
		db:              db,
		state:           state,
		now:             time.Now,
		healthCache:     make(map[int64]batteryHealthCacheEntry),
		healthLoadLocks: make(map[int64]*batteryHealthLoadLock),
	}
	h.healthLoader = h.buildBatteryHealth
	return h
}

func (h *Handler) Predict(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("teslasync/internal/api/batterydegradation").Start(
		r.Context(),
		"batterydegradation.Predict",
		trace.WithAttributes(attribute.String("http.route", "/api/v1/analytics/battery-degradation")),
	)
	defer span.End()

	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required")
		return
	}
	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}
	span.SetAttributes(attribute.Int64("vehicle.id", vehicleID))

	// Capacity lookup falls back to the same default as lookupVehicleCapacityWh.
	capacityWh := 75000.0
	capacitySource := "default"
	if h.db != nil {
		capacityWh, capacitySource = lookupVehicleCapacityWh(ctx, h.db, vehicleID)
	}

	// Use the bounded daily aggregate instead of replaying every historical signal.
	var snapshots []batterySnapshotData
	if h.db != nil {
		history, err := h.loadBatteryHealthHistory(ctx, vehicleID, capacityWh)
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "query battery history")
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get battery capacity history")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to get battery data")
			return
		}
		snapshots = historyToRegressionSnapshots(history)
	}
	if snapshots == nil {
		snapshots = []batterySnapshotData{}
	}

	monthlyData := aggregateMonthlyTrends(snapshots)

	var habits chargingHabits
	if h.db != nil {
		// SI charging_sessions schema (migration 000184): peak_power_w
		// (Watts; >50000W == DC fast charging), total_energy_added_wh
		// (Watt-hours), start_soc_pct/end_soc_pct (DOUBLE PRECISION).
		// Convert energy back to kWh at the response boundary so the
		// JSON key avg_energy_per_session keeps its kilowatt-hour
		// semantics for the frontend.
		var avgEnergyWh float64
		err = h.db.Pool.QueryRow(ctx, `
			SELECT
				COUNT(*) FILTER (WHERE peak_power_w > 50000),
				COUNT(*) FILTER (WHERE peak_power_w <= 50000 OR peak_power_w IS NULL),
				COUNT(*) FILTER (WHERE start_soc_pct < 10),
				COUNT(*) FILTER (WHERE end_soc_pct > 95),
				COUNT(*) FILTER (WHERE end_soc_pct > 90),
				COALESCE(AVG(total_energy_added_wh), 0),
				COUNT(*)
			FROM charging_sessions
			WHERE vehicle_id = $1`, vehicleID).Scan(
			&habits.FastChargeCount, &habits.SlowChargeCount,
			&habits.DeepDischargeCount, &habits.ChargeToFullCount,
			&habits.HighSocCount, &avgEnergyWh,
			&habits.TotalCount)
		if err != nil {
			log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("failed to get charging habits")
		}
		habits.AvgEnergyPerSession = avgEnergyWh / 1000.0
	}
	habits.AvgEnergyPerSession = math.Round(habits.AvgEnergyPerSession*10) / 10

	var currentHealth, currentCapacity, currentDegradation, currentRange, currentTemp float64
	var currentCycles int
	if len(snapshots) > 0 {
		latest := snapshots[len(snapshots)-1]
		currentHealth = latest.HealthScore
		currentCapacity = latest.CapacityWh
		currentDegradation = latest.DegradationPct
		currentRange = latest.EstRangeKm
		currentCycles = latest.CycleCount
		currentTemp = latest.AvgCellTempC
	}

	// Fallback keeps brand-new vehicles from rendering an empty health panel.
	if currentHealth == 0 {
		var energy, batteryLevel, rng *float64
		if h.state != nil {
			now := time.Now()
			val, sigErr := h.state.SignalAt(ctx, vehicleID, "EnergyRemaining", now)
			if sigErr != nil {
				log.Error().Err(sigErr).Int64("vehicle_id", vehicleID).Str("signal", "EnergyRemaining").Msg("battery degradation: failed to read signal state")
				httpx.WriteError(w, http.StatusInternalServerError, "failed to read battery state")
				return
			}
			if val != nil {
				if v, ok := toFloatOkLocal(val); ok && v > 0 {
					energy = &v
				}
			}
			val, sigErr = h.state.SignalAt(ctx, vehicleID, "BatteryLevel", now)
			if sigErr != nil {
				log.Error().Err(sigErr).Int64("vehicle_id", vehicleID).Str("signal", "BatteryLevel").Msg("battery degradation: failed to read signal state")
				httpx.WriteError(w, http.StatusInternalServerError, "failed to read battery state")
				return
			}
			if val != nil {
				if v, ok := toFloatOkLocal(val); ok && v > 0 && v <= 100 {
					batteryLevel = &v
				}
			}
			val, sigErr = h.state.SignalAt(ctx, vehicleID, "EstBatteryRange", now)
			if sigErr != nil {
				log.Error().Err(sigErr).Int64("vehicle_id", vehicleID).Str("signal", "EstBatteryRange").Msg("battery degradation: failed to read signal state")
				httpx.WriteError(w, http.StatusInternalServerError, "failed to read battery state")
				return
			}
			if val != nil {
				if v, ok := toFloatOkLocal(val); ok && v > 0 {
					rng = &v
				}
			}
		}
		if energy != nil && *energy > 0 {
			currentCapacity = *energy
			if batteryLevel != nil && *batteryLevel >= 5 {
				currentCapacity = *energy / (*batteryLevel / 100)
			}
			currentHealth = (currentCapacity / capacityWh) * 100
			if currentHealth > 100 {
				currentHealth = 100
			}
			currentDegradation = 100 - currentHealth
		}
		if rng != nil {
			currentRange = *rng / 1000
		}
		// Cycle count from SI charge session SOC deltas.
		if h.db != nil {
			var delta *float64
			_ = h.db.Pool.QueryRow(ctx,
				`SELECT SUM(GREATEST(end_soc_pct - start_soc_pct, 0))
				 FROM charging_sessions WHERE vehicle_id = $1 AND end_soc_pct > start_soc_pct`,
				vehicleID).Scan(&delta)
			if delta != nil {
				currentCycles = int(*delta / 100)
			}
		}

		if currentHealth > 0 {
			snapshots = []batterySnapshotData{{
				HealthScore:    currentHealth,
				CapacityWh:     currentCapacity,
				DegradationPct: currentDegradation,
				EstRangeKm:     currentRange,
				CycleCount:     currentCycles,
				CreatedAt:      time.Now().UTC(),
			}}
		}
	}

	result := h.predictDegradation(snapshots)

	totalCharges := habits.FastChargeCount + habits.SlowChargeCount
	fastChargeRatio := 0.0
	if totalCharges > 0 {
		fastChargeRatio = float64(habits.FastChargeCount) / float64(totalCharges) * 100
	}
	stressLevel := calculateStressLevel(
		fastChargeRatio,
		habits.DeepDischargeCount,
		habits.ChargeToFullCount,
		totalCharges,
	)

	ageMonths := 0
	if len(snapshots) > 0 {
		ageMonths = int(time.Since(snapshots[0].CreatedAt).Hours() / (24 * 30.44))
	}
	avgTemp := 25.0
	if len(snapshots) > 0 {
		var totalTemp float64
		for _, s := range snapshots {
			totalTemp += s.AvgCellTempC
		}
		avgTemp = totalTemp / float64(len(snapshots))
	}
	cyclesPerMonth := 0.0
	if ageMonths > 0 {
		cyclesPerMonth = float64(currentCycles) / float64(ageMonths)
	}
	highSocPct := 0.0
	deepDischargePct := 0.0
	if totalCharges > 0 {
		highSocPct = float64(habits.HighSocCount) / float64(totalCharges) * 100
		deepDischargePct = float64(habits.DeepDischargeCount) / float64(totalCharges) * 100
	}

	riskFactors := computeRiskFactors(fastChargeRatio, highSocPct, avgTemp, cyclesPerMonth, deepDischargePct)
	recommendations := generateRecommendations(riskFactors)

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id":                     vehicleID,
		"current_health":                 currentHealth,
		"current_capacity":               currentCapacity,
		"current_degradation":            currentDegradation,
		"current_range":                  currentRange,
		"current_cycles":                 currentCycles,
		"current_temp":                   currentTemp,
		"monthly_trend":                  monthlyData,
		"snapshots":                      snapshots,
		"charging_habits":                habits,
		"prediction":                     result.Prediction,
		"stress_level":                   stressLevel,
		"fast_charge_ratio":              math.Round(fastChargeRatio*10) / 10,
		"current_health_pct":             currentHealth,
		"degradation_rate_pct_per_month": math.Round(result.RatePerMonth*1000) / 1000,
		"projected_80pct_date":           result.Prediction.PredictedDate,
		"projections":                    result.Projections,
		"risk_factors":                   riskFactors,
		"recommendations":                recommendations,
		"battery_capacity_wh":            capacityWh,
		"capacity_source":                capacitySource,
	})
}

const batteryHealthHistoryQuery = `
	WITH capacity_days AS (
		SELECT
			bucket,
			(COALESCE(ac_energy_added_wh, 0) + COALESCE(dc_energy_added_wh, 0))
				/ NULLIF((max_soc - min_soc) / 100.0, 0) AS capacity_wh
		FROM cagg_battery_daily
		WHERE vehicle_id = $1
		  AND max_soc IS NOT NULL
		  AND min_soc IS NOT NULL
		  AND max_soc - min_soc >= $2
		  AND COALESCE(ac_energy_added_wh, 0) + COALESCE(dc_energy_added_wh, 0) > 0
		ORDER BY bucket DESC
		LIMIT $3
	)
	SELECT
		d.bucket,
		d.capacity_wh,
		COALESCE(r.range_m, 0),
		COALESCE(o.odometer_m, 0)
	FROM capacity_days d
	LEFT JOIN LATERAL (
		SELECT COALESCE(float_value, int_value::float8) AS range_m
		FROM signal_log
		WHERE vehicle_id = $1
		  AND field = 'EstBatteryRange'
		  AND ts < d.bucket + INTERVAL '1 day'
		  AND (float_value IS NOT NULL OR int_value IS NOT NULL)
		ORDER BY ts DESC
		LIMIT 1
	) r ON TRUE
	LEFT JOIN LATERAL (
		SELECT COALESCE(float_value, int_value::float8) AS odometer_m
		FROM signal_log
		WHERE vehicle_id = $1
		  AND field = 'Odometer'
		  AND ts < d.bucket + INTERVAL '1 day'
		  AND (float_value IS NOT NULL OR int_value IS NOT NULL)
		ORDER BY ts DESC
		LIMIT 1
	) o ON TRUE
	ORDER BY d.bucket ASC`

const batteryHealthSummaryQuery = `
	WITH charging AS (
		SELECT
			COUNT(*) FILTER (WHERE peak_power_w > 50000)::bigint AS fast_count,
			COUNT(*) FILTER (WHERE peak_power_w <= 50000 OR peak_power_w IS NULL)::bigint AS slow_count,
			COUNT(*) FILTER (WHERE start_soc_pct < 10)::bigint AS deep_discharge_count,
			COUNT(*) FILTER (WHERE end_soc_pct > 95)::bigint AS full_charge_count,
			COUNT(*) FILTER (WHERE end_soc_pct > 90)::bigint AS high_soc_count,
			COUNT(*)::bigint AS total_count,
			COALESCE(AVG(total_energy_added_wh), 0)::float8 AS avg_energy_wh,
			COALESCE(SUM(total_energy_added_wh), 0)::float8 AS total_energy_wh,
			MIN(started_at) AS first_started_at
		FROM charging_sessions
		WHERE vehicle_id = $1
	),
	driving AS (
		SELECT
			AVG(GREATEST(start_soc_pct - end_soc_pct, 0))::float8 AS avg_dod_pct,
			MIN(started_at) AS first_started_at
		FROM drives
		WHERE vehicle_id = $1 AND start_soc_pct > end_soc_pct
	),
	thermal AS (
		SELECT
			AVG(COALESCE(float_value, int_value::float8))::float8 AS avg_temp_c,
			COUNT(*)::bigint AS sample_count
		FROM signal_log
		WHERE vehicle_id = $1
		  AND field IN ('ModuleTempMax', 'ModuleTempAvg')
		  AND ts > NOW() - INTERVAL '90 days'
		  AND (float_value IS NOT NULL OR int_value IS NOT NULL)
	)
	SELECT
		c.fast_count,
		c.slow_count,
		c.deep_discharge_count,
		c.full_charge_count,
		c.high_soc_count,
		c.total_count,
		c.avg_energy_wh,
		c.total_energy_wh,
		c.first_started_at,
		d.avg_dod_pct,
		d.first_started_at,
		t.avg_temp_c,
		t.sample_count
	FROM charging c
	CROSS JOIN driving d
	CROSS JOIN thermal t`

const recentChargingSessionsQuery = `
	SELECT start_soc_pct, end_soc_pct, total_energy_added_wh, peak_power_w, charger_type
	FROM charging_sessions
	WHERE vehicle_id = $1
	ORDER BY started_at DESC
	LIMIT $2`

// Health handles GET /analytics/battery-health?vehicle_id=X.
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	started := h.currentTime()
	ctx, span := otel.Tracer("teslasync/internal/api/batterydegradation").Start(
		r.Context(),
		"batterydegradation.Health",
		trace.WithAttributes(attribute.String("http.route", "/api/v1/analytics/battery-health")),
	)
	defer span.End()

	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		span.SetStatus(codes.Error, "vehicle_id is required")
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required")
		return
	}
	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil || vehicleID <= 0 {
		span.SetStatus(codes.Error, "invalid vehicle_id")
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}
	span.SetAttributes(attribute.Int64("vehicle.id", vehicleID))

	if response, ok := h.cachedBatteryHealth(vehicleID); ok {
		h.writeBatteryHealthResponse(w, response, batteryHealthTimings{total: h.currentTime().Sub(started)}, true)
		span.SetAttributes(attribute.Bool("cache.hit", true))
		return
	}

	releaseLoadLock := h.acquireBatteryHealthLoadLock(vehicleID)
	defer releaseLoadLock()

	if response, ok := h.cachedBatteryHealth(vehicleID); ok {
		h.writeBatteryHealthResponse(w, response, batteryHealthTimings{total: h.currentTime().Sub(started)}, true)
		span.SetAttributes(attribute.Bool("cache.hit", true))
		return
	}

	loadCtx, cancel := context.WithTimeout(ctx, batteryHealthTimeout)
	defer cancel()
	response, timings, err := h.healthLoader(loadCtx, vehicleID)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "build battery health analytics")
		h.logBatteryHealthError(ctx, vehicleID, err)
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get battery health data")
		return
	}
	timings.total = h.currentTime().Sub(started)
	h.cacheBatteryHealth(vehicleID, response)
	h.writeBatteryHealthResponse(w, response, timings, false)
	span.SetAttributes(
		attribute.Bool("cache.hit", false),
		attribute.Int("battery.history_points", len(response.History)),
		attribute.Int("battery.charging_sessions", response.ChargingAnalysis.TotalSessions),
	)
	if timings.total >= batteryHealthSlowRequest {
		log.Warn().
			Int64("vehicle_id", vehicleID).
			Dur("duration", timings.total).
			Str("trace_id", trace.SpanContextFromContext(ctx).TraceID().String()).
			Msg("battery-health request exceeded latency target")
	}
}

func (h *Handler) buildBatteryHealth(ctx context.Context, vehicleID int64) (*batteryHealthResponse, batteryHealthTimings, error) {
	var timings batteryHealthTimings
	capacityWh := defaultBatteryCapacityWh
	capacitySource := "default"
	if h.db != nil {
		capacityWh, capacitySource = lookupVehicleCapacityWh(ctx, h.db, vehicleID)
	}

	var (
		history         []batteryHealthHistoryPoint
		summary         batterySummaryStats
		charging        batteryChargingAnalysis
		historyErr      error
		summaryErr      error
		chargingErr     error
		queriesFinished sync.WaitGroup
	)
	queriesFinished.Add(3)
	go func() {
		defer queriesFinished.Done()
		phaseStarted := time.Now()
		phaseCtx, phaseSpan := otel.Tracer("teslasync/internal/api/batterydegradation").Start(ctx, "battery-health.history")
		defer phaseSpan.End()
		history, historyErr = h.loadBatteryHealthHistory(phaseCtx, vehicleID, capacityWh)
		timings.history = time.Since(phaseStarted)
		if historyErr != nil {
			phaseSpan.RecordError(historyErr)
			phaseSpan.SetStatus(codes.Error, "query capacity history")
		}
		phaseSpan.SetAttributes(attribute.Int("battery.history_points", len(history)))
	}()
	go func() {
		defer queriesFinished.Done()
		phaseStarted := time.Now()
		phaseCtx, phaseSpan := otel.Tracer("teslasync/internal/api/batterydegradation").Start(ctx, "battery-health.summary")
		defer phaseSpan.End()
		summary, summaryErr = h.loadBatterySummary(phaseCtx, vehicleID)
		timings.summary = time.Since(phaseStarted)
		if summaryErr != nil {
			phaseSpan.RecordError(summaryErr)
			phaseSpan.SetStatus(codes.Error, "query battery summary")
		}
	}()
	go func() {
		defer queriesFinished.Done()
		phaseStarted := time.Now()
		phaseCtx, phaseSpan := otel.Tracer("teslasync/internal/api/batterydegradation").Start(ctx, "battery-health.charging")
		defer phaseSpan.End()
		charging, chargingErr = h.loadChargingAnalysis(phaseCtx, vehicleID)
		timings.charging = time.Since(phaseStarted)
		if chargingErr != nil {
			phaseSpan.RecordError(chargingErr)
			phaseSpan.SetStatus(codes.Error, "query recent charging sessions")
		}
	}()
	queriesFinished.Wait()
	if historyErr != nil {
		return nil, timings, fmt.Errorf("query battery history: %w", historyErr)
	}
	if summaryErr != nil {
		return nil, timings, fmt.Errorf("query battery summary: %w", summaryErr)
	}
	if chargingErr != nil {
		return nil, timings, fmt.Errorf("query charging analysis: %w", chargingErr)
	}

	currentCapacityWh := medianRecentCapacity(history, 8)
	if currentCapacityWh <= 0 {
		liveCapacityWh, rangeM, err := h.loadLiveBatteryCapacity(ctx, vehicleID, capacityWh)
		if err != nil {
			return nil, timings, err
		}
		if liveCapacityWh > 0 {
			currentCapacityWh = liveCapacityWh
			history = append(history, batteryHealthHistoryPoint{
				Date:       h.currentTime().UTC().Format("2006-01-02"),
				CapacityWh: roundTo(liveCapacityWh, 1),
				RangeM:     roundTo(rangeM, 1),
				SohPct:     roundTo(clampSOH(liveCapacityWh/capacityWh*100), 1),
			})
		}
	}
	currentSOH := 0.0
	if currentCapacityWh > 0 && capacityWh > 0 {
		currentSOH = clampSOH(currentCapacityWh / capacityWh * 100)
	}

	snapshots := historyToRegressionSnapshots(history)
	prediction := h.predictDegradation(snapshots)
	ageMonths := batteryAgeMonths(h.currentTime(), history, summary.firstCharging, summary.firstDrive)
	totalCycles := 0
	if capacityWh > 0 {
		totalCycles = int(math.Round(summary.totalEnergyWh / capacityWh))
	}
	fastChargePct := percentage(summary.fastChargeCount, summary.totalCount)
	fullChargePct := percentage(summary.fullChargeCount, summary.totalCount)
	chargeHabitsScore := calculateChargeHabitsScore(
		fastChargePct,
		fullChargePct,
		summary.deepDischargeCount,
	)
	stressLevel := calculateStressLevel(
		fastChargePct,
		summary.deepDischargeCount,
		summary.fullChargeCount,
		summary.totalCount,
	)
	degradationRate := math.Abs(prediction.Prediction.SlopePerYear)
	if !prediction.Prediction.HasEnoughData && ageMonths > 0 && currentSOH > 0 {
		degradationRate = math.Max(0, (100-currentSOH)/(float64(ageMonths)/12))
	}

	avgTempC := 25.0
	if summary.avgTempC != nil {
		avgTempC = *summary.avgTempC
	}
	cyclesPerMonth := 0.0
	if ageMonths > 0 {
		cyclesPerMonth = float64(totalCycles) / float64(ageMonths)
	}
	highSocPct := percentage(summary.highSocCount, summary.totalCount)
	deepDischargePct := percentage(summary.deepDischargeCount, summary.totalCount)
	riskFactors := computeRiskFactors(fastChargePct, highSocPct, avgTempC, cyclesPerMonth, deepDischargePct)
	tempScore, tempReason := temperatureExposure(summary.avgTempC, summary.tempSamples)

	habits := chargingHabits{
		FastChargeCount:     summary.fastChargeCount,
		SlowChargeCount:     summary.slowChargeCount,
		DeepDischargeCount:  summary.deepDischargeCount,
		ChargeToFullCount:   summary.fullChargeCount,
		HighSocCount:        summary.highSocCount,
		AvgEnergyPerSession: roundTo(summary.avgEnergyWh/1000, 1),
		TotalCount:          summary.totalCount,
	}
	if history == nil {
		history = []batteryHealthHistoryPoint{}
	}
	if prediction.Projections == nil {
		prediction.Projections = []predictiveProjection{}
	}
	if riskFactors == nil {
		riskFactors = []riskFactor{}
	}
	recommendations := generateRecommendations(riskFactors)
	if recommendations == nil {
		recommendations = []string{}
	}

	return &batteryHealthResponse{
		VehicleID:                 vehicleID,
		CurrentSoh:                roundTo(currentSOH, 1),
		EstimatedCapacityWh:       roundTo(currentCapacityWh, 1),
		OriginalCapacityWh:        capacityWh,
		DegradationRatePctPerYear: roundTo(degradationRate, 2),
		BatteryAgeMonths:          ageMonths,
		TotalCycles:               totalCycles,
		AvgDepthOfDischargePct:    roundTo(summary.avgDoDPct, 1),
		FastChargePct:             roundTo(fastChargePct, 1),
		FullChargePct:             roundTo(fullChargePct, 1),
		ChargeHabitsScore:         math.Round(chargeHabitsScore),
		StressLevel:               stressLevel,
		TempExposureScore:         tempScore,
		TempExposureReason:        tempReason,
		History:                   history,
		Prediction:                prediction.Prediction,
		Projections:               prediction.Projections,
		ChargingHabits:            habits,
		RiskFactors:               riskFactors,
		Recommendations:           recommendations,
		ChargingAnalysis:          charging,
		CapacitySource:            capacitySource,
	}, timings, nil
}

type batterySummaryStats struct {
	fastChargeCount    int
	slowChargeCount    int
	deepDischargeCount int
	fullChargeCount    int
	highSocCount       int
	totalCount         int
	avgEnergyWh        float64
	totalEnergyWh      float64
	firstCharging      *time.Time
	firstDrive         *time.Time
	avgDoDPct          float64
	avgTempC           *float64
	tempSamples        int
}

func (h *Handler) loadBatteryHealthHistory(ctx context.Context, vehicleID int64, capacityWh float64) ([]batteryHealthHistoryPoint, error) {
	if h.db == nil {
		return []batteryHealthHistoryPoint{}, nil
	}
	rows, err := h.db.Pool.Query(ctx, batteryHealthHistoryQuery, vehicleID, batteryMinSOCSwing, batteryHistoryLimit)
	if err != nil {
		return nil, fmt.Errorf("query cagg_battery_daily: %w", err)
	}
	defer rows.Close()

	history := make([]batteryHealthHistoryPoint, 0, batteryHistoryLimit)
	for rows.Next() {
		var (
			bucket    time.Time
			capacity  float64
			rangeM    float64
			odometerM float64
		)
		if err := rows.Scan(&bucket, &capacity, &rangeM, &odometerM); err != nil {
			return nil, fmt.Errorf("scan battery capacity day: %w", err)
		}
		if capacity <= 0 || capacity > capacityWh*1.2 {
			continue
		}
		history = append(history, batteryHealthHistoryPoint{
			Date:       bucket.UTC().Format("2006-01-02"),
			OdometerM:  roundTo(odometerM, 1),
			SohPct:     roundTo(clampSOH(capacity/capacityWh*100), 1),
			CapacityWh: roundTo(capacity, 1),
			RangeM:     roundTo(rangeM, 1),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate battery capacity days: %w", err)
	}
	return history, nil
}

func (h *Handler) loadBatterySummary(ctx context.Context, vehicleID int64) (batterySummaryStats, error) {
	var summary batterySummaryStats
	if h.db == nil {
		return summary, nil
	}
	var (
		fastCount          int64
		slowCount          int64
		deepDischargeCount int64
		fullChargeCount    int64
		highSocCount       int64
		totalCount         int64
		avgDoDPct          *float64
		tempSamples        int64
	)
	err := h.db.Pool.QueryRow(ctx, batteryHealthSummaryQuery, vehicleID).Scan(
		&fastCount,
		&slowCount,
		&deepDischargeCount,
		&fullChargeCount,
		&highSocCount,
		&totalCount,
		&summary.avgEnergyWh,
		&summary.totalEnergyWh,
		&summary.firstCharging,
		&avgDoDPct,
		&summary.firstDrive,
		&summary.avgTempC,
		&tempSamples,
	)
	if err != nil {
		return summary, fmt.Errorf("query battery summary aggregates: %w", err)
	}
	summary.fastChargeCount = int(fastCount)
	summary.slowChargeCount = int(slowCount)
	summary.deepDischargeCount = int(deepDischargeCount)
	summary.fullChargeCount = int(fullChargeCount)
	summary.highSocCount = int(highSocCount)
	summary.totalCount = int(totalCount)
	summary.tempSamples = int(tempSamples)
	if avgDoDPct != nil {
		summary.avgDoDPct = *avgDoDPct
	}
	return summary, nil
}

func (h *Handler) loadChargingAnalysis(ctx context.Context, vehicleID int64) (batteryChargingAnalysis, error) {
	analysis := batteryChargingAnalysis{
		ChargeLevelDistribution: make([]chargeLevelBucket, 10),
	}
	for i := range analysis.ChargeLevelDistribution {
		analysis.ChargeLevelDistribution[i] = chargeLevelBucket{
			MinSocPct: i * 10,
			MaxSocPct: (i+1)*10 - 1,
		}
	}
	if h.db == nil {
		return analysis, nil
	}

	rows, err := h.db.Pool.Query(ctx, recentChargingSessionsQuery, vehicleID, batteryRecentSessionLimit)
	if err != nil {
		return analysis, fmt.Errorf("query recent charging sessions: %w", err)
	}
	defer rows.Close()

	var startTotal, endTotal float64
	var startSamples, endSamples int
	for rows.Next() {
		var startSOC, endSOC, energyWh, peakPowerW *float64
		var chargerType *string
		if err := rows.Scan(&startSOC, &endSOC, &energyWh, &peakPowerW, &chargerType); err != nil {
			return analysis, fmt.Errorf("scan recent charging session: %w", err)
		}
		analysis.TotalSessions++
		if startSOC != nil {
			bucket := socBucket(*startSOC)
			analysis.ChargeLevelDistribution[bucket].StartCount++
			startTotal += *startSOC
			startSamples++
			if *startSOC < 10 {
				analysis.DeepDischargeCount++
			}
		}
		if endSOC != nil {
			bucket := socBucket(*endSOC)
			analysis.ChargeLevelDistribution[bucket].EndCount++
			endTotal += *endSOC
			endSamples++
		}
		isDC, isSupercharger := classifyChargeSession(peakPowerW, chargerType)
		energy := 0.0
		if energyWh != nil {
			energy = math.Max(0, *energyWh)
		}
		if isDC {
			analysis.DCSessionCount++
			analysis.DCEnergyWh += energy
			if isSupercharger {
				analysis.SuperchargerCount++
			} else {
				analysis.DCFastCount++
			}
		} else {
			analysis.ACSessionCount++
			analysis.ACEnergyWh += energy
		}
	}
	if err := rows.Err(); err != nil {
		return analysis, fmt.Errorf("iterate recent charging sessions: %w", err)
	}
	if startSamples > 0 {
		value := roundTo(startTotal/float64(startSamples), 1)
		analysis.AvgStartSocPct = &value
	}
	if endSamples > 0 {
		value := roundTo(endTotal/float64(endSamples), 1)
		analysis.AvgEndSocPct = &value
	}
	analysis.ACEnergyWh = roundTo(analysis.ACEnergyWh, 1)
	analysis.DCEnergyWh = roundTo(analysis.DCEnergyWh, 1)
	return analysis, nil
}

func (h *Handler) loadLiveBatteryCapacity(ctx context.Context, vehicleID int64, nominalCapacityWh float64) (float64, float64, error) {
	if h.state == nil {
		return 0, 0, nil
	}
	now := h.currentTime()
	energyWh, err := h.readSignalFloat(ctx, vehicleID, "EnergyRemaining", now)
	if err != nil {
		return 0, 0, err
	}
	batteryLevel, err := h.readSignalFloat(ctx, vehicleID, "BatteryLevel", now)
	if err != nil {
		return 0, 0, err
	}
	rangeM, err := h.readSignalFloat(ctx, vehicleID, "EstBatteryRange", now)
	if err != nil {
		return 0, 0, err
	}
	if energyWh <= 0 || batteryLevel < 5 || batteryLevel > 100 {
		return 0, rangeM, nil
	}
	capacityWh := energyWh / (batteryLevel / 100)
	if capacityWh <= 0 || capacityWh > nominalCapacityWh*1.2 {
		return 0, rangeM, nil
	}
	return capacityWh, rangeM, nil
}

func (h *Handler) readSignalFloat(ctx context.Context, vehicleID int64, field string, at time.Time) (float64, error) {
	value, err := h.state.SignalAt(ctx, vehicleID, field, at)
	if err != nil {
		return 0, fmt.Errorf("read %s signal: %w", field, err)
	}
	if value == nil {
		return 0, nil
	}
	number, ok := toFloatOkLocal(value)
	if !ok || number <= 0 {
		return 0, nil
	}
	return number, nil
}

func (h *Handler) cachedBatteryHealth(vehicleID int64) (*batteryHealthResponse, bool) {
	h.healthCacheMu.RLock()
	entry, ok := h.healthCache[vehicleID]
	h.healthCacheMu.RUnlock()
	if !ok || !h.currentTime().Before(entry.expiresAt) {
		if ok {
			h.healthCacheMu.Lock()
			delete(h.healthCache, vehicleID)
			h.healthCacheMu.Unlock()
		}
		return nil, false
	}
	return entry.response, true
}

func (h *Handler) cacheBatteryHealth(vehicleID int64, response *batteryHealthResponse) {
	h.healthCacheMu.Lock()
	if h.healthCache == nil {
		h.healthCache = make(map[int64]batteryHealthCacheEntry)
	}
	now := h.currentTime()
	for cachedVehicleID, entry := range h.healthCache {
		if !now.Before(entry.expiresAt) {
			delete(h.healthCache, cachedVehicleID)
		}
	}
	if len(h.healthCache) >= batteryHealthCacheMaxSize {
		var oldestVehicleID int64
		var oldestExpiry time.Time
		for cachedVehicleID, entry := range h.healthCache {
			if oldestExpiry.IsZero() || entry.expiresAt.Before(oldestExpiry) {
				oldestVehicleID = cachedVehicleID
				oldestExpiry = entry.expiresAt
			}
		}
		delete(h.healthCache, oldestVehicleID)
	}
	h.healthCache[vehicleID] = batteryHealthCacheEntry{
		response:  response,
		expiresAt: now.Add(batteryHealthCacheTTL),
	}
	h.healthCacheMu.Unlock()
}

func (h *Handler) acquireBatteryHealthLoadLock(vehicleID int64) func() {
	h.healthLoadLocksMu.Lock()
	if h.healthLoadLocks == nil {
		h.healthLoadLocks = make(map[int64]*batteryHealthLoadLock)
	}
	loadLock := h.healthLoadLocks[vehicleID]
	if loadLock == nil {
		loadLock = &batteryHealthLoadLock{}
		h.healthLoadLocks[vehicleID] = loadLock
	}
	loadLock.refs++
	h.healthLoadLocksMu.Unlock()

	loadLock.mu.Lock()
	return func() {
		loadLock.mu.Unlock()
		h.healthLoadLocksMu.Lock()
		loadLock.refs--
		if loadLock.refs == 0 && h.healthLoadLocks[vehicleID] == loadLock {
			delete(h.healthLoadLocks, vehicleID)
		}
		h.healthLoadLocksMu.Unlock()
	}
}

func (h *Handler) writeBatteryHealthResponse(w http.ResponseWriter, response *batteryHealthResponse, timings batteryHealthTimings, cacheHit bool) {
	w.Header().Set("Cache-Control", "private, max-age=300")
	cacheStatus := "miss"
	if cacheHit {
		cacheStatus = "hit"
	}
	w.Header().Set("Server-Timing", fmt.Sprintf(
		`cache;desc="%s", history;dur=%.1f, summary;dur=%.1f, charging;dur=%.1f, total;dur=%.1f`,
		cacheStatus,
		float64(timings.history.Microseconds())/1000,
		float64(timings.summary.Microseconds())/1000,
		float64(timings.charging.Microseconds())/1000,
		float64(timings.total.Microseconds())/1000,
	))
	httpx.WriteJSON(w, http.StatusOK, response)
}

func (h *Handler) logBatteryHealthError(ctx context.Context, vehicleID int64, err error) {
	event := log.Error().Err(err).Int64("vehicle_id", vehicleID)
	if traceID := trace.SpanContextFromContext(ctx).TraceID(); traceID.IsValid() {
		event = event.Str("trace_id", traceID.String())
	}
	event.Msg("battery-health: failed to build analytics")
}

func (h *Handler) currentTime() time.Time {
	if h.now != nil {
		return h.now()
	}
	return time.Now()
}

func historyToRegressionSnapshots(history []batteryHealthHistoryPoint) []batterySnapshotData {
	snapshots := make([]batterySnapshotData, 0, len(history))
	for _, point := range history {
		createdAt, err := time.Parse("2006-01-02", point.Date)
		if err != nil {
			continue
		}
		snapshots = append(snapshots, batterySnapshotData{
			HealthScore:    point.SohPct,
			CapacityWh:     point.CapacityWh,
			DegradationPct: math.Max(0, 100-point.SohPct),
			EstRangeKm:     point.RangeM / 1000,
			CreatedAt:      createdAt,
		})
	}
	return snapshots
}

func medianRecentCapacity(history []batteryHealthHistoryPoint, sampleCount int) float64 {
	if len(history) == 0 || sampleCount <= 0 {
		return 0
	}
	start := len(history) - sampleCount
	if start < 0 {
		start = 0
	}
	values := make([]float64, 0, len(history)-start)
	for _, point := range history[start:] {
		if point.CapacityWh > 0 {
			values = append(values, point.CapacityWh)
		}
	}
	if len(values) == 0 {
		return 0
	}
	for i := 1; i < len(values); i++ {
		for j := i; j > 0 && values[j] < values[j-1]; j-- {
			values[j], values[j-1] = values[j-1], values[j]
		}
	}
	middle := len(values) / 2
	if len(values)%2 == 0 {
		return (values[middle-1] + values[middle]) / 2
	}
	return values[middle]
}

func batteryAgeMonths(now time.Time, history []batteryHealthHistoryPoint, firstCharging, firstDrive *time.Time) int {
	var first time.Time
	if len(history) > 0 {
		first, _ = time.Parse("2006-01-02", history[0].Date)
	}
	for _, candidate := range []*time.Time{firstCharging, firstDrive} {
		if candidate != nil && (first.IsZero() || candidate.Before(first)) {
			first = *candidate
		}
	}
	if first.IsZero() || !first.Before(now) {
		return 0
	}
	return int(now.Sub(first).Hours() / (24 * 30.44))
}

func temperatureExposure(avgTempC *float64, sampleCount int) (*int, *string) {
	if avgTempC == nil || sampleCount < 10 {
		reason := "insufficient_data"
		return nil, &reason
	}
	score := 10
	switch {
	case *avgTempC > 45:
		score = 90
	case *avgTempC > 40:
		score = 70
	case *avgTempC > 35:
		score = 50
	case *avgTempC > 30:
		score = 25
	}
	return &score, nil
}

func calculateChargeHabitsScore(fastChargePct, fullChargePct float64, deepDischargeCount int) float64 {
	score := 100.0
	if fastChargePct > 50 {
		score -= 30
	} else if fastChargePct > 25 {
		score -= 15
	}
	if fullChargePct > 50 {
		score -= 20
	} else if fullChargePct > 25 {
		score -= 10
	}
	if deepDischargeCount > 20 {
		score -= 20
	} else if deepDischargeCount > 10 {
		score -= 10
	}
	return math.Max(0, score)
}

func calculateStressLevel(fastChargePct float64, deepDischargeCount, fullChargeCount, totalCount int) string {
	if fastChargePct > 50 || deepDischargeCount > 20 || fullChargeCount > totalCount/2 {
		return "High"
	}
	if fastChargePct > 25 || deepDischargeCount > 10 || fullChargeCount > totalCount/4 {
		return "Medium"
	}
	return "Low"
}

func percentage(part, total int) float64 {
	if total <= 0 {
		return 0
	}
	return float64(part) / float64(total) * 100
}

func classifyChargeSession(peakPowerW *float64, chargerType *string) (bool, bool) {
	normalizedType := ""
	if chargerType != nil {
		normalizedType = strings.ToLower(*chargerType)
	}
	isSupercharger := strings.Contains(normalizedType, "supercharger")
	isDC := isSupercharger ||
		strings.Contains(normalizedType, "dc") ||
		(peakPowerW != nil && *peakPowerW > 20_000)
	return isDC, isSupercharger
}

func socBucket(soc float64) int {
	return min(9, max(0, int(soc/10)))
}

func clampSOH(value float64) float64 {
	return math.Min(100, math.Max(0, value))
}

func roundTo(value float64, places int) float64 {
	factor := math.Pow10(places)
	return math.Round(value*factor) / factor
}

// estimateBatteryCapacityWh returns the best-effort battery capacity in Wh
// and a source string indicating how the estimate was derived. Local copy
// of the package-api helper (which must stay there for other callers); the
// carve playbook duplicates small stranded helpers rather than introducing
// an import cycle.
func estimateBatteryCapacityWh(vin string, model string) (float64, string) {
	if len(vin) >= 8 {
		switch vin[7] {
		case 'E', 'F':
			return 60000.0, "vin_estimate"
		case 'K', 'L', 'M':
			return 75000.0, "vin_estimate"
		case 'S', 'A':
			return 100000.0, "vin_estimate"
		case 'P':
			return 100000.0, "vin_estimate"
		}
	}
	m := strings.ToLower(model)
	if strings.Contains(m, "model s") || strings.Contains(m, "model x") {
		return 100000.0, "model_estimate"
	}
	return 75000.0, "default"
}

// lookupVehicleCapacityWh fetches VIN and model for a vehicle ID and estimates
// battery capacity. Falls back to 75000 Wh / "default" on any lookup error.
// Local copy of the package-api helper (see estimateBatteryCapacityWh).
func lookupVehicleCapacityWh(ctx context.Context, db *database.DB, vehicleID int64) (float64, string) {
	var vin string
	var model *string
	err := db.Pool.QueryRow(ctx,
		`SELECT vin, model FROM vehicles WHERE id = $1`, vehicleID,
	).Scan(&vin, &model)
	if err != nil {
		return 75000.0, "default"
	}
	m := ""
	if model != nil {
		m = *model
	}
	return estimateBatteryCapacityWh(vin, m)
}

// toFloatOkLocal parses a value to float64 and reports whether the signal
// was present. Thin wrapper around the canonical signal.Float64 converter
// (local copy of the package-api toFloatOk helper, which stays in package
// api for its other callers).
func toFloatOkLocal(v interface{}) (float64, bool) {
	return signal.Float64(v)
}
