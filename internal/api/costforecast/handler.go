package costforecast

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools/forecast"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// Handler produces energy cost forecasts from charging history.
type Handler struct {
	db *database.DB
}

func NewHandler(db *database.DB) *Handler {
	return &Handler{db: db}
}

type costForecastResponse struct {
	Historical    []historicalMonth `json:"historical"`
	Forecast      []forecastMonth   `json:"forecast"`
	Breakdown     costBreakdown     `json:"breakdown"`
	GasComparison gasComparison     `json:"gas_comparison"`
	Insights      []string          `json:"insights"`
}

type historicalMonth struct {
	Month      string  `json:"month"`
	Cost       float64 `json:"cost"`
	KWh        float64 `json:"kwh"`
	Sessions   int     `json:"sessions"`
	CostPerKWh float64 `json:"cost_per_kwh"`
}

type forecastMonth struct {
	Month    string  `json:"month"`
	Cost     float64 `json:"cost"`
	CostLow  float64 `json:"cost_low"`
	CostHigh float64 `json:"cost_high"`
	KWh      float64 `json:"kwh"`
}

type costBreakdown struct {
	Home         chargerCategory `json:"home"`
	Supercharger chargerCategory `json:"supercharger"`
}

type chargerCategory struct {
	Pct           float64 `json:"pct"`
	AvgCostPerKWh float64 `json:"avg_cost_per_kwh"`
	MonthlyAvg    float64 `json:"monthly_avg"`
}

type gasComparison struct {
	AvgKmPerMonth   float64 `json:"avg_km_per_month"`
	GasCostPerMonth float64 `json:"gas_cost_per_month"`
	EvCostPerMonth  float64 `json:"ev_cost_per_month"`
	MonthlySavings  float64 `json:"monthly_savings"`
	AnnualSavings   float64 `json:"annual_savings"`
	LifetimeSavings float64 `json:"lifetime_savings"`
}

// CostForecastMeta carries analytic context for AI narration without extending
// the chart wire shape. Both REST and AI call ComputeCostForecast so they share
// one deterministic SQL/computation path.
type CostForecastMeta struct {
	HistoricalMonthCount int
	MinRequiredMonths    int
	HasEnoughData        bool
	DataThroughMonth     string
	ForecastMonths       int
	ForecastMethod       string
	UncertaintyMethod    string
	UncertaintyLevel     string
	Assumptions          []string
}

// ComputeCostForecast is the shared deterministic forecast for REST and AI.
// Surfacing the minimum-data threshold lets narration refuse insufficient data
// instead of inventing a trend.
func ComputeCostForecast(ctx context.Context, db *database.DB, vehicleID int64, months int) (costForecastResponse, CostForecastMeta, error) {
	const minRequiredMonths = 3

	if months <= 0 || months > 24 {
		months = 6
	}

	historical, err := loadCostHistorical(ctx, db, vehicleID)
	if err != nil {
		return costForecastResponse{}, CostForecastMeta{}, err
	}

	tmpHandler := &Handler{db: db}
	forecast := tmpHandler.computeForecast(historical, months)
	breakdown := tmpHandler.computeBreakdown(ctx, vehicleID, historical)
	gasCmp := tmpHandler.computeGasComparison(ctx, vehicleID, historical)
	insights := generateCostInsights(historical, breakdown, gasCmp)

	resp := costForecastResponse{
		Historical:    historical,
		Forecast:      forecast,
		Breakdown:     breakdown,
		GasComparison: gasCmp,
		Insights:      insights,
	}

	dataThrough := ""
	if len(historical) > 0 {
		dataThrough = historical[len(historical)-1].Month
	}

	uncertaintyLevel := "approximate 95% prediction interval (t≈2)"
	if float64(len(historical)) > 30 {
		uncertaintyLevel = "approximate 95% prediction interval (z=1.96)"
	}

	assumptions := []string{
		"Forecast is a least-squares linear regression over monthly cost totals.",
		"Calendar-month seasonality is added as the deviation of each calendar month's average cost from the overall average.",
		"Forecast kWh is a separate linear regression over monthly kWh totals.",
		"Negative projections are clamped to zero — a downward trend cannot drive cost below zero.",
		"Cost-low / cost-high describe an approximate prediction interval, not a strict 95% confidence interval, and assume residuals are roughly Gaussian.",
		fmt.Sprintf("At least %d months of charging history with cost > 0 are required before any forecast is produced.", minRequiredMonths),
	}

	meta := CostForecastMeta{
		HistoricalMonthCount: len(historical),
		MinRequiredMonths:    minRequiredMonths,
		HasEnoughData:        len(historical) >= minRequiredMonths,
		DataThroughMonth:     dataThrough,
		ForecastMonths:       months,
		ForecastMethod:       "linear regression + calendar-month seasonal adjustment",
		UncertaintyMethod:    "residual standard error projected through prediction-interval formula",
		UncertaintyLevel:     uncertaintyLevel,
		Assumptions:          assumptions,
	}

	return resp, meta, nil
}

