package api

// Phase-50 / 0050 — M2 TCO narration.
//
// tco_summary.go extracts the deterministic Total-Cost-of-Ownership
// computation that *TCOHandler.GetTCO previously performed inline,
// into a package-level pure-functional helper [ComputeTCOSummary].
// The HTTP handler now parses + validates + writes; the math lives
// here and is shared by:
//
//   - the canonical GET /api/v1/analytics/tco handler (existing,
//     consumed by the deterministic TrueCostPage chart), AND
//   - the new AI surface POST /api/v1/ai/analytics/tco/narrate via the
//     [tools.TCOSummarizer] adapter [AITCOSummarizer] (new).
//
// Why extract instead of duplicating the SQL in the AI adapter:
// duplicating ~80 lines of SQL + math would create a parity hazard —
// the chart and the narrator would silently disagree as either side
// drifted. The slice 0029 cost-forecast-narration precedent
// (api.ComputeCostForecast) handles the same shared-helper pattern
// for the same reason, and the rubber-duck critique on this slice
// flagged duplication as a blocking risk.
//
// Wire-shape stability: the canonical /api/v1/analytics/tco JSON
// shape consumed by TrueCostPage.tsx MUST remain byte-identical.
// All math.Round + safeF guards therefore live INSIDE the helper, so
// the AI envelope and the chart see the SAME rounded numbers (the
// LLM cannot be handed an unrounded float that disagrees with what
// the user sees on the chart). The HTTP wire shape is reproduced
// verbatim from the pre-refactor `writeJSON(w, http.StatusOK,
// map[string]interface{}{...})` call site — every snake_case JSON
// tag, every safeF/math.Round usage, and the empty-not-null guard
// for monthly_breakdown are all preserved.

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// TCOMonthlyEntry is one row of the monthly_breakdown[] array on
// the /api/v1/analytics/tco JSON wire shape. Promoted to a
// package-level type (it was an inline anonymous struct in the
// original handler) so the AI adapter can produce the SAME shape
// without redeclaring it. JSON tags are unchanged from the
// pre-refactor inline declaration.
type TCOMonthlyEntry struct {
	Month        string  `json:"month"`
	EVCost       float64 `json:"ev_cost"`
	EquivGasCost float64 `json:"equiv_gas_cost"`
	Savings      float64 `json:"savings"`
	CumSavings   float64 `json:"cumulative_savings"`
	EnergyWh     float64 `json:"energy_wh"`
}

// TCOSummary is the typed envelope ComputeTCOSummary returns. The
// JSON tags MUST stay byte-identical with the pre-refactor inline
// `map[string]interface{}` literal in [TCOHandler.GetTCO] — the
// deterministic TrueCostPage chart consumes every field listed
// here by snake_case key. A future field addition to the canonical
// wire shape MUST land here AND in the chart's TS interface.
//
// All numeric fields are post-rounded + safeF-guarded inside
// ComputeTCOSummary so the JSON encoder never sees NaN/Inf and
// the AI narrator quotes the same numbers the chart renders.
//
// Phase-48 SI-canonical note: the canonical /api/v1/analytics/tco
// wire shape predates the SI-canonical migration. The legacy
// snake_case keys (`total_wh`, `total_km`, `cost_per_km_ev`,
// `cost_per_km_ice`, `gas_efficiency_mpg`, `base_cost_per_kwh`)
// are MIRRORED here for chart-parity ONLY — this slice does NOT
// add new legacy-unit fields beyond the existing endpoint shape.
// A future SI-cutover of the wire contract would require a
// coordinated migration of the chart + the AI envelope + the
// strategy goldens; out of scope for the M2 narration slice.
type TCOSummary struct {
	VehicleID                  int64             `json:"vehicle_id"`
	TotalChargingCost          float64           `json:"total_charging_cost"`
	TotalWh                    float64           `json:"total_wh"`
	TotalSessions              int               `json:"total_sessions"`
	TotalKm                    float64           `json:"total_km"`
	FirstDate                  string            `json:"first_date"`
	LastDate                   string            `json:"last_date"`
	MonthsOfOwnership          float64           `json:"months_of_ownership"`
	CostPerKmEV                float64           `json:"cost_per_km_ev"`
	CostPerKmICE               float64           `json:"cost_per_km_ice"`
	EquivalentGasCost          float64           `json:"equivalent_gas_cost"`
	TotalSavings               float64           `json:"total_savings"`
	MonthlySavings             float64           `json:"monthly_savings"`
	MaintenanceSavingsEstimate float64           `json:"maintenance_savings_estimate"`
	GasPrice                   float64           `json:"gas_price"`
	GasEfficiencyMPG           float64           `json:"gas_efficiency_mpg"`
	BaseCostPerKWh             float64           `json:"base_cost_per_kwh"`
	MonthlyBreakdown           []TCOMonthlyEntry `json:"monthly_breakdown"`
}

