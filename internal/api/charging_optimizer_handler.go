package api

import (
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// ChargingOptimizerHandler analyses charging habits and recommends schedule optimizations.
type ChargingOptimizerHandler struct {
	db *database.DB
}

func NewChargingOptimizerHandler(db *database.DB) *ChargingOptimizerHandler {
	return &ChargingOptimizerHandler{db: db}
}

// ── Handler ──────────────────────────────────────────────────

// GetOptimization handles GET /analytics/charging-optimizer?vehicle_id=X
func (h *ChargingOptimizerHandler) GetOptimization(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		writeError(w, http.StatusBadRequest, "vehicle_id is required")
		return
	}
	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	ctx := r.Context()

	rows, err := h.db.Pool.Query(ctx, `
		SELECT id, start_ts,
		       COALESCE(cost, 0),
		       COALESCE(energy_added_kwh, 0),
		       COALESCE(charger_power_kw_max, 0),
		       COALESCE(end_battery_pct, 0),
		       COALESCE(start_battery_pct, 0)
		FROM charging_sessions
		WHERE vehicle_id = $1
		ORDER BY start_ts DESC`, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("charging-optimizer: query failed")
		writeError(w, http.StatusInternalServerError, "failed to get charging data")
		return
	}
	defer rows.Close()

	var sessions []sessionRow
	for rows.Next() {
		var s sessionRow
		if err := rows.Scan(&s.id, &s.startDate, &s.cost, &s.kwh, &s.power,
			&s.endBattery, &s.startBattery); err != nil {
			log.Warn().Err(err).Msg("charging-optimizer: scan session row failed")
			continue
		}
		sessions = append(sessions, s)
	}

	if len(sessions) == 0 {
		writeJSON(w, http.StatusOK, optimizerResponse{
			CurrentSchedule: currentSchedule{},
			CostAnalysis:    costAnalysis{PeakHours: []int{}, OffpeakHours: []int{}},
			Recommendations: []optimizerRec{},
			WeeklyHeatmap:   []heatmapEntry{},
		})
		return
	}

	// Enrich sessions with lat/lon/temp from signal_log (single set-based query)
	locRows, err := h.db.Pool.Query(ctx, `
		SELECT cs.id,
		       lat.value_num AS latitude,
		       lon.value_num AS longitude,
		       temp.value_num AS outside_temp
		FROM charging_sessions cs
		LEFT JOIN LATERAL (
			SELECT value_num FROM signal_log
			WHERE vehicle_id = cs.vehicle_id AND signal = 'Latitude'
			  AND created_at <= cs.start_ts
			ORDER BY created_at DESC LIMIT 1
		) lat ON true
		LEFT JOIN LATERAL (
			SELECT value_num FROM signal_log
			WHERE vehicle_id = cs.vehicle_id AND signal = 'Longitude'
			  AND created_at <= cs.start_ts
			ORDER BY created_at DESC LIMIT 1
		) lon ON true
		LEFT JOIN LATERAL (
			SELECT value_num FROM signal_log
			WHERE vehicle_id = cs.vehicle_id AND signal = 'OutsideTemp'
			  AND created_at <= cs.start_ts
			ORDER BY created_at DESC LIMIT 1
		) temp ON true
		WHERE cs.vehicle_id = $1
		  AND cs.start_ts >= NOW() - INTERVAL '90 days'`, vehicleID)
	if err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("charging-optimizer: signal_log location query failed")
	} else {
		defer locRows.Close()
		locMap := make(map[int64][3]*float64) // id → [lat, lon, temp]
		for locRows.Next() {
			var csID int64
			var lat, lon, temp *float64
			if err := locRows.Scan(&csID, &lat, &lon, &temp); err != nil {
				log.Warn().Err(err).Msg("charging-optimizer: scan location row failed")
				continue
			}
			locMap[csID] = [3]*float64{lat, lon, temp}
		}
		for i := range sessions {
			if vals, ok := locMap[sessions[i].id]; ok {
				if vals[0] != nil && vals[1] != nil {
					sessions[i].lat = *vals[0]
					sessions[i].lon = *vals[1]
				} else {
					log.Debug().Int64("session_id", sessions[i].id).Msg("charging-optimizer: no lat/lon in signal_log, skipping home detection for session")
				}
				if vals[2] != nil {
					sessions[i].outsideTemp = *vals[2]
				}
			}
		}
	}

	schedule := analyzeSchedule(sessions)
	homeLocSessions, homePct := detectHome(sessions)
	schedule.HomeChargingPct = round2(homePct)

	heatmap, ca := analyzeCosts(sessions, homeLocSessions)
	healthScore := computeBatteryHealthScore(sessions)
	recs := buildOptimizerRecommendations(schedule, ca, healthScore, sessions)

	writeJSON(w, http.StatusOK, optimizerResponse{
		CurrentSchedule:    schedule,
		CostAnalysis:       ca,
		BatteryHealthScore: healthScore,
		Recommendations:    recs,
		WeeklyHeatmap:      heatmap,
	})
}