// loadCostHistorical is shared by REST and AI so both consume the same monthly
// aggregation rows.
func loadCostHistorical(ctx context.Context, db *database.DB, vehicleID int64) ([]historicalMonth, error) {
	rows, err := db.Pool.Query(ctx, `
		SELECT DATE_TRUNC('month', started_at)                                AS month,
		       SUM(cost_decimal)                                              AS total_cost,
		       SUM(total_energy_added_wh) / 1000.0                            AS total_kwh,
		       COUNT(*)                                                       AS sessions,
		       AVG(cost_decimal / NULLIF(total_energy_added_wh / 1000.0, 0))  AS avg_cost_per_kwh
		FROM charging_sessions
		WHERE vehicle_id = $1 AND cost_decimal > 0
		GROUP BY month ORDER BY month`, vehicleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var historical []historicalMonth
	for rows.Next() {
		var m historicalMonth
		var monthTime time.Time
		var avgCostPtr *float64
		if err := rows.Scan(&monthTime, &m.Cost, &m.KWh, &m.Sessions, &avgCostPtr); err != nil {
			log.Warn().Err(err).Msg("cost-forecast: scan error")
			continue
		}
		m.Month = monthTime.Format("2006-01")
		m.Cost = round2(m.Cost)
		m.KWh = round1(m.KWh)
		if avgCostPtr != nil {
			m.CostPerKWh = round3(*avgCostPtr)
		}
		historical = append(historical, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if historical == nil {
		historical = []historicalMonth{}
	}
	return historical, nil
}

// GetForecast handles GET /analytics/cost-forecast?vehicle_id=X&months=6
func (h *Handler) GetForecast(w http.ResponseWriter, r *http.Request) {
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

	forecastMonths := 6
	if m, err := strconv.Atoi(r.URL.Query().Get("months")); err == nil && m > 0 && m <= 24 {
		forecastMonths = m
	}

	resp, _, err := ComputeCostForecast(r.Context(), h.db, vehicleID, forecastMonths)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("cost-forecast: compute failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get cost data")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, resp)
}

func (h *Handler) computeForecast(historical []historicalMonth, months int) []forecastMonth {
	if len(historical) < 3 {
		return []forecastMonth{}
	}

	n := float64(len(historical))
	var sumX, sumY, sumXY, sumX2 float64
	for i, m := range historical {
		x := float64(i)
		y := m.Cost
		sumX += x
		sumY += y
		sumXY += x * y
		sumX2 += x * x
	}

	xBar := sumX / n
	ssx := sumX2 - n*xBar*xBar
	if math.Abs(ssx) < 1e-10 {
		return []forecastMonth{}
	}

	slope := (sumXY - n*xBar*(sumY/n)) / ssx
	intercept := (sumY / n) - slope*xBar

	// Residual standard error
	var sse float64
	for i, m := range historical {
		pred := intercept + slope*float64(i)
		sse += (m.Cost - pred) * (m.Cost - pred)
	}
	se := 0.0
	if n > 2 {
		se = math.Sqrt(sse / (n - 2))
	}
	tVal := 2.0
	if n > 30 {
		tVal = 1.96
	}

	// Seasonal factors: average cost per calendar month across all years
	seasonalSum := make(map[int]float64)
	seasonalCount := make(map[int]int)
	for _, m := range historical {
		t, _ := time.Parse("2006-01", m.Month)
		cm := int(t.Month())
		seasonalSum[cm] += m.Cost
		seasonalCount[cm]++
	}
	overallAvg := sumY / n
	seasonalFactor := make(map[int]float64) // deviation from overall average
	for cm, s := range seasonalSum {
		avg := s / float64(seasonalCount[cm])
		seasonalFactor[cm] = avg - overallAvg
	}

	// kWh regression for projecting energy
	var sumYk float64
	for _, m := range historical {
		sumYk += m.KWh
	}
	kwhSlope := 0.0
	kwhIntercept := sumYk / n
	if ssx > 1e-10 {
		var sumXYk float64
		for i, m := range historical {
			sumXYk += float64(i) * m.KWh
		}
		kwhSlope = (sumXYk - n*xBar*(sumYk/n)) / ssx
		kwhIntercept = (sumYk / n) - kwhSlope*xBar
	}

	// Project forward
	lastIdx := len(historical) - 1
	lastTime, _ := time.Parse("2006-01", historical[lastIdx].Month)
	forecasts := make([]forecastMonth, 0, months)

	for i := 1; i <= months; i++ {
		futureTime := lastTime.AddDate(0, i, 0)
		futureIdx := float64(lastIdx + i)

		baseCost := intercept + slope*futureIdx
		sf := seasonalFactor[int(futureTime.Month())]
		cost := baseCost + sf
		if cost < 0 {
			cost = 0
		}

		// Prediction interval
		xDev := futureIdx - xBar
		piWidth := tVal * se * math.Sqrt(1+1/n+(xDev*xDev)/ssx)
		low := math.Max(0, cost-piWidth)
		high := cost + piWidth

		kwhProj := kwhIntercept + kwhSlope*futureIdx
		if kwhProj < 0 {
			kwhProj = 0
		}

		forecasts = append(forecasts, forecastMonth{
			Month:    futureTime.Format("2006-01"),
			Cost:     round2(cost),
			CostLow:  round2(low),
			CostHigh: round2(high),
			KWh:      round1(kwhProj),
		})
	}

	return forecasts
}

// ── Breakdown computation ────────────────────────────────────

func (h *Handler) computeBreakdown(ctx context.Context, vehicleID int64, historical []historicalMonth) costBreakdown {
	var homeCost, homekWh, scCost, sckWh float64
	var homeCount, scCount int

	// Phase-42 (000184_charging_si): SI canonical columns. The home/supercharger
	// split previously bucketed by the legacy max-kW power column <= 22 (kW); under SI
	// the same threshold becomes peak_power_w <= 22000 (W). Energy converted
	// from total_energy_added_wh -> kWh at SQL boundary so home/sc kWh
	// totals match the legacy units consumed by chargerCategory.AvgCostPerKWh.
	_ = h.db.Pool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(cost_decimal) FILTER (WHERE peak_power_w <= 22000 OR peak_power_w IS NULL), 0),
			COALESCE(SUM(total_energy_added_wh / 1000.0) FILTER (WHERE peak_power_w <= 22000 OR peak_power_w IS NULL), 0),
			COUNT(*) FILTER (WHERE peak_power_w <= 22000 OR peak_power_w IS NULL),
			COALESCE(SUM(cost_decimal) FILTER (WHERE peak_power_w > 22000), 0),
			COALESCE(SUM(total_energy_added_wh / 1000.0) FILTER (WHERE peak_power_w > 22000), 0),
			COUNT(*) FILTER (WHERE peak_power_w > 22000)
		FROM charging_sessions
		WHERE vehicle_id = $1 AND cost_decimal > 0`, vehicleID).Scan(
		&homeCost, &homekWh, &homeCount,
		&scCost, &sckWh, &scCount,
	)

	total := homeCost + scCost
	activeMonths := float64(len(historical))
	if activeMonths < 1 {
		activeMonths = 1
	}

	homePct := 0.0
	scPct := 0.0
	if total > 0 {
		homePct = homeCost / total * 100
		scPct = scCost / total * 100
	}

	homeAvgCost := 0.0
	if homekWh > 0 {
		homeAvgCost = homeCost / homekWh
	}
	scAvgCost := 0.0
	if sckWh > 0 {
		scAvgCost = scCost / sckWh
	}

	return costBreakdown{
		Home: chargerCategory{
			Pct:           round1(homePct),
			AvgCostPerKWh: round3(homeAvgCost),
			MonthlyAvg:    round2(homeCost / activeMonths),
		},
		Supercharger: chargerCategory{
			Pct:           round1(scPct),
			AvgCostPerKWh: round3(scAvgCost),
			MonthlyAvg:    round2(scCost / activeMonths),
		},
	}
}

// ── Gas comparison ───────────────────────────────────────────

func (h *Handler) computeGasComparison(ctx context.Context, vehicleID int64, historical []historicalMonth) gasComparison {
	const defaultGasPrice = 1.50     // $/L
	const defaultConsumption = 0.085 // L/km (gas car)

	// Average km/month from drives
	// Phase-42 (000185_drives_si): drives.distance_m and drives.started_at replace the legacy mileage and timestamp columns.
	// Pre-existing bug preserved: the variable is named totalKm but treats the
	// numeric value as miles downstream (defaultConsumption is L/km but is
	// multiplied by mileage in miles). To keep the JSON output (avgKmPerMonth)
	// numerically identical to the legacy behavior, we convert meters back to
	// miles at the SQL boundary rather than to kilometers.
	var totalKm float64
	var firstDrive, lastDrive *time.Time
	_ = h.db.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(distance_m) / 1609.344, 0), MIN(started_at), MAX(started_at)
		FROM drives WHERE vehicle_id = $1 AND distance_m > 0`, vehicleID).Scan(
		&totalKm, &firstDrive, &lastDrive,
	)

	driveMonths := 1.0
	if firstDrive != nil && lastDrive != nil {
		dm := lastDrive.Sub(*firstDrive).Hours() / (24 * 30.44)
		if dm > 1 {
			driveMonths = dm
		}
	}
	avgKmMonth := totalKm / driveMonths

	// Average monthly EV cost
	totalCost := 0.0
	for _, m := range historical {
		totalCost += m.Cost
	}
	activeMonths := float64(len(historical))
	if activeMonths < 1 {
		activeMonths = 1
	}
	evCostMonth := totalCost / activeMonths

	gasCostMonth := avgKmMonth * defaultConsumption * defaultGasPrice
	monthlySavings := gasCostMonth - evCostMonth

	// Lifetime savings: from first drive to now
	lifetimeMonths := driveMonths
	lifetimeSavings := monthlySavings * lifetimeMonths

	return gasComparison{
		AvgKmPerMonth:   round1(avgKmMonth),
		GasCostPerMonth: round2(gasCostMonth),
		EvCostPerMonth:  round2(evCostMonth),
		MonthlySavings:  round2(monthlySavings),
		AnnualSavings:   round2(monthlySavings * 12),
		LifetimeSavings: round2(lifetimeSavings),
	}
}

