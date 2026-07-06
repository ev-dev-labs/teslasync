package chargeopt

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/rs/zerolog/log"
)

// chargeoptDataTimeout bounds the two data-access reads (sessions +
// location enrichment) so a stalled connection cannot pin the request
// goroutine for as long as the inbound HTTP client is willing to wait.
// The pool's statement_timeout is a server-side safety net; this is the
// client-side deadline the boundary rule calls for. A var (not const) so
// tests can shorten it deterministically if needed.
var chargeoptDataTimeout = 15 * time.Second

// ChargingOptimizerHandler analyses charging habits and recommends schedule optimizations.
type ChargingOptimizerHandler struct {
	repo optimizerRepo
}

// NewChargingOptimizerHandler wires the handler to a pgx-backed optimizer
// repo. Panics on a nil pool (fail-fast wiring contract — see
// newPgxOptimizerRepo).
func NewChargingOptimizerHandler(db *database.DB) *ChargingOptimizerHandler {
	return &ChargingOptimizerHandler{repo: newPgxOptimizerRepo(db.Pool)}
}

// GetOptimization serves optimizer metrics for a single vehicle.
func (h *ChargingOptimizerHandler) GetOptimization(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required")
		return
	}
	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), chargeoptDataTimeout)
	defer cancel()

	sessions, err := h.repo.Sessions(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("charging-optimizer: query failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get charging data")
		return
	}

	if len(sessions) == 0 {
		httpx.WriteJSON(w, http.StatusOK, optimizerResponse{
			CurrentSchedule: currentSchedule{},
			CostAnalysis:    costAnalysis{PeakHours: []int{}, OffpeakHours: []int{}},
			Recommendations: []optimizerRec{},
			WeeklyHeatmap:   []heatmapEntry{},
		})
		return
	}

	// Enrich sessions with lat/lon/temp from signal_log. Enrichment is
	// best-effort: a failure downgrades home-location detection but must
	// not fail the whole optimizer response, so the error is logged and
	// the request proceeds with the un-enriched sessions.
	locs, err := h.repo.LocationEnrichment(ctx, vehicleID)
	if err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("charging-optimizer: signal_log location query failed")
	} else {
		for i := range sessions {
			loc, ok := locs[sessions[i].id]
			if !ok {
				continue
			}
			if loc.lat != nil && loc.lon != nil {
				sessions[i].lat = *loc.lat
				sessions[i].lon = *loc.lon
			} else {
				log.Debug().Int64("session_id", sessions[i].id).Msg("charging-optimizer: no lat/lon in signal_log, skipping home detection for session")
			}
			if loc.temp != nil {
				sessions[i].outsideTemp = *loc.temp
			}
		}
	}

	schedule := analyzeSchedule(sessions)
	homeLocSessions, homePct := detectHome(sessions)
	schedule.HomeChargingPct = round2(homePct)

	heatmap, ca := analyzeCosts(sessions, homeLocSessions)
	healthScore := computeBatteryHealthScore(sessions)
	recs := buildOptimizerRecommendations(schedule, ca, healthScore, sessions)

	httpx.WriteJSON(w, http.StatusOK, optimizerResponse{
		CurrentSchedule:    schedule,
		CostAnalysis:       ca,
		BatteryHealthScore: healthScore,
		Recommendations:    recs,
		WeeklyHeatmap:      heatmap,
	})
}
