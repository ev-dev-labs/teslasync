package routeeff

import (
	"context"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

const (
	routeEffMetersPerMile = 1609.344
	routeEffMpsPerMph     = 0.44704
)

// routeEffDataTimeout bounds each analytics read so a stalled connection
// cannot pin the request goroutine longer than the boundary rule allows.
// The pool's server-side statement_timeout is the backstop; this is the
// client-side deadline. A var (not const) so tests can shorten it.
var routeEffDataTimeout = 15 * time.Second

// routeQuerier is the minimal pgx surface the handler needs. Declared
// locally so tests can drive every branch with a fake pgx.Rows source
// without a live database or a vendored pgxmock (mirrors the chargeopt /
// mileage / vehicle-states fake-pool precedent). *pgxpool.Pool satisfies it.
type routeQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// RouteEfficiencyHandler serves route-efficiency analytics.
type RouteEfficiencyHandler struct {
	db routeQuerier
}

// NewRouteEfficiencyHandler wires the handler to the pgx pool. Panics on a
// nil pool — a nil pool is a wiring bug, not a runtime condition, so it
// surfaces at construction rather than as a nil-deref on the first request
// (mirrors chargeopt.newPgxOptimizerRepo).
func NewRouteEfficiencyHandler(db *database.DB) *RouteEfficiencyHandler {
	if db == nil || db.Pool == nil {
		panic("routeeff.NewRouteEfficiencyHandler: db pool must not be nil")
	}
	return &RouteEfficiencyHandler{db: db.Pool}
}

// routeSummary reads from SI-canonical drives columns. Frontend consumers
// convert display units at the render boundary.
type routeSummary struct {
	StartLocation   string  `json:"start_location"`
	EndLocation     string  `json:"end_location"`
	TripCount       int     `json:"trip_count"`
	AvgDistanceKm   float64 `json:"avg_distance_km"`
	AvgDurationS    float64 `json:"avg_duration_s"`
	AvgEfficiency   float64 `json:"avg_efficiency"`
	BestEfficiency  float64 `json:"best_efficiency"`
	WorstEfficiency float64 `json:"worst_efficiency"`
	AvgSpeed        float64 `json:"avg_speed"`
	AvgTemp         float64 `json:"avg_temp"`
}

// routeDriveDetail field tags are SI-suffixed where they used to map to
// legacy columns (duration_s, avg_speed_mps, start_soc_pct, end_soc_pct);
// the frontend RouteDriveDetail type already mismatched the legacy tags so
// this is forward-compatible.
type routeDriveDetail struct {
	ID             int64   `json:"id"`
	StartDate      string  `json:"start_date"`
	Distance       float64 `json:"distance"`
	DurationS      float64 `json:"duration_s"`
	SpeedAvgMps    float64 `json:"avg_speed_mps"`
	StartSocPct    float64 `json:"start_soc_pct"`
	EndSocPct      float64 `json:"end_soc_pct"`
	OutsideTempAvg float64 `json:"outside_temp_avg"`
	Efficiency     float64 `json:"efficiency"`
}

// List returns the top routes grouped by start→end address pair.
// Optional `start` and `end` query params (YYYY-MM-DD) scope the
// underlying drives by `started_at`. When omitted, the route aggregation
// covers the full vehicle history (legacy behavior).
func (h *RouteEfficiencyHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id query parameter required")
		return
	}
	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	startTime, endTime := apiparams.ParseDateRange(r)
	hasRange := !startTime.IsZero() && !endTime.IsZero()

	ctx, cancel := context.WithTimeout(r.Context(), routeEffDataTimeout)
	defer cancel()

	// Drive metrics are SI canonical. When reverse geocoding lags,
	// rounded coordinates keep routes visible instead of silently dropping them
	// from the summary.
	rows, err := h.db.Query(ctx, `
		WITH labeled AS (
		  SELECT
		    COALESCE(NULLIF(start_place, ''),
		             ROUND(start_lat::numeric, 3)::text || ', ' ||
		             ROUND(start_lng::numeric, 3)::text) AS start_label,
		    COALESCE(NULLIF(end_place, ''),
		             ROUND(end_lat::numeric, 3)::text || ', ' ||
		             ROUND(end_lng::numeric, 3)::text) AS end_label,
		    distance_m, duration_s, avg_speed_mps,
		    start_soc_pct, end_soc_pct, ambient_temp_c_avg
		  FROM drives
		  WHERE vehicle_id = $1
		    AND distance_m > $4
		    AND ((start_place IS NOT NULL AND end_place IS NOT NULL)
		         OR (start_lat IS NOT NULL AND start_lng IS NOT NULL
		             AND end_lat IS NOT NULL AND end_lng IS NOT NULL))
		    AND ($5::timestamptz IS NULL OR started_at BETWEEN $5 AND $6)
		)
		SELECT
		  start_label as start_location,
		  end_label as end_location,
		  COUNT(*) as trip_count,
		  AVG(distance_m / 1000.0) as avg_distance_km,
		  AVG(duration_s) as avg_duration_s,
		  AVG(CASE WHEN distance_m > 0
		           THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100
		           ELSE 0 END) as avg_efficiency,
		  MIN(CASE WHEN distance_m > 0
		           THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100
		           ELSE 0 END) as best_efficiency,
		  MAX(CASE WHEN distance_m > 0
		           THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100
		           ELSE 0 END) as worst_efficiency,
		  AVG(avg_speed_mps / $3) as avg_speed,
		  AVG(ambient_temp_c_avg) as avg_temp
		FROM labeled
		GROUP BY start_label, end_label
		HAVING COUNT(*) >= 1
		ORDER BY COUNT(*) DESC
		LIMIT 15`,
		vehicleID, routeEffMetersPerMile, routeEffMpsPerMph, routeEffMetersPerMile,
		apiparams.NullableTime(hasRange, startTime), apiparams.NullableTime(hasRange, endTime))
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("route efficiency: failed to query routes")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query route efficiency")
		return
	}
	defer rows.Close()

	var routes []routeSummary
	for rows.Next() {
		var rs routeSummary
		var avgDist, avgDur, avgEff, bestEff, worstEff, avgSpd, avgTemp *float64
		if err := rows.Scan(&rs.StartLocation, &rs.EndLocation, &rs.TripCount,
			&avgDist, &avgDur, &avgEff, &bestEff, &worstEff, &avgSpd, &avgTemp); err != nil {
			log.Error().Err(err).Msg("route efficiency: scan route row")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to scan route data")
			return
		}
		if avgDist != nil {
			rs.AvgDistanceKm = math.Round(*avgDist*100) / 100
		}
		if avgDur != nil {
			rs.AvgDurationS = math.Round(*avgDur*100) / 100
		}
		if avgEff != nil {
			rs.AvgEfficiency = math.Round(*avgEff*100) / 100
		}
		if bestEff != nil {
			rs.BestEfficiency = math.Round(*bestEff*100) / 100
		}
		if worstEff != nil {
			rs.WorstEfficiency = math.Round(*worstEff*100) / 100
		}
		if avgSpd != nil {
			rs.AvgSpeed = math.Round(*avgSpd*10) / 10
		}
		if avgTemp != nil {
			rs.AvgTemp = math.Round(*avgTemp*10) / 10
		}
		routes = append(routes, rs)
	}
	if err := rows.Err(); err != nil {
		log.Error().Err(err).Msg("route efficiency: routes rows iteration")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read route data")
		return
	}

	if routes == nil {
		routes = []routeSummary{}
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"routes": routes,
	})
}