// ComputeTCOSummary runs the deterministic Total-Cost-of-Ownership
// aggregation for a single vehicle and returns the typed envelope
// the HTTP handler writes verbatim AND the AI tool envelope wraps.
//
// Behaviour MUST stay byte-identical with the pre-refactor inline
// computation in [TCOHandler.GetTCO]:
//
//   - The same three pgx queries (charging-totals, mileage-range,
//     settings-defaults) run in the same order against the same
//     tables/columns.
//   - The same /api/v1/settings defaults (0.12 $/kWh, $3.50/gal,
//     25 MPG) apply when the row is missing or non-positive.
//   - The same ownership-window math (months >= 1; date diff /
//     30.44) applies.
//   - The same maintenance heuristic ($50/month flat) applies.
//   - All float64 outputs are rounded with the SAME math.Round
//     scaling (×100/100 for dollars, ×10000/10000 for cost-per-km,
//     ×10/10 for months) and safeF-guarded so JSON encoding never
//     sees NaN/Inf.
//   - monthly_breakdown is `[]TCOMonthlyEntry{}` (empty) rather
//     than nil so the JSON output is `[]` not `null` — the chart
//     iterates without a null guard.
//
// vehicleID > 0 is required; a non-positive value returns an
// error so the HTTP handler can surface a 400 BEFORE opening the
// SSE stream and the AI tool can refuse the call before any SQL
// runs.
func ComputeTCOSummary(ctx context.Context, db *database.DB, vehicleID int64) (TCOSummary, error) {
	if db == nil {
		return TCOSummary{}, errors.New("api: ComputeTCOSummary: nil *database.DB")
	}
	if vehicleID <= 0 {
		return TCOSummary{}, fmt.Errorf("api: ComputeTCOSummary: vehicle_id must be > 0 (got %d)", vehicleID)
	}

	// 1) Charging-cost / energy / session-count totals.
	var totalChargingCost, totalWh float64
	var totalSessions int
	if err := db.Pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(cost_decimal::float8), 0),
		        COALESCE(SUM(total_energy_added_wh), 0),
		        COUNT(*)
		 FROM charging_sessions
		 WHERE vehicle_id = $1 AND cost_decimal > 0`, vehicleID,
	).Scan(&totalChargingCost, &totalWh, &totalSessions); err != nil {
		return TCOSummary{}, fmt.Errorf("api: ComputeTCOSummary: charging totals: %w", err)
	}

	// 2) Mileage + ownership-window range.
	var totalKm float64
	var firstDate, lastDate *time.Time
	if err := db.Pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(distance_m) / 1000.0, 0),
		        MIN(started_at),
		        MAX(started_at)
		 FROM drives WHERE vehicle_id = $1 AND distance_m > 0`, vehicleID,
	).Scan(&totalKm, &firstDate, &lastDate); err != nil {
		return TCOSummary{}, fmt.Errorf("api: ComputeTCOSummary: mileage range: %w", err)
	}

	// 3) Gas-price / efficiency / electricity-rate defaults.
	var baseCostPerKWh, gasPrice, gasEfficiencyMPG float64
	if err := db.Pool.QueryRow(ctx,
		`SELECT
		   COALESCE((SELECT value_num FROM settings WHERE key = 'base_cost_per_kwh'), 0.12),
		   COALESCE((SELECT value_num FROM settings WHERE key = 'gas_price_per_unit'), 3.50),
		   COALESCE((SELECT value_num FROM settings WHERE key = 'gas_efficiency_mpg'), 25)`,
	).Scan(&baseCostPerKWh, &gasPrice, &gasEfficiencyMPG); err != nil {
		return TCOSummary{}, fmt.Errorf("api: ComputeTCOSummary: settings: %w", err)
	}
	// Guard against zero/negative values that would cause
	// division-by-zero (producing +Inf/NaN in JSON).
	if gasEfficiencyMPG <= 0 {
		gasEfficiencyMPG = 25
	}
	if baseCostPerKWh <= 0 {
		baseCostPerKWh = 0.12
	}
	if gasPrice <= 0 {
		gasPrice = 3.50
	}

	// 4) Ownership-window months (clamped to >=1).
	var monthsOfOwnership float64 = 1
	if firstDate != nil && lastDate != nil && !firstDate.IsZero() && !lastDate.IsZero() {
		days := lastDate.Sub(*firstDate).Hours() / 24
		if days > 0 {
			monthsOfOwnership = days / 30.44
			if monthsOfOwnership < 1 {
				monthsOfOwnership = 1
			}
		}
	}

	// 5) Cost-per-km comparisons + total/monthly savings.
	var costPerKmEV, costPerKmICE, totalSavings, monthlySavings float64
	if totalKm > 0 {
		costPerKmEV = totalChargingCost / totalKm
		totalMiles := totalKm / 1.60934
		gallonsUsed := totalMiles / gasEfficiencyMPG
		equivalentGasCost := gallonsUsed * gasPrice
		costPerKmICE = equivalentGasCost / totalKm
		totalSavings = (costPerKmICE - costPerKmEV) * totalKm
		monthlySavings = totalSavings / monthsOfOwnership
	}

	// Heuristic operating-cost-only maintenance estimate ($50/mo).
	maintenanceSavingsEstimate := monthsOfOwnership * 50

	// 6) Monthly EV-vs-gas breakdown.
	rows, err := db.Pool.Query(ctx,
		`SELECT TO_CHAR(started_at, 'YYYY-MM') as month,
		        COALESCE(SUM(cost_decimal::float8), 0) as monthly_cost,
		        COALESCE(SUM(total_energy_added_wh), 0) as monthly_wh
		 FROM charging_sessions
		 WHERE vehicle_id = $1 AND cost_decimal > 0
		 GROUP BY TO_CHAR(started_at, 'YYYY-MM')
		 ORDER BY month`, vehicleID)
	if err != nil {
		return TCOSummary{}, fmt.Errorf("api: ComputeTCOSummary: monthly breakdown: %w", err)
	}
	defer rows.Close()

	monthlyBreakdown := make([]TCOMonthlyEntry, 0)
	var cumulativeSavings float64
	for rows.Next() {
		var month string
		var monthlyCost, monthlyWh float64
		if err := rows.Scan(&month, &monthlyCost, &monthlyWh); err != nil {
			continue
		}
		// Estimate equivalent gas cost for this month's
		// driving from the energy consumed. The estimator
		// converts kWh → estimated km via the overall
		// efficiency, then km → miles → gallons → cost. The
		// "estimated km from energy" path mirrors the
		// pre-refactor handler's heuristic verbatim — there
		// is intentionally NO per-month distance lookup
		// because the chart matches this contract.
		equivGas := 0.0
		if baseCostPerKWh > 0 && gasEfficiencyMPG > 0 {
			kmPerKWh := 0.0
			if totalWh > 0 && totalKm > 0 {
				kmPerKWh = totalKm / (totalWh / 1000.0)
			} else {
				kmPerKWh = 5.0 // reasonable EV default
			}
			estimatedKm := (monthlyWh / 1000.0) * kmPerKWh
			estimatedMiles := estimatedKm / 1.60934
			gallons := estimatedMiles / gasEfficiencyMPG
			equivGas = gallons * gasPrice
		}
		monthSavings := equivGas - monthlyCost
		cumulativeSavings += monthSavings
		monthlyBreakdown = append(monthlyBreakdown, TCOMonthlyEntry{
			Month:        month,
			EVCost:       math.Round(monthlyCost*100) / 100,
			EquivGasCost: math.Round(equivGas*100) / 100,
			Savings:      math.Round(monthSavings*100) / 100,
			CumSavings:   math.Round(cumulativeSavings*100) / 100,
			EnergyWh:     math.Round(monthlyWh*100) / 100,
		})
	}
	sort.Slice(monthlyBreakdown, func(i, j int) bool {
		return monthlyBreakdown[i].Month < monthlyBreakdown[j].Month
	})

	// 7) Equivalent-gas-cost total (mirrors per-row calc).
	equivalentGasCostTotal := 0.0
	if totalKm > 0 {
		totalMiles := totalKm / 1.60934
		gallonsUsed := totalMiles / gasEfficiencyMPG
		equivalentGasCostTotal = gallonsUsed * gasPrice
	}

	firstDateStr := ""
	lastDateStr := ""
	if firstDate != nil {
		firstDateStr = firstDate.Format("2006-01-02")
	}
	if lastDate != nil {
		lastDateStr = lastDate.Format("2006-01-02")
	}

	// safeF guards against NaN/Inf which silently break json.Encode.
	safeF := func(v float64) float64 {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return 0
		}
		return v
	}

	return TCOSummary{
		VehicleID:                  vehicleID,
		TotalChargingCost:          safeF(math.Round(totalChargingCost*100) / 100),
		TotalWh:                    safeF(math.Round(totalWh*100) / 100),
		TotalSessions:              totalSessions,
		TotalKm:                    safeF(math.Round(totalKm*100) / 100),
		FirstDate:                  firstDateStr,
		LastDate:                   lastDateStr,
		MonthsOfOwnership:          safeF(math.Round(monthsOfOwnership*10) / 10),
		CostPerKmEV:                safeF(math.Round(costPerKmEV*10000) / 10000),
		CostPerKmICE:               safeF(math.Round(costPerKmICE*10000) / 10000),
		EquivalentGasCost:          safeF(math.Round(equivalentGasCostTotal*100) / 100),
		TotalSavings:               safeF(math.Round(totalSavings*100) / 100),
		MonthlySavings:             safeF(math.Round(monthlySavings*100) / 100),
		MaintenanceSavingsEstimate: safeF(math.Round(maintenanceSavingsEstimate*100) / 100),
		GasPrice:                   safeF(gasPrice),
		GasEfficiencyMPG:           safeF(gasEfficiencyMPG),
		BaseCostPerKWh:             safeF(baseCostPerKWh),
		MonthlyBreakdown:           monthlyBreakdown,
	}, nil
}
