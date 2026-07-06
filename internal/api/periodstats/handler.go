package periodstats

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// statsQuerier is the minimal read surface the period-stats aggregates need:
// a single-row query executor. Both *pgxpool.Pool and database.DBTX satisfy
// it, so production passes db.Pool while tests pass an in-memory fake — no
// live database, per the package's hermetic test contract. Deliberately
// narrow (interface segregation) so a fake only implements QueryRow.
type statsQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// computeTimeout bounds the two aggregate queries behind
// GET /analytics/period-stats so a stalled connection cannot pin a request
// goroutine indefinitely. Belt-and-suspenders alongside the per-connection
// statement_timeout configured on the pool.
const computeTimeout = 15 * time.Second

// Handler serves period comparison analytics.
type Handler struct {
	q statsQuerier
}

func NewHandler(db *database.DB) *Handler {
	var q statsQuerier
	if db != nil && db.Pool != nil {
		q = db.Pool
	}
	return &Handler{q: q}
}

// PeriodStats is the canonical period-stats envelope returned by
// the GET /api/v1/analytics/period-stats handler AND consumed by
// the AI period-compare-narration tool. The numbers are display-
// unit (km, kWh, Wh/km, kg) for parity with the chart on the
// PeriodComparePage that already renders this exact shape.
//
// Extracted from the inline handler so the AI tool adapter can compose the
// same deterministic helper that backs the canonical baseline; no new SQL is
// written by the AI path.
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
// Returns (stats, queryErr). The queryErr is non-nil when the drives
// query fails (or the database handle is nil); a charging-query failure
// is logged and folded into a zero-energy/zero-cost envelope (parity with
// the historical handler so the SPA never sees a 500 caused by a recent
// charging-table schema drift).
//
// Extracted from Handler.Get so the AI period-compare-narration
// adapter can ground its narration in the SAME deterministic envelope
// the chart renders.
func ComputePeriodStats(ctx context.Context, db *database.DB, vehicleID int64, days int) (PeriodStats, error) {
	if db == nil || db.Pool == nil {
		return PeriodStats{}, errors.New("periodstats: compute period stats: nil database handle")
	}
	return computePeriodStats(ctx, db.Pool, vehicleID, days)
}

// computePeriodStats is the connection-shape-agnostic core behind
// ComputePeriodStats. It reads through a statsQuerier so the aggregate
// logic can be exercised with an in-memory fake (no live database). The
// trailing window is parameterised ($2) — never string-interpolated — and
// days <= 0 means "all time" (no window predicate), mirroring the canonical
// /analytics/period-stats?days=0 contract the SPA already uses.
func computePeriodStats(ctx context.Context, q statsQuerier, vehicleID int64, days int) (PeriodStats, error) {
	if q == nil {
		return PeriodStats{}, errors.New("periodstats: compute period stats: nil querier")
	}

	// days <= 0 -> all time. Otherwise bound both aggregates to the trailing
	// window with a parameterised interval ($2 days) so the day count is a
	// bound value, not interpolated SQL text.
	args := []any{vehicleID}
	dateFilter := ""
	if days > 0 {
		args = append(args, days)
		dateFilter = " AND started_at > NOW() - ($2::double precision * INTERVAL '1 day')"
	}

	// Total distance and drives from SI canonical distance_m; converted to km
	// at the JSON-populate site below. COALESCE keeps the sum non-NULL, but the
	// pointer scan target stays defensive against a NULL leaking through.
	var totalDistM *float64
	var totalDrives int
	if err := q.QueryRow(ctx,
		`SELECT COUNT(*), COALESCE(SUM(distance_m), 0)
		 FROM drives WHERE vehicle_id = $1 AND ended_at IS NOT NULL`+dateFilter, args...,
	).Scan(&totalDrives, &totalDistM); err != nil {
		return PeriodStats{}, fmt.Errorf("periodstats: drives aggregate query: %w", err)
	}

	// Energy and cost from charging sessions (SI canonical
	// total_energy_added_wh + NUMERIC cost_decimal). A charging-query failure
	// is folded into a zero-energy / zero-cost envelope — parity with the
	// historical handler so a charging-table schema drift never turns into a
	// 500 for the SPA. Logged at Warn: degraded, not fatal.
	var energyAddedWh, totalCost *float64
	if err := q.QueryRow(ctx,
		`SELECT COALESCE(SUM(total_energy_added_wh), 0), COALESCE(SUM(cost_decimal::float8), 0)
		 FROM charging_sessions WHERE vehicle_id = $1`+dateFilter, args...,
	).Scan(&energyAddedWh, &totalCost); err != nil {
		log.Warn().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Int("days", days).
			Msg("periodstats: charging aggregate query failed; folding to zero energy/cost")
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

	return PeriodStats{
		TotalDistance: roundStat(distKm),
		TotalDrives:   totalDrives,
		EnergyUsed:    roundStat(energyKWh),
		AvgEfficiency: roundStat(avgEff),
		TotalCost:     roundStat(cost),
		CO2Saved:      roundStat(co2Saved),
	}, nil
}

// roundStat rounds v to 2 decimals, mapping NaN/Inf to 0 so a degenerate
// input never serialises as an invalid JSON number. The rounding is part of
// the wire contract the chart and the AI narration both quote.
func roundStat(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return math.Round(v*100) / 100
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

	// days is optional; a missing/blank/unparseable value means "all time"
	// (days = 0), matching the documented /analytics/period-stats?days=0
	// contract the SPA relies on.
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))

	ctx, cancel := context.WithTimeout(r.Context(), computeTimeout)
	defer cancel()

	stats, err := computePeriodStats(ctx, h.q, vehicleID, days)
	if err != nil {
		log.Error().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Int("days", days).
			Msg("periodstats: period-stats query failed")
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
