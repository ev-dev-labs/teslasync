package tco

// TCO narration.
// The deterministic TCO math lives here so the HTTP chart endpoint and AI
// narration use one SQL/computation path. Keep the JSON wire shape byte-stable;
// summary_test.go::TestComputeTCOSummary_StructFieldsPinWireShape pins it.

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

const (
	kilometersPerMile = 1.60934
	litersPerUSGallon = 3.785411784
)

// TCOMonthlyEntry is one monthly_breakdown row. JSON tags mirror the original
// handler shape so AI narration and the chart share one contract.
type TCOMonthlyEntry struct {
	Month        string  `json:"month"`
	EVCost       float64 `json:"ev_cost"`
	EquivGasCost float64 `json:"equiv_gas_cost"`
	Savings      float64 `json:"savings"`
	CumSavings   float64 `json:"cumulative_savings"`
	EnergyWh     float64 `json:"energy_wh"`
}

// TCOSummary is the typed envelope written by the TCO handler and wrapped by AI
// narration. Its JSON tags intentionally mirror the existing endpoint contract,
// including legacy key names, until a coordinated SI wire-contract cutover.
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
	GasUnit                    string            `json:"gas_unit"`
	GasEfficiencyMPG           float64           `json:"gas_efficiency_mpg"`
	BaseCostPerKWh             float64           `json:"base_cost_per_kwh"`
	MonthlyBreakdown           []TCOMonthlyEntry `json:"monthly_breakdown"`
}

// ComputeTCOSummary runs the deterministic TCO aggregation shared by the HTTP
// endpoint and AI tool. It preserves the pre-refactor query order, defaults,
// rounding, safeF guards, and empty-not-null monthly_breakdown contract.
func ComputeTCOSummary(ctx context.Context, db *database.DB, vehicleID int64) (TCOSummary, error) {
	if db == nil {
		return TCOSummary{}, errors.New("api: ComputeTCOSummary: nil *database.DB")
	}
	if vehicleID <= 0 {
		return TCOSummary{}, fmt.Errorf("api: ComputeTCOSummary: vehicle_id must be > 0 (got %d)", vehicleID)
	}

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

	var baseCostPerKWh, gasPrice, gasEfficiencyMPG float64
	var gasUnit string
	if err := db.Pool.QueryRow(ctx,
		`SELECT
		   COALESCE((SELECT value_num FROM settings WHERE key = 'base_cost_per_kwh'), 0.12),
		   COALESCE((SELECT value_num FROM settings WHERE key = 'gas_price_per_unit'), 3.50),
		   COALESCE((SELECT value_num FROM settings WHERE key = 'gas_efficiency_mpg'), 25),
		   COALESCE((SELECT value_text FROM settings WHERE key = 'gas_unit'), 'gallon')`,
	).Scan(&baseCostPerKWh, &gasPrice, &gasEfficiencyMPG, &gasUnit); err != nil {
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
	gasUnit = normalizeGasUnit(gasUnit)

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

	var costPerKmEV, costPerKmICE, totalSavings, monthlySavings float64
	if totalKm > 0 {
		costPerKmEV = totalChargingCost / totalKm
		equivalentGasCost := gasCostForDistanceKm(
			totalKm,
			gasPrice,
			gasEfficiencyMPG,
			gasUnit,
		)
		costPerKmICE = equivalentGasCost / totalKm
		totalSavings = equivalentGasCost - totalChargingCost
		monthlySavings = totalSavings / monthsOfOwnership
	}

	// Heuristic operating-cost-only maintenance estimate ($50/mo).
	maintenanceSavingsEstimate := monthsOfOwnership * 50

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
		// Keep the pre-refactor heuristic: infer monthly distance from energy instead
		// of adding a per-month distance lookup, because the chart pins this contract.
		equivGas := 0.0
		if gasEfficiencyMPG > 0 {
			kmPerKWh := 0.0
			if totalWh > 0 && totalKm > 0 {
				kmPerKWh = totalKm / (totalWh / 1000.0)
			} else {
				kmPerKWh = 5.0 // reasonable EV default
			}
			estimatedKm := (monthlyWh / 1000.0) * kmPerKWh
			equivGas = gasCostForDistanceKm(
				estimatedKm,
				gasPrice,
				gasEfficiencyMPG,
				gasUnit,
			)
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

	equivalentGasCostTotal := 0.0
	if totalKm > 0 {
		equivalentGasCostTotal = gasCostForDistanceKm(
			totalKm,
			gasPrice,
			gasEfficiencyMPG,
			gasUnit,
		)
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
		GasUnit:                    gasUnit,
		GasEfficiencyMPG:           safeF(gasEfficiencyMPG),
		BaseCostPerKWh:             safeF(baseCostPerKWh),
		MonthlyBreakdown:           monthlyBreakdown,
	}, nil
}

func normalizeGasUnit(unit string) string {
	if strings.EqualFold(strings.TrimSpace(unit), "liter") {
		return "liter"
	}
	return "gallon"
}

func gasCostForDistanceKm(
	distanceKm float64,
	pricePerUnit float64,
	efficiencyMPG float64,
	gasUnit string,
) float64 {
	if distanceKm <= 0 || pricePerUnit <= 0 || efficiencyMPG <= 0 {
		return 0
	}
	gallons := distanceKm / kilometersPerMile / efficiencyMPG
	if normalizeGasUnit(gasUnit) == "liter" {
		return gallons * litersPerUSGallon * pricePerUnit
	}
	return gallons * pricePerUnit
}