// ── Insights ─────────────────────────────────────────────────

func generateCostInsights(historical []historicalMonth, bd costBreakdown, gc gasComparison) []string {
	insights := make([]string, 0, 4)

	// Cost per kWh trend
	if len(historical) >= 6 {
		recent3 := historical[len(historical)-3:]
		earlier3 := historical[len(historical)-6 : len(historical)-3]
		recentAvg := avgCostPerKwh(recent3)
		earlierAvg := avgCostPerKwh(earlier3)
		if earlierAvg > 0 {
			change := (recentAvg - earlierAvg) / earlierAvg * 100
			if change < -3 {
				insights = append(insights, fmt.Sprintf("Your cost per kWh has decreased %.0f%% over the last 6 months", math.Abs(change)))
			} else if change > 3 {
				insights = append(insights, fmt.Sprintf("Your cost per kWh has increased %.0f%% over the last 6 months — check for rate changes", change))
			}
		}
	}

	// Home vs Supercharger optimization
	if bd.Supercharger.Pct > 20 && bd.Home.AvgCostPerKWh > 0 && bd.Supercharger.AvgCostPerKWh > bd.Home.AvgCostPerKWh {
		savingsPerSession := (bd.Supercharger.AvgCostPerKWh - bd.Home.AvgCostPerKWh) * 30 // ~30 kWh avg session
		insights = append(insights, fmt.Sprintf("Shifting 2 more sessions to home charging would save ~$%.0f/month", savingsPerSession*2))
	}

	// Gas savings
	if gc.AnnualSavings > 0 {
		insights = append(insights, fmt.Sprintf("You're saving ~$%.0f/year compared to a gas vehicle", gc.AnnualSavings))
	}

	// Consistency
	if len(historical) >= 3 {
		last := historical[len(historical)-1]
		prev := historical[len(historical)-2]
		if last.Cost > prev.Cost*1.3 {
			insights = append(insights, fmt.Sprintf("Last month's cost ($%.0f) was %.0f%% higher than the previous month", last.Cost, (last.Cost/prev.Cost-1)*100))
		}
	}

	if len(insights) == 0 {
		insights = append(insights, "Consistent charging patterns — keep it up!")
	}

	return insights
}

