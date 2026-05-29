package speedprofile

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

const driveStatsMetersPerMile = 1609.344

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
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id query parameter required")
		return
	}
	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	// Optional date bounds via standard ?start=YYYY-MM-DD&end=YYYY-MM-DD
	// When omitted the handler returns the full historical dataset (no
	// trailing-window default). When set the bounds apply uniformly to all
	// three sub-queries below so distribution, categories, and the
	// per-drive scatter all reflect the same window.
	startTime, endTime := apiparams.ParseDateRange(r)
	hasRange := !startTime.IsZero() && !endTime.IsZero()

	ctx := r.Context()

	// Phase-42 SI canonical drives. Speed buckets are expressed in mps
	// (1 mph = 0.44704 mps) so the bucket boundary literals 6.7056, 13.4112,
	// 20.1168, 26.8224, 33.528 correspond to 15/30/45/60/75 mph. avg_power
	// is averaged in Watts.
	var distRows pgx.Rows
	if hasRange {
		distRows, err = h.db.Pool.Query(ctx, `
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
		  AND started_at BETWEEN $2 AND $3
		GROUP BY speed_bucket
		ORDER BY MIN(avg_speed_mps)`, vehicleID, startTime, endTime)
	} else {
		distRows, err = h.db.Pool.Query(ctx, `
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
		GROUP BY speed_bucket
		ORDER BY MIN(avg_speed_mps)`, vehicleID)
	}
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("speed profile: failed to query distribution")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query speed distribution")
		return
	}
	defer distRows.Close()

	var distribution []speedBucket
	for distRows.Next() {
		var b speedBucket
		var avgPowerW *float64
		if err := distRows.Scan(&b.SpeedBucket, &b.Readings, &avgPowerW); err != nil {
			log.Error().Err(err).Msg("speed profile: scan distribution row")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to scan speed distribution")
			return
		}
		if avgPowerW != nil {
			b.AvgPowerW = math.Round(*avgPowerW*100) / 100
		}
		distribution = append(distribution, b)
	}
	if err := distRows.Err(); err != nil {
		log.Error().Err(err).Msg("speed profile: distribution rows iteration")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read speed distribution")
		return
	}

	// Phase-42 SI: avg_speed_mps thresholds for City/Suburban/Highway/HighSpeed
	// (30/60/90 mph -> 13.4112 / 26.8224 / 40.2336 mps). avg_speed reported
	// in km/h via distance_m / duration_s * 3.6 (preserves the previous
	// "speed in metric" semantics returned by the legacy
	// distance/duration formula at the response level).
	var catRows pgx.Rows
	if hasRange {
		catRows, err = h.db.Pool.Query(ctx, `
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
		  AND started_at BETWEEN $4 AND $5
		GROUP BY category`, vehicleID, driveStatsMetersPerMile, driveStatsMetersPerMile, startTime, endTime)
	} else {
		catRows, err = h.db.Pool.Query(ctx, `
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
		GROUP BY category`, vehicleID, driveStatsMetersPerMile, driveStatsMetersPerMile)
	}
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("speed profile: failed to query efficiency categories")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query efficiency categories")
		return
	}
	defer catRows.Close()

	var categories []efficiencyCategory
	for catRows.Next() {
		var c efficiencyCategory
		var avgSpd, batPer *float64
		if err := catRows.Scan(&c.Category, &c.DriveCount, &avgSpd, &batPer); err != nil {
			log.Error().Err(err).Msg("speed profile: scan category row")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to scan efficiency categories")
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
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read efficiency categories")
		return
	}

	// Phase-42 SI: scan distance in meters, return distance in miles to keep
	// the legacy `distance` semantics; avg_speed_mps emitted directly.
	// When start/end are supplied we narrow the scatter window to match
	// the distribution/categories windows so the picker controls all three
	// views uniformly. Otherwise we keep the historical "last 100 drives"
	// behaviour with no time bound.
	var ptRows pgx.Rows
	if hasRange {
		ptRows, err = h.db.Pool.Query(ctx, `
		SELECT avg_speed_mps,
		  distance_m / $2 AS distance_mi_calc,
		  CASE WHEN distance_m > 0
		       THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100
		       ELSE 0 END AS efficiency
		FROM drives
		WHERE vehicle_id = $1 AND distance_m > $3 AND duration_s > 300
		  AND avg_speed_mps IS NOT NULL
		  AND started_at BETWEEN $4 AND $5
		ORDER BY started_at DESC LIMIT 100`, vehicleID, driveStatsMetersPerMile, 5*driveStatsMetersPerMile, startTime, endTime)
	} else {
		ptRows, err = h.db.Pool.Query(ctx, `
		SELECT avg_speed_mps,
		  distance_m / $2 AS distance_mi_calc,
		  CASE WHEN distance_m > 0
		       THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100
		       ELSE 0 END AS efficiency
		FROM drives
		WHERE vehicle_id = $1 AND distance_m > $3 AND duration_s > 300
		  AND avg_speed_mps IS NOT NULL
		ORDER BY started_at DESC LIMIT 100`, vehicleID, driveStatsMetersPerMile, 5*driveStatsMetersPerMile)
	}
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("speed profile: failed to query efficiency points")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query efficiency points")
		return
	}
	defer ptRows.Close()

	var points []efficiencyPoint
	for ptRows.Next() {
		var p efficiencyPoint
		if err := ptRows.Scan(&p.SpeedAvgMps, &p.Distance, &p.Efficiency); err != nil {
			log.Error().Err(err).Msg("speed profile: scan efficiency point")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to scan efficiency points")
			return
		}
		p.SpeedAvgMps = math.Round(p.SpeedAvgMps*100) / 100
		p.Distance = math.Round(p.Distance*100) / 100
		p.Efficiency = math.Round(p.Efficiency*100) / 100
		points = append(points, p)
	}
	if err := ptRows.Err(); err != nil {
		log.Error().Err(err).Msg("speed profile: efficiency points iteration")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read efficiency points")
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

	// Hero-gauge aggregates (avg / peak / optimal). SpeedProfilePage's
	// three RadialGauges read these via toSpeedDisplay = convertSpeedFromSI
	// which expects SI m/s — so we emit SI canonical (_mps) per Phase-48
	// rather than the old _kmh shape (the gauges were unwired entirely
	// before this fix and rendered as 0 mph). Optimal = midpoint of the
	// speed bucket with the lowest mean Wh/km — same six 15-mph buckets
	// the distribution chart uses, mapped to m/s midpoints (7.5/22.5/.../
	// 80 mph × 0.44704). Falls back to JSON null when no qualifying drive
	// has both energy_used_wh AND distance_m > 0.
	var avgMps, peakMps, optimalMps *float64
	heroSQL := `
WITH eligible AS (
  SELECT
    avg_speed_mps,
    max_speed_mps,
    energy_used_wh,
    distance_m,
    CASE
      WHEN avg_speed_mps < 6.7056  THEN 3.3528
      WHEN avg_speed_mps < 13.4112 THEN 10.0584
      WHEN avg_speed_mps < 20.1168 THEN 16.7640
      WHEN avg_speed_mps < 26.8224 THEN 23.4696
      WHEN avg_speed_mps < 33.528  THEN 30.1752
      ELSE 35.7632
    END AS bucket_midpoint_mps
  FROM drives
  WHERE vehicle_id = $1
    AND avg_speed_mps IS NOT NULL AND avg_speed_mps > 0
    %s
)
SELECT
  AVG(avg_speed_mps) AS avg_speed_mps,
  MAX(max_speed_mps) AS peak_speed_mps,
  (
    SELECT bucket_midpoint_mps
    FROM (
      SELECT bucket_midpoint_mps,
             AVG(energy_used_wh / (distance_m / 1000.0)) AS wh_per_km
      FROM eligible
      WHERE distance_m > 0
        AND energy_used_wh IS NOT NULL
        AND energy_used_wh > 0
      GROUP BY bucket_midpoint_mps
      ORDER BY wh_per_km ASC
      LIMIT 1
    ) sub
  ) AS optimal_speed_mps
FROM eligible
`
	var heroErr error
	if hasRange {
		heroErr = h.db.Pool.QueryRow(ctx, fmt.Sprintf(heroSQL, "AND started_at BETWEEN $2 AND $3"), vehicleID, startTime, endTime).
			Scan(&avgMps, &peakMps, &optimalMps)
	} else {
		heroErr = h.db.Pool.QueryRow(ctx, fmt.Sprintf(heroSQL, ""), vehicleID).
			Scan(&avgMps, &peakMps, &optimalMps)
	}
	if heroErr != nil && !errors.Is(heroErr, pgx.ErrNoRows) {
		// Log + degrade to zero rather than 500 the whole payload —
		// distribution/categories/points are already computed and are
		// useful even if the aggregates query fails.
		log.Error().Err(heroErr).Int64("vehicleID", vehicleID).Msg("speed profile: failed to compute hero aggregates")
	}
	avgSpeedMps := 0.0
	if avgMps != nil {
		avgSpeedMps = math.Round(*avgMps*100) / 100
	}
	peakSpeedMps := 0.0
	if peakMps != nil {
		peakSpeedMps = math.Round(*peakMps*100) / 100
	}
	optimalSpeedMps := 0.0
	if optimalMps != nil {
		optimalSpeedMps = math.Round(*optimalMps*100) / 100
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"distribution":      distribution,
		"categories":        categories,
		"points":            points,
		"avg_speed_mps":     avgSpeedMps,
		"peak_speed_mps":    peakSpeedMps,
		"optimal_speed_mps": optimalSpeedMps,
	})
}
