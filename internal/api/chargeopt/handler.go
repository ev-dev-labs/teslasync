package chargeopt

import (
	"net/http"
	"strconv"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/rs/zerolog/log"
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
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required")
		return
	}
	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	ctx := r.Context()

	// Phase-42 (000184_charging_si): SI canonical columns. Convert
	// total_energy_added_wh -> kWh and peak_power_w -> kW at the SQL boundary
	// to keep sessionRow.kwh / .power semantics. cost reads from cost_decimal.
	rows, err := h.db.Pool.Query(ctx, `
		SELECT id, started_at,
		       COALESCE(cost_decimal, 0),
		       COALESCE(total_energy_added_wh, 0) / 1000.0,
		       COALESCE(peak_power_w, 0) / 1000.0,
		       COALESCE(end_soc_pct, 0)::int,
		       COALESCE(start_soc_pct, 0)::int
		FROM charging_sessions
		WHERE vehicle_id = $1
		ORDER BY started_at DESC`, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("charging-optimizer: query failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get charging data")
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
		httpx.WriteJSON(w, http.StatusOK, optimizerResponse{
			CurrentSchedule: currentSchedule{},
			CostAnalysis:    costAnalysis{PeakHours: []int{}, OffpeakHours: []int{}},
			Recommendations: []optimizerRec{},
			WeeklyHeatmap:   []heatmapEntry{},
		})
		return
	}

	// Enrich sessions with lat/lon/temp from signal_log (single set-based query).
	// Phase-42: signal_log canonical schema — `field`, `ts`, and split typed value
	// columns (float_value/int_value/...). Numeric reads use COALESCE so signals
	// stored as int (e.g., temperatures sent as °F whole numbers) still resolve.
	locRows, err := h.db.Pool.Query(ctx, `
		SELECT cs.id,
		       lat.value AS latitude,
		       lon.value AS longitude,
		       temp.value AS outside_temp
		FROM charging_sessions cs
		LEFT JOIN LATERAL (
			SELECT COALESCE(float_value, int_value::float8) AS value FROM signal_log
			WHERE vehicle_id = cs.vehicle_id AND field = 'Latitude'
			  AND ts <= cs.started_at
			ORDER BY ts DESC LIMIT 1
		) lat ON true
		LEFT JOIN LATERAL (
			SELECT COALESCE(float_value, int_value::float8) AS value FROM signal_log
			WHERE vehicle_id = cs.vehicle_id AND field = 'Longitude'
			  AND ts <= cs.started_at
			ORDER BY ts DESC LIMIT 1
		) lon ON true
		LEFT JOIN LATERAL (
			SELECT COALESCE(float_value, int_value::float8) AS value FROM signal_log
			WHERE vehicle_id = cs.vehicle_id AND field = 'OutsideTemp'
			  AND ts <= cs.started_at
			ORDER BY ts DESC LIMIT 1
		) temp ON true
		WHERE cs.vehicle_id = $1
		  AND cs.started_at >= NOW() - INTERVAL '90 days'`, vehicleID)
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

	httpx.WriteJSON(w, http.StatusOK, optimizerResponse{
		CurrentSchedule:    schedule,
		CostAnalysis:       ca,
		BatteryHealthScore: healthScore,
		Recommendations:    recs,
		WeeklyHeatmap:      heatmap,
	})
}