// ── Rounding helpers ─────────────────────────────────────────

func avgCostPerKwh(months []historicalMonth) float64 {
	var totalCost, totalKwh float64
	for _, m := range months {
		totalCost += m.Cost
		totalKwh += m.KWh
	}
	if totalKwh == 0 {
		return 0
	}
	return totalCost / totalKwh
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }
func round2(v float64) float64 { return math.Round(v*100) / 100 }
func round3(v float64) float64 { return math.Round(v*1000) / 1000 }

const defaultCostForecastMonths = 6

// ---------------------------------------------------------------------
// Production wiring for the tool interface declared by
// internal/ai/tools/cost_forecast.go. Kept in package api so it can
// reuse the canonical ComputeCostForecast helper without introducing
// an import cycle; mirrors the battery-health-forecast-narrative
// slice's AIBatteryHealthForecaster pattern.
// ---------------------------------------------------------------------

// AICostForecaster is the production forecast.CostForecaster. It
// delegates to the SHARED api.ComputeCostForecast helper that
// also backs the canonical GET /api/v1/analytics/cost-forecast
// handler so the AI narration is grounded in the SAME
// deterministic forecast model the chart on /cost-analysis
// renders. No new SQL is added by this slice.
//
// Refactoring the existing Handler.GetForecast to
// pull its core into the package-level ComputeCostForecast helper
// (and having both call sites use it) was the deliberate choice
// over duplicating the SQL/math here — the slice 0029 rubber-duck
// critique flagged duplicated SQL as a blocking issue.
//
// The struct holds *database.DB; the constructor panics on a
// nil so a wiring bug surfaces at boot.
type AICostForecaster struct {
	db *database.DB
}

