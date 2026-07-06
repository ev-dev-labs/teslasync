package chargeheatmap

import (
	"context"
	"math"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// dbQuerier is the read port ChargingHeatmapHandler depends on: the
// Query + QueryRow subset of database.DBTX that *pgxpool.Pool satisfies
// directly. Depending on this narrow interface (interface segregation)
// rather than the concrete *database.DB keeps the handler unit-testable
// with an in-memory fake — no live Postgres required — while
// NewChargingHeatmapHandler still wires the real pool in production.
type dbQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// ChargingHeatmapHandler serves aggregated charging-pattern analytics.
type ChargingHeatmapHandler struct {
	q dbQuerier
}

func NewChargingHeatmapHandler(db *database.DB) *ChargingHeatmapHandler {
	return &ChargingHeatmapHandler{q: db.Pool}
}

type heatmapCell struct {
	DayOfWeek    int     `json:"day_of_week"`
	HourOfDay    int     `json:"hour_of_day"`
	SessionCount int     `json:"session_count"`
	AvgEnergyWh  float64 `json:"avg_energy_wh"`
	AvgCost      float64 `json:"avg_cost"`
}

type locationBreakdown struct {
	Location  string  `json:"location"`
	Count     int     `json:"count"`
	TotalWh   float64 `json:"total_wh"`
	TotalCost float64 `json:"total_cost"`
	AvgPowerW float64 `json:"avg_power_w"`
}

type chargingSummary struct {
	TotalSessions int     `json:"total_sessions"`
	TotalWh       float64 `json:"total_wh"`
	TotalCost     float64 `json:"total_cost"`
	AvgDurationS  float64 `json:"avg_duration_s"`
}

func (h *ChargingHeatmapHandler) Get(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id query parameter required")
		return
	}
	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	ctx := r.Context()

	// Charging heatmap uses SI canonical energy and power columns; the
	// frontend display boundary formats them with user preferences.
	// Heatmap data: hour of day × day of week
	heatmapRows, err := h.q.Query(ctx, `
		SELECT EXTRACT(DOW FROM started_at)::int  AS day_of_week,
		       EXTRACT(HOUR FROM started_at)::int AS hour_of_day,
		       COUNT(*)                            AS session_count,
		       COALESCE(AVG(total_energy_added_wh), 0) AS avg_energy_wh,
		       COALESCE(AVG(cost_decimal), 0)      AS avg_cost
		FROM charging_sessions
		WHERE vehicle_id = $1
		GROUP BY day_of_week, hour_of_day
		ORDER BY day_of_week, hour_of_day`, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("charging heatmap: failed to query heatmap data")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query heatmap data")
		return
	}
	defer heatmapRows.Close()

	var heatmap []heatmapCell
	for heatmapRows.Next() {
		var c heatmapCell
		if err := heatmapRows.Scan(&c.DayOfWeek, &c.HourOfDay, &c.SessionCount, &c.AvgEnergyWh, &c.AvgCost); err != nil {
			log.Error().Err(err).Msg("charging heatmap: scan heatmap row")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to scan heatmap data")
			return
		}
		c.AvgEnergyWh = math.Round(c.AvgEnergyWh*100) / 100
		c.AvgCost = math.Round(c.AvgCost*100) / 100
		heatmap = append(heatmap, c)
	}
	if err := heatmapRows.Err(); err != nil {
		log.Error().Err(err).Msg("charging heatmap: rows iteration")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read heatmap data")
		return
	}

	// Location breakdown uses the geocoded start_place column captured at
	// session start.
	locRows, err := h.q.Query(ctx, `
		SELECT COALESCE(start_place, 'Unknown')                  AS location,
		       COUNT(*)                                          AS count,
		       COALESCE(SUM(total_energy_added_wh), 0)           AS total_wh,
		       COALESCE(SUM(cost_decimal), 0)                    AS total_cost,
		       COALESCE(AVG(peak_power_w), 0)                    AS avg_power_w
		FROM charging_sessions
		WHERE vehicle_id = $1
		GROUP BY start_place
		ORDER BY count DESC
		LIMIT 10`, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("charging heatmap: failed to query locations")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query location data")
		return
	}
	defer locRows.Close()

	var locations []locationBreakdown
	for locRows.Next() {
		var l locationBreakdown
		if err := locRows.Scan(&l.Location, &l.Count, &l.TotalWh, &l.TotalCost, &l.AvgPowerW); err != nil {
			log.Error().Err(err).Msg("charging heatmap: scan location row")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to scan location data")
			return
		}
		l.TotalWh = math.Round(l.TotalWh*100) / 100
		l.TotalCost = math.Round(l.TotalCost*100) / 100
		l.AvgPowerW = math.Round(l.AvgPowerW*100) / 100
		locations = append(locations, l)
	}
	if err := locRows.Err(); err != nil {
		log.Error().Err(err).Msg("charging heatmap: location rows iteration")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read location data")
		return
	}

	// Summary stats — duration derived from ended_at - started_at since the
	// legacy duration column was dropped by 000184.
	var summary chargingSummary
	err = h.q.QueryRow(ctx, `
		SELECT COUNT(*)                                                                      AS total_sessions,
		       COALESCE(SUM(total_energy_added_wh), 0)                                       AS total_wh,
		       COALESCE(SUM(cost_decimal), 0)                                                AS total_cost,
		       COALESCE(AVG(EXTRACT(EPOCH FROM (ended_at - started_at))), 0)                 AS avg_duration_s
		FROM charging_sessions WHERE vehicle_id = $1`, vehicleID).
		Scan(&summary.TotalSessions, &summary.TotalWh, &summary.TotalCost, &summary.AvgDurationS)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("charging heatmap: failed to query summary")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query summary")
		return
	}
	summary.TotalWh = math.Round(summary.TotalWh*100) / 100
	summary.TotalCost = math.Round(summary.TotalCost*100) / 100
	summary.AvgDurationS = math.Round(summary.AvgDurationS*10) / 10

	if heatmap == nil {
		heatmap = []heatmapCell{}
	}
	if locations == nil {
		locations = []locationBreakdown{}
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"heatmap":   heatmap,
		"locations": locations,
		"summary":   summary,
	})
}
