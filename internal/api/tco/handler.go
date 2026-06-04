package tco

// TCO narration handler.
//
// The deterministic Total-Cost-of-Ownership math previously inlined
// inside (*Handler).GetTCO has been extracted to the package-level
// pure helper [ComputeTCOSummary] in summary.go so the AI
// surface (POST /api/v1/ai/analytics/tco/narrate via the
// [lifetime.TCOSummarizer] adapter) shares the SAME numbers the chart
// renders. This file therefore parses + validates the request and
// writes the response; all SQL and arithmetic live in the helper.
//
// Wire-shape stability: the response body MUST stay byte-identical
// with the pre-refactor inline `map[string]interface{}` literal.
// The mapping below uses the SAME snake_case keys, the SAME field
// order, the SAME safeF/math.Round guards (now inside the helper),
// and the SAME empty-not-null guard for monthly_breakdown. A
// contract test (summary_test.go) pins the JSON field
// list so a future drift breaks loudly.

import (
	"net/http"
	"strconv"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/rs/zerolog/log"
)

// Handler handles True Cost of Ownership analytics requests.
type Handler struct {
	db *database.DB
}

func NewHandler(db *database.DB) *Handler {
	return &Handler{db: db}
}

func (h *Handler) GetTCO(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	summary, err := ComputeTCOSummary(r.Context(), h.db, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("tco: ComputeTCOSummary failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get TCO data")
		return
	}

	// Wire shape MUST stay byte-identical with the pre-refactor
	// inline literal — the deterministic TrueCostPage chart
	// consumes every field by snake_case key. The contract test
	// in summary_test.go pins this field list.
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id":                   summary.VehicleID,
		"total_charging_cost":          summary.TotalChargingCost,
		"total_wh":                     summary.TotalWh,
		"total_sessions":               summary.TotalSessions,
		"total_km":                     summary.TotalKm,
		"first_date":                   summary.FirstDate,
		"last_date":                    summary.LastDate,
		"months_of_ownership":          summary.MonthsOfOwnership,
		"cost_per_km_ev":               summary.CostPerKmEV,
		"cost_per_km_ice":              summary.CostPerKmICE,
		"equivalent_gas_cost":          summary.EquivalentGasCost,
		"total_savings":                summary.TotalSavings,
		"monthly_savings":              summary.MonthlySavings,
		"maintenance_savings_estimate": summary.MaintenanceSavingsEstimate,
		"gas_price":                    summary.GasPrice,
		"gas_efficiency_mpg":           summary.GasEfficiencyMPG,
		"base_cost_per_kwh":            summary.BaseCostPerKWh,
		"monthly_breakdown":            summary.MonthlyBreakdown,
	})
}