// NewAICostForecaster constructs the adapter. Panics on a nil
// *database.DB so a wiring mistake surfaces at boot rather than
// as a nil-deref on first AI request.
func NewAICostForecaster(db *database.DB) *AICostForecaster {
	if db == nil {
		panic("api: NewAICostForecaster: nil *database.DB")
	}
	return &AICostForecaster{db: db}
}

// ForecastCosts implements forecast.CostForecaster. Composes the
// SAME api.ComputeCostForecast helper *Handler.GetForecast
// uses so the returned envelope is numerically identical (modulo
// rounding) to what GET /api/v1/analytics/cost-forecast produces
// — the AI surface is grounded in the SAME deterministic model
// the chart renders.
//
// The function does NOT recompute or override anything the
// canonical handler computes; it only reshapes the existing
// output into the typed [forecast.CostForecast] envelope the LLM
// can quote.
//
// Currency is left empty for now: the existing baseline response
// does not surface a currency code, and Phase-48's SI-canonical
// migration left cost_currency on charging_sessions but the
// aggregated `cost_decimal` already mixes currencies at the row
// level. Surfacing a single currency for the aggregate would
// require a separate query + assumption layer that lives outside
// this slice. The narrator's system prompt does not assume any
// currency code; it quotes raw dollar figures consistent with
// the chart.
func (a *AICostForecaster) ForecastCosts(ctx context.Context, vehicleID int64, months int) (*forecast.CostForecast, error) {
	if vehicleID <= 0 {
		return nil, errors.New("api ai cost-forecast-narration: vehicle_id must be > 0")
	}
	if months <= 0 {
		months = defaultCostForecastMonths
	}

	resp, meta, err := ComputeCostForecast(ctx, a.db, vehicleID, months)
	if err != nil {
		return nil, fmt.Errorf("api ai cost-forecast-narration: ComputeCostForecast: %w", err)
	}

	// Reshape the wire-shape response + metadata into the
	// typed AI envelope. Field-by-field copy keeps the AI
	// envelope decoupled from any future widening of the
	// internal historicalMonth / forecastMonth structs (the
	// narrator should remain pinned to a stable shape).
	historical := make([]forecast.CostForecastHistoricalMonth, 0, len(resp.Historical))
	for _, m := range resp.Historical {
		historical = append(historical, forecast.CostForecastHistoricalMonth{
			Month:      m.Month,
			Cost:       m.Cost,
			KWh:        m.KWh,
			Sessions:   m.Sessions,
			CostPerKWh: m.CostPerKWh,
		})
	}
	forecastMonths := make([]forecast.CostForecastFutureMonth, 0, len(resp.Forecast))
	for _, m := range resp.Forecast {
		forecastMonths = append(forecastMonths, forecast.CostForecastFutureMonth{
			Month:    m.Month,
			Cost:     m.Cost,
			CostLow:  m.CostLow,
			CostHigh: m.CostHigh,
			KWh:      m.KWh,
		})
	}

	insights := append([]string(nil), resp.Insights...)
	assumptions := append([]string(nil), meta.Assumptions...)

	return &forecast.CostForecast{
		VehicleID:            vehicleID,
		Currency:             "", // see method-level doc comment
		HistoricalMonthCount: meta.HistoricalMonthCount,
		MinRequiredMonths:    meta.MinRequiredMonths,
		HasEnoughData:        meta.HasEnoughData,
		DataThroughMonth:     meta.DataThroughMonth,
		ForecastMonths:       meta.ForecastMonths,
		ForecastMethod:       meta.ForecastMethod,
		UncertaintyMethod:    meta.UncertaintyMethod,
		UncertaintyLevel:     meta.UncertaintyLevel,
		Assumptions:          assumptions,
		Historical:           historical,
		Forecast:             forecastMonths,
		Breakdown: forecast.CostForecastBreakdown{
			Home: forecast.CostForecastChargerCategory{
				Pct:           resp.Breakdown.Home.Pct,
				AvgCostPerKWh: resp.Breakdown.Home.AvgCostPerKWh,
				MonthlyAvg:    resp.Breakdown.Home.MonthlyAvg,
			},
			Supercharger: forecast.CostForecastChargerCategory{
				Pct:           resp.Breakdown.Supercharger.Pct,
				AvgCostPerKWh: resp.Breakdown.Supercharger.AvgCostPerKWh,
				MonthlyAvg:    resp.Breakdown.Supercharger.MonthlyAvg,
			},
		},
		GasComparison: forecast.CostForecastGasComparison{
			AvgKmPerMonth:   resp.GasComparison.AvgKmPerMonth,
			GasCostPerMonth: resp.GasComparison.GasCostPerMonth,
			EvCostPerMonth:  resp.GasComparison.EvCostPerMonth,
			MonthlySavings:  resp.GasComparison.MonthlySavings,
			AnnualSavings:   resp.GasComparison.AnnualSavings,
			LifetimeSavings: resp.GasComparison.LifetimeSavings,
		},
		Insights: insights,
	}, nil
}

// Compile-time assertion: AICostForecaster satisfies
// forecast.CostForecaster.
var _ forecast.CostForecaster = (*AICostForecaster)(nil)
