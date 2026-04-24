package api

import (
	"math"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// TCOHandler handles True Cost of Ownership analytics requests.
type TCOHandler struct {
	db *database.DB
}

func NewTCOHandler(db *database.DB) *TCOHandler {
	return &TCOHandler{db: db}
}

func (h *TCOHandler) GetTCO(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	ctx := r.Context()

	// Total electricity cost from charging sessions
	var totalChargingCost, totalKWh float64
	var totalSessions int
	err = h.db.Pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(cost), 0), COALESCE(SUM(energy_added_kwh), 0), COUNT(*)
		 FROM charging_sessions WHERE vehicle_id = $1 AND cost > 0`, vehicleID,
	).Scan(&totalChargingCost, &totalKWh, &totalSessions)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("tco: failed to get charging costs")
		writeError(w, http.StatusInternalServerError, "failed to get TCO data")
		return
	}

	// Total distance and date range from daily_mileage
	var totalKm float64
	var firstDate, lastDate *time.Time
	err = h.db.Pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(distance_km), 0), MIN(date), MAX(date)
		 FROM daily_mileage WHERE vehicle_id = $1`, vehicleID,
	).Scan(&totalKm, &firstDate, &lastDate)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("tco: failed to get mileage data")
		writeError(w, http.StatusInternalServerError, "failed to get TCO data")
		return
	}

	// Get gas price and efficiency from settings
	var baseCostPerKWh, gasPrice, gasEfficiencyMPG float64
	err = h.db.Pool.QueryRow(ctx,
		`SELECT
		   COALESCE((SELECT value_num FROM settings WHERE key = 'base_cost_per_kwh'), 0.12),
		   COALESCE((SELECT value_num FROM settings WHERE key = 'gas_price_per_unit'), 3.50),
		   COALESCE((SELECT value_num FROM settings WHERE key = 'gas_efficiency_mpg'), 25)`,
	).Scan(&baseCostPerKWh, &gasPrice, &gasEfficiencyMPG)
	if err != nil {
		log.Error().Err(err).Msg("tco: failed to get settings")
		writeError(w, http.StatusInternalServerError, "failed to get TCO data")
		return
	}
	// Guard against zero/negative values that would cause division-by-zero (producing +Inf/NaN in JSON)
	if gasEfficiencyMPG <= 0 {
		gasEfficiencyMPG = 25
	}
	if baseCostPerKWh <= 0 {
		baseCostPerKWh = 0.12
	}
	if gasPrice <= 0 {
		gasPrice = 3.50
	}

	// Calculate ownership duration
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

	// Calculate cost comparisons
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

	maintenanceSavingsEstimate := monthsOfOwnership * 50

	// Build monthly breakdown from charging sessions
	type monthlyEntry struct {
		Month          string  `json:"month"`
		EVCost         float64 `json:"ev_cost"`
		EquivGasCost   float64 `json:"equiv_gas_cost"`
		Savings        float64 `json:"savings"`
		CumSavings     float64 `json:"cumulative_savings"`
		EnergyKWh      float64 `json:"energy_kwh"`
	}

	rows, err := h.db.Pool.Query(ctx,
		`SELECT TO_CHAR(start_ts, 'YYYY-MM') as month,
		        COALESCE(SUM(cost), 0) as monthly_cost,
		        COALESCE(SUM(energy_added_kwh), 0) as monthly_kwh
		 FROM charging_sessions
		 WHERE vehicle_id = $1 AND cost > 0
		 GROUP BY TO_CHAR(start_ts, 'YYYY-MM')
		 ORDER BY month`, vehicleID)
	if err != nil {
		log.Error().Err(err).Msg("tco: failed to get monthly breakdown")
		writeError(w, http.StatusInternalServerError, "failed to get TCO data")
		return
	}
	defer rows.Close()

	var monthlyBreakdown []monthlyEntry
	var cumulativeSavings float64
	for rows.Next() {
		var month string
		var monthlyCost, monthlyKWh float64
		if err := rows.Scan(&month, &monthlyCost, &monthlyKWh); err != nil {
			continue
		}
		// Estimate equivalent gas cost for this month's driving using energy consumed
		equivGas := 0.0
		if baseCostPerKWh > 0 && gasEfficiencyMPG > 0 {
			// kWh → estimated km (using overall efficiency) → miles → gallons → cost
			kmPerKWh := 0.0
			if totalKWh > 0 && totalKm > 0 {
				kmPerKWh = totalKm / totalKWh
			} else {
				kmPerKWh = 5.0 // reasonable EV default
			}
			estimatedKm := monthlyKWh * kmPerKWh
			estimatedMiles := estimatedKm / 1.60934
			gallons := estimatedMiles / gasEfficiencyMPG
			equivGas = gallons * gasPrice
		}
		monthSavings := equivGas - monthlyCost
		cumulativeSavings += monthSavings
		monthlyBreakdown = append(monthlyBreakdown, monthlyEntry{
			Month:        month,
			EVCost:       math.Round(monthlyCost*100) / 100,
			EquivGasCost: math.Round(equivGas*100) / 100,
			Savings:      math.Round(monthSavings*100) / 100,
			CumSavings:   math.Round(cumulativeSavings*100) / 100,
			EnergyKWh:    math.Round(monthlyKWh*100) / 100,
		})
	}

	if monthlyBreakdown == nil {
		monthlyBreakdown = make([]monthlyEntry, 0)
	}
	sort.Slice(monthlyBreakdown, func(i, j int) bool {
		return monthlyBreakdown[i].Month < monthlyBreakdown[j].Month
	})

	// safeF guards against NaN/Inf which silently break json.Encode
	safeF := func(v float64) float64 {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return 0
		}
		return v
	}

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

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id":                   vehicleID,
		"total_charging_cost":          safeF(math.Round(totalChargingCost*100) / 100),
		"total_kwh":                    safeF(math.Round(totalKWh*100) / 100),
		"total_sessions":               totalSessions,
		"total_km":                     safeF(math.Round(totalKm*100) / 100),
		"first_date":                   firstDateStr,
		"last_date":                    lastDateStr,
		"months_of_ownership":          safeF(math.Round(monthsOfOwnership*10) / 10),
		"cost_per_km_ev":               safeF(math.Round(costPerKmEV*10000) / 10000),
		"cost_per_km_ice":              safeF(math.Round(costPerKmICE*10000) / 10000),
		"equivalent_gas_cost":          safeF(math.Round(equivalentGasCostTotal*100) / 100),
		"total_savings":                safeF(math.Round(totalSavings*100) / 100),
		"monthly_savings":              safeF(math.Round(monthlySavings*100) / 100),
		"maintenance_savings_estimate": safeF(math.Round(maintenanceSavingsEstimate*100) / 100),
		"gas_price":                    safeF(gasPrice),
		"gas_efficiency_mpg":           safeF(gasEfficiencyMPG),
		"base_cost_per_kwh":            safeF(baseCostPerKWh),
		"monthly_breakdown":            monthlyBreakdown,
	})
}