// Detail returns per-trip details for a specific start→end route.
func (h *RouteEfficiencyHandler) Detail(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id query parameter required")
		return
	}
	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	startAddr := r.URL.Query().Get("start")
	endAddr := r.URL.Query().Get("end")
	if startAddr == "" || endAddr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "start and end query parameters required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), routeEffDataTimeout)
	defer cancel()

	// Match by either the geocoded place name OR the coordinate-fallback
	// label generated by List() so click-through works for routes whose
	// reverse-geocoding hasn't completed yet.
	rows, err := h.db.Query(ctx, `
		WITH labeled AS (
		  SELECT id, started_at, distance_m, duration_s, avg_speed_mps,
		    start_soc_pct, end_soc_pct, ambient_temp_c_avg,
		    COALESCE(NULLIF(start_place, ''),
		             ROUND(start_lat::numeric, 3)::text || ', ' ||
		             ROUND(start_lng::numeric, 3)::text) AS start_label,
		    COALESCE(NULLIF(end_place, ''),
		             ROUND(end_lat::numeric, 3)::text || ', ' ||
		             ROUND(end_lng::numeric, 3)::text) AS end_label
		  FROM drives
		  WHERE vehicle_id = $1
		    AND distance_m > $2
		    AND ((start_place IS NOT NULL AND end_place IS NOT NULL)
		         OR (start_lat IS NOT NULL AND start_lng IS NOT NULL
		             AND end_lat IS NOT NULL AND end_lng IS NOT NULL))
		)
		SELECT id, started_at,
		  distance_m / $2 as distance_mi_calc,
		  duration_s::float8 as duration_s,
		  avg_speed_mps,
		  start_soc_pct::float8, end_soc_pct::float8, ambient_temp_c_avg,
		  CASE WHEN distance_m > 0
		       THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100
		       ELSE 0 END as efficiency
		FROM labeled
		WHERE start_label = $3 AND end_label = $4
		ORDER BY started_at DESC
		LIMIT 20`, vehicleID, routeEffMetersPerMile, startAddr, endAddr)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).
			Str("start", startAddr).Str("end", endAddr).
			Msg("route efficiency: failed to query route detail")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query route detail")
		return
	}
	defer rows.Close()

	var drives []routeDriveDetail
	for rows.Next() {
		var d routeDriveDetail
		var startDate time.Time
		var durationS, spdAvgMps, tempAvg, eff *float64
		var startSoc, endSoc *float64
		if err := rows.Scan(&d.ID, &startDate, &d.Distance, &durationS,
			&spdAvgMps, &startSoc, &endSoc, &tempAvg, &eff); err != nil {
			log.Error().Err(err).Msg("route efficiency: scan detail row")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to scan route detail")
			return
		}
		d.StartDate = startDate.Format(time.RFC3339)
		d.Distance = math.Round(d.Distance*100) / 100
		// duration_s is nullable (an in-progress or partially-computed drive
		// can have distance but no duration yet). Scan through a pointer and
		// default to 0 so a NULL doesn't fail the whole request.
		if durationS != nil {
			d.DurationS = math.Round(*durationS)
		}
		if spdAvgMps != nil {
			d.SpeedAvgMps = math.Round(*spdAvgMps*100) / 100
		}
		if startSoc != nil {
			d.StartSocPct = math.Round(*startSoc*10) / 10
		}
		if endSoc != nil {
			d.EndSocPct = math.Round(*endSoc*10) / 10
		}
		if tempAvg != nil {
			d.OutsideTempAvg = math.Round(*tempAvg*10) / 10
		}
		if eff != nil {
			d.Efficiency = math.Round(*eff*100) / 100
		}
		drives = append(drives, d)
	}
	if err := rows.Err(); err != nil {
		log.Error().Err(err).Msg("route efficiency: detail rows iteration")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read route detail")
		return
	}

	if drives == nil {
		drives = []routeDriveDetail{}
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"drives": drives,
	})
}
