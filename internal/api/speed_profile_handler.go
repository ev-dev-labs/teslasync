package api

import (
	"math"
	"net/http"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// SpeedProfileHandler serves speed-distribution and efficiency analytics.
type SpeedProfileHandler struct {
	db *database.DB
}

func NewSpeedProfileHandler(db *database.DB) *SpeedProfileHandler {
	return &SpeedProfileHandler{db: db}
}

// speedBucket fields are SI-canonical per phase-42 migration 000185
// (avg_power averaged in Watts at the SQL boundary). The frontend SpeedBucket
// type currently reads the legacy kilowatt key; consumers will migrate to
// avg_power_w in a follow-up frontend prompt — the typed widget falls back
// to 0 in the interim, which is the documented graceful-degradation path.
type speedBucket struct {
	SpeedBucket string  `json:"speed_bucket"`
	Readings    int     `json:"readings"`
	AvgPowerW   float64 `json:"avg_power_w"`
}

type efficiencyCategory struct {
	Category        string  `json:"category"`
	DriveCount      int     `json:"drive_count"`
	AvgSpeed        float64 `json:"avg_speed"`
	BatteryPer100km float64 `json:"battery_pct_per_100km"`
}

// efficiencyPoint emits avg_speed_mps (SI) — frontend EfficiencyPoint already
// reads `speed_avg`, so the legacy backend mph tag never matched and the
// rename cleanly aligns naming with the SI source.
type efficiencyPoint struct {
	SpeedAvgMps float64 `json:"avg_speed_mps"`
	Distance    float64 `json:"distance"`
	Efficiency  float64 `json:"efficiency"`
}

func (h *SpeedProfileHandler) Get(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		writeError(w, http.StatusBadRequest, "vehicle_id query parameter required")
		return
	}
	vehicleID, err := parseInt64(vehicleIDStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	ctx := r.Context()

	// Phase-42 SI canonical drives. Speed buckets are expressed in mps
	// (1 mph = 0.44704 mps) so the bucket boundary literals 6.7056, 13.4112,
	// 20.1168, 26.8224, 33.528 correspond to 15/30/45/60/75 mph. avg_power
	// is averaged in Watts.
	distRows, err := h.db.Pool.Query(ctx, `
		SELECT
		  CASE
		    WHEN avg_speed_mps < 6.7056  THEN '0-15'
		    WHEN avg_speed_mps < 13.4112 THEN '15-30'
		    WHEN avg_speed_mps < 20.1168 THEN '30-45'
		    WHEN avg_speed_mps < 26.8224 THEN '45-60'
		    WHEN avg_speed_mps < 33.528  THEN '60-75'
		    ELSE '75+'
		  END AS speed_bucket,
		  COUNT(*) AS readings,
		  AVG(avg_power_w) AS avg_power_w
		FROM drives
		WHERE vehicle_id = $1
		  AND avg_speed_mps IS NOT NULL AND avg_speed_mps > 0
		  AND started_at > NOW() - INTERVAL '30 days'
		GROUP BY speed_bucket
		ORDER BY MIN(avg_speed_mps)`, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("speed profile: failed to query distribution")
		writeError(w, http.StatusInternalServerError, "failed to query speed distribution")
		return
	}
	defer distRows.Close()

	var distribution []speedBucket
	for distRows.Next() {
		var b speedBucket
		var avgPowerW *float64
		if err := distRows.Scan(&b.SpeedBucket, &b.Readings, &avgPowerW); err != nil {
			log.Error().Err(err).Msg("speed profile: scan distribution row")
			writeError(w, http.StatusInternalServerError, "failed to scan speed distribution")
			return
		}
		if avgPowerW != nil {
			b.AvgPowerW = math.Round(*avgPowerW*100) / 100
		}
		distribution = append(distribution, b)
	}
	if err := distRows.Err(); err != nil {
		log.Error().Err(err).Msg("speed profile: distribution rows iteration")
		writeError(w, http.StatusInternalServerError, "failed to read speed distribution")
		return
	}

	// Phase-42 SI: avg_speed_mps thresholds for City/Suburban/Highway/HighSpeed
	// (30/60/90 mph -> 13.4112 / 26.8224 / 40.2336 mps). avg_speed reported
	// in km/h via distance_m / duration_s * 3.6 (preserves the previous
	// "speed in metric" semantics returned by the legacy
	// distance/duration formula at the response level).
	catRows, err := h.db.Pool.Query(ctx, `
		SELECT
		  CASE
		    WHEN avg_speed_mps < 13.4112 THEN 'City (<30)'
		    WHEN avg_speed_mps < 26.8224 THEN 'Suburban (30-60)'
		    WHEN avg_speed_mps < 40.2336 THEN 'Highway (60-90)'
		    ELSE 'High Speed (90+)'
		  END AS category,
		  COUNT(*) AS drive_count,
		  AVG(distance_m / NULLIF(duration_s, 0) * 3.6) AS avg_speed_kmh,
		  AVG(CASE WHEN distance_m > 0
		           THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100
		           ELSE 0 END) AS battery_pct_per_100km
		FROM drives
		WHERE vehicle_id = $1 AND distance_m > $3 AND duration_s > 60
		  AND started_at > NOW() - interval '90 days'
		GROUP BY category`, vehicleID, driveStatsMetersPerMile, driveStatsMetersPerMile)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("speed profile: failed to query efficiency categories")
		writeError(w, http.StatusInternalServerError, "failed to query efficiency categories")
		return
	}
	defer catRows.Close()

	var categories []efficiencyCategory
	for catRows.Next() {
		var c efficiencyCategory
		var avgSpd, batPer *float64
		if err := catRows.Scan(&c.Category, &c.DriveCount, &avgSpd, &batPer); err != nil {
			log.Error().Err(err).Msg("speed profile: scan category row")
			writeError(w, http.StatusInternalServerError, "failed to scan efficiency categories")
			return
		}
		if avgSpd != nil {
			c.AvgSpeed = math.Round(*avgSpd*10) / 10
		}
		if batPer != nil {
			c.BatteryPer100km = math.Round(*batPer*100) / 100
		}
		categories = append(categories, c)
	}
	if err := catRows.Err(); err != nil {
		log.Error().Err(err).Msg("speed profile: category rows iteration")
		writeError(w, http.StatusInternalServerError, "failed to read efficiency categories")
		return
	}

	// Phase-42 SI: scan distance in meters, return distance in miles to keep
	// the legacy `distance` semantics; avg_speed_mps emitted directly.
	ptRows, err := h.db.Pool.Query(ctx, `
		SELECT avg_speed_mps,
		  distance_m / $2 AS distance_mi_calc,
		  CASE WHEN distance_m > 0
		       THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100
		       ELSE 0 END AS efficiency
		FROM drives
		WHERE vehicle_id = $1 AND distance_m > $3 AND duration_s > 300
		  AND avg_speed_mps IS NOT NULL
		ORDER BY started_at DESC LIMIT 100`, vehicleID, driveStatsMetersPerMile, 5*driveStatsMetersPerMile)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("speed profile: failed to query efficiency points")
		writeError(w, http.StatusInternalServerError, "failed to query efficiency points")
		return
	}
	defer ptRows.Close()

	var points []efficiencyPoint
	for ptRows.Next() {
		var p efficiencyPoint
		if err := ptRows.Scan(&p.SpeedAvgMps, &p.Distance, &p.Efficiency); err != nil {
			log.Error().Err(err).Msg("speed profile: scan efficiency point")
			writeError(w, http.StatusInternalServerError, "failed to scan efficiency points")
			return
		}
		p.SpeedAvgMps = math.Round(p.SpeedAvgMps*100) / 100
		p.Distance = math.Round(p.Distance*100) / 100
		p.Efficiency = math.Round(p.Efficiency*100) / 100
		points = append(points, p)
	}
	if err := ptRows.Err(); err != nil {
		log.Error().Err(err).Msg("speed profile: efficiency points iteration")
		writeError(w, http.StatusInternalServerError, "failed to read efficiency points")
		return
	}

	if distribution == nil {
		distribution = []speedBucket{}
	}
	if categories == nil {
		categories = []efficiencyCategory{}
	}
	if points == nil {
		points = []efficiencyPoint{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"distribution": distribution,
		"categories":   categories,
		"points":       points,
	})
}
