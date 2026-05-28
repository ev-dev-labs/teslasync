package periodstats

import (
	"context"
	"math"
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// Handler serves period comparison analytics.
type Handler struct {
	db *database.DB
}

func NewHandler(db *database.DB) *Handler {
	return &Handler{db: db}
}

// PeriodStats is the canonical period-stats envelope returned by
// the GET /api/v1/analytics/period-stats handler AND consumed by
// the AI period-compare-narration tool. The numbers are display-
// unit (km, kWh, Wh/km, kg) for parity with the chart on the
// PeriodComparePage that already renders this exact shape.
//
// Phase-50 / 0040 — extracted from the inline handler so the AI
// tool adapter can compose the SAME deterministic helper that
// backs the canonical baseline; no new SQL is written by the AI
// slice.
type PeriodStats struct {
	TotalDistance float64 `json:"total_distance"` // km
	TotalDrives   int     `json:"total_drives"`
	EnergyUsed    float64 `json:"energy_used"`    // kWh
	AvgEfficiency float64 `json:"avg_efficiency"` // Wh/km
	TotalCost     float64 `json:"total_cost"`
	CO2Saved      float64 `json:"co2_saved"` // kg
}

// ComputePeriodStats runs the deterministic period-stats aggregate
// for vehicleID over the trailing `days` window. days <= 0 means
// "all time" (no date filter), mirroring the canonical
// /analytics/period-stats?days=0 contract the SPA already uses.
//
// Returns (stats, queryErr). The queryErr is non-nil ONLY when the
// drives query fails; a charging-query failure is logged and
// folded into a zero-energy/zero-cost envelope (parity with the
// historical handler so the SPA never sees a 500 caused by a
// recent charging-table schema drift).
//
// Extracted from Handler.Get so the AI period-compare-narration
// adapter can ground its narration in the SAME deterministic envelope
// the chart renders.
func ComputePeriodStats(ctx context.Context, db *database.DB, vehicleID int64, days int) (PeriodStats, error) {
	dateFilter := ""
	if days > 0 {
		dateFilter = " AND started_at > NOW() - interval '" + strconv.Itoa(days) + " days'"
	}

	// Total distance & drives. Phase-42 SI canonical drives (000185):
	// distance_m / duration_s. Convert to km/min at JSON-populate site.
	var totalDistM, totalDurS *float64
	var totalDrives int
	err := db.Pool.QueryRow(ctx,
		`SELECT COUNT(*), COALESCE(SUM(distance_m), 0), COALESCE(SUM(duration_s), 0)
		 FROM drives WHERE vehicle_id = $1 AND ended_at IS NOT NULL`+dateFilter, vehicleID,
	).Scan(&totalDrives, &totalDistM, &totalDurS)
	if err != nil {
		return PeriodStats{}, err
	}

	// Energy & cost from charging sessions. Phase-42 SI canonical
	// charging_sessions (000184): total_energy_added_wh, cost_decimal.
	var energyAddedWh, totalCost *float64
	err = db.Pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(total_energy_added_wh), 0), COALESCE(SUM(cost_decimal::float8), 0)
		 FROM charging_sessions WHERE vehicle_id = $1`+dateFilter, vehicleID,
	).Scan(&energyAddedWh, &totalCost)
	if err != nil {
		log.Error().Err(err).Msg("period-stats: charging query")
		energyAddedWh = new(float64)
		totalCost = new(float64)
	}

	distM := 0.0
	if totalDistM != nil {
		distM = *totalDistM
	}
	energyWh := 0.0
	if energyAddedWh != nil {
		energyWh = *energyAddedWh
	}
	cost := 0.0
	if totalCost != nil {
		cost = *totalCost
	}

	// Convert SI → display units (km, kWh) at the response boundary.
	distKm := distM / 1000.0
	energyKWh := energyWh / 1000.0

	// Efficiency: Wh/km from SI columns directly (energy_wh / distance_km).
	avgEff := 0.0
	if distKm > 0 && energyWh > 0 {
		avgEff = energyWh / distKm
	}

	// CO2 saved vs ICE: ~120g/km for ICE, ~0 for EV (grid emissions vary)
	co2Saved := distKm * 0.120 // 120g/km saved → kg

	sf := func(v float64) float64 {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return 0
		}
		return math.Round(v*100) / 100
	}

	return PeriodStats{
		TotalDistance: sf(distKm),
		TotalDrives:   totalDrives,
		EnergyUsed:    sf(energyKWh),
		AvgEfficiency: sf(avgEff),
		TotalCost:     sf(cost),
		CO2Saved:      sf(co2Saved),
	}, nil
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	daysStr := r.URL.Query().Get("days")
	days, _ := strconv.Atoi(daysStr)

	stats, err := ComputePeriodStats(r.Context(), h.db, vehicleID, days)
	if err != nil {
		log.Error().Err(err).Msg("period-stats: drives query")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query period stats")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"total_distance": stats.TotalDistance,
		"total_drives":   stats.TotalDrives,
		"energy_used":    stats.EnergyUsed,
		"avg_efficiency": stats.AvgEfficiency,
		"total_cost":     stats.TotalCost,
		"co2_saved":      stats.CO2Saved,
	})
}
