package drives

import (
	"errors"
	"math"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
)

var (
	errMissingVehicleID = errors.New("vehicle_id query parameter required")
	errInvalidVehicleID = errors.New("invalid vehicle_id")
)

func (h *DriveHandler) ListByVehicle(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.drives.list")
	defer span.End()

	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		span.RecordError(errMissingVehicleID)
		writeError(w, http.StatusBadRequest, "vehicle_id query parameter required")
		return
	}

	vehicleID, err := parseInt64(vehicleIDStr)
	if err != nil || vehicleID <= 0 {
		span.RecordError(errInvalidVehicleID)
		writeError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	limit, offset := pagination(r)
	startTime, endTime := parseDateRange(r)
	drives, err := h.driveRepo.GetByVehicle(ctx, vehicleID, limit, offset, startTime, endTime)
	if err != nil {
		span.RecordError(err)
		log.Error().Err(err).Int64("vehicle_id", vehicleID).
			Str("trace_id", span.SpanContext().TraceID().String()).
			Msg("failed to list drives")
		writeError(w, http.StatusInternalServerError, "failed to list drives")
		return
	}
	// Guarantee a JSON array (`[]`) instead of `null` so SPA hooks that
	// call `.map`/`.length` on the response don't crash on empty results.
	if drives == nil {
		drives = []*drivemodel.Drive{}
	}
	apiparams.SetPaginationHeaders(w, limit, offset, len(drives))
	writeJSON(w, http.StatusOK, drives)
}

// Constants used by the SI-canonical drives queries (migration 000185).
// Defined once here so the SQL stays readable.
const (
	driveStatsMetersPerMile  = 1609.344
	driveStatsMpsPerMph      = 0.44704
	driveStatsKilo           = 1000.0
	driveStatsTwoMilesMeters = 2.0 * driveStatsMetersPerMile // ~3218.688 m
	driveStatsSpeedLimitMps  = 130.0 * driveStatsMpsPerMph   // ~58.1152 m/s
)

// Stats returns aggregate driving statistics for a vehicle.
func (h *DriveHandler) Stats(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.drives.stats")
	defer span.End()

	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		span.RecordError(errMissingVehicleID)
		writeError(w, http.StatusBadRequest, "vehicle_id query parameter required")
		return
	}
	vehicleID, err := parseInt64(vehicleIDStr)
	if err != nil || vehicleID <= 0 {
		span.RecordError(errInvalidVehicleID)
		writeError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	reader := h.statsRepo
	if reader == nil {
		reader = h.driveRepo
	}
	stats, err := reader.GetStats(ctx, vehicleID)
	if err != nil {
		span.RecordError(err)
		log.Error().Err(err).Int64("vehicle_id", vehicleID).
			Str("trace_id", span.SpanContext().TraceID().String()).
			Msg("failed to get driving statistics")
		writeError(w, http.StatusInternalServerError, "failed to get driving stats")
		return
	}

	writeJSON(w, http.StatusOK, drivingStatsResponse(stats))
}

func drivingStatsResponse(stats drivedb.DrivingStats) map[string]any {
	// Retain the existing metric response contract; Settings owns rounding.
	return map[string]any{
		"total_drives":         stats.Count,
		"total_distance_km":    stats.DistanceM / 1000,
		"total_duration_s":     stats.DurationS,
		"avg_efficiency_wh_km": scaleNullable(stats.EfficiencyWhPerM, 1000),
		"avg_speed_kmh":        scaleNullable(stats.AvgSpeedMps, 3.6),
		"top_speed_kmh":        scaleNullable(stats.MaxSpeedMps, 3.6),
		"regen_ratio":          stats.RegenRatio,
		"regen_energy_wh":      stats.RegenEnergyWh,
		// Existing net emissions estimate: 70 g/km, not measured emissions.
		"co2_saved_kg": stats.DistanceM * 0.00007,
	}
}

// scaleNullable applies a multiplicative factor to a nullable float pointer.
// Used to convert SI values queried from the drives table into the legacy
// display units the existing JSON response shape exposes.
func scaleNullable(v *float64, factor float64) *float64 {
	if v == nil {
		return nil
	}
	scaled := *v * factor
	return &scaled
}

// Score returns a computed driving score for a vehicle.
func (h *DriveHandler) Score(w http.ResponseWriter, r *http.Request) {
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

	// Aggregate stats for completed drives. SI columns: distance_m,
	// start/end_soc_pct, avg_power_w. Convert power Watts → kW in Go (the
	// downstream Smoothness math expects the prior kW magnitudes).
	var totalDrives int
	var avgWhKm, avgPowerMaxW, avgPowerMinW *float64
	err = h.db.Pool.QueryRow(ctx, `
		SELECT COUNT(*),
		       AVG(CASE WHEN distance_m > $2 AND start_soc_pct IS NOT NULL AND end_soc_pct IS NOT NULL
		            THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $3) * 100 * 0.75
		            ELSE NULL END),
		       MAX(avg_power_w),
		       MIN(avg_power_w)
		FROM drives
		WHERE vehicle_id = $1 AND ended_at IS NOT NULL`,
		vehicleID, driveStatsTwoMilesMeters, driveStatsMetersPerMile,
	).Scan(&totalDrives, &avgWhKm, &avgPowerMaxW, &avgPowerMinW)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("score: failed to query aggregates")
		writeError(w, http.StatusInternalServerError, "failed to compute score")
		return
	}
	avgPowerMax := scaleNullable(avgPowerMaxW, 1.0/driveStatsKilo)
	avgPowerMin := scaleNullable(avgPowerMinW, 1.0/driveStatsKilo)

	if totalDrives == 0 {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"overall":          0,
			"efficiency":       0,
			"smoothness":       0,
			"speed_discipline": 0,
			"grade":            "F",
			"total_drives":     0,
			"trend":            "flat",
		})
		return
	}

	// Speed discipline: fraction of drives with max speed under ~130 mph
	// (SI: max_speed_mps < 130*mpsPerMph m/s).
	var disciplinedCount int
	err = h.db.Pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM drives
		WHERE vehicle_id = $1 AND ended_at IS NOT NULL
		  AND (max_speed_mps IS NULL OR max_speed_mps < $2)`,
		vehicleID, driveStatsSpeedLimitMps,
	).Scan(&disciplinedCount)
	if err != nil {
		log.Error().Err(err).Msg("score: speed discipline query")
		writeError(w, http.StatusInternalServerError, "failed to compute score")
		return
	}

	// Efficiency score: 150 Wh/km = 100, 300+ Wh/km = 0
	efficiency := 0.0
	if avgWhKm != nil && !math.IsNaN(*avgWhKm) {
		v := *avgWhKm
		if v <= 150 {
			efficiency = 100
		} else if v >= 300 {
			efficiency = 0
		} else {
			efficiency = math.Round((1 - (v-150)/150) * 100)
		}
	}

	// Smoothness: lower power spread ratio = smoother driving
	smoothness := 70.0 // default when data unavailable
	if avgPowerMax != nil && avgPowerMin != nil {
		absMax := math.Abs(*avgPowerMax)
		absMin := math.Abs(*avgPowerMin)
		var ratio float64
		if absMin > 0.01 { // epsilon guard — avoid divide-by-zero
			ratio = absMax / absMin
		}
		// ratio near 1 is smooth; ratio > 5 is harsh
		if ratio <= 1 {
			smoothness = 100
		} else if ratio >= 5 {
			smoothness = 0
		} else {
			smoothness = math.Round((1 - (ratio-1)/4) * 100)
		}
	}

	speedDiscipline := math.Round(float64(disciplinedCount) / float64(totalDrives) * 100)
	overall := math.Round(efficiency*0.4 + smoothness*0.3 + speedDiscipline*0.3)

	clamp := func(v float64) float64 {
		if v < 0 {
			return 0
		}
		if v > 100 {
			return 100
		}
		return v
	}
	overall = clamp(overall)
	efficiency = clamp(efficiency)
	smoothness = clamp(smoothness)
	speedDiscipline = clamp(speedDiscipline)

	grade := "F"
	switch {
	case overall > 95:
		grade = "A+"
	case overall > 85:
		grade = "A"
	case overall > 70:
		grade = "B"
	case overall > 55:
		grade = "C"
	case overall > 40:
		grade = "D"
	}

	// Trend compares the last 10 completed drives against the previous 10.
	trend := "flat"
	if totalDrives >= 10 {
		scoreForBatch := func(offset int) float64 {
			var batchWhKm, batchPMaxW, batchPMinW *float64
			var batchTotal, batchDisciplined int
			_ = h.db.Pool.QueryRow(ctx, `
				SELECT COUNT(*),
				       AVG(CASE WHEN distance_m > $3 AND start_soc_pct IS NOT NULL AND end_soc_pct IS NOT NULL
				            THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $4) * 100 * 0.75
				            ELSE NULL END),
				       AVG(avg_power_w),
				       AVG(avg_power_w)
				FROM (SELECT * FROM drives WHERE vehicle_id = $1 AND ended_at IS NOT NULL
				      ORDER BY ended_at DESC LIMIT 10 OFFSET $2) sub`,
				vehicleID, offset, driveStatsTwoMilesMeters, driveStatsMetersPerMile,
			).Scan(&batchTotal, &batchWhKm, &batchPMaxW, &batchPMinW)
			_ = h.db.Pool.QueryRow(ctx, `
				SELECT COUNT(*)
				FROM (SELECT * FROM drives WHERE vehicle_id = $1 AND ended_at IS NOT NULL
				      ORDER BY ended_at DESC LIMIT 10 OFFSET $2) sub
				WHERE max_speed_mps IS NULL OR max_speed_mps < $3`,
				vehicleID, offset, driveStatsSpeedLimitMps,
			).Scan(&batchDisciplined)
			batchPMax := scaleNullable(batchPMaxW, 1.0/driveStatsKilo)
			batchPMin := scaleNullable(batchPMinW, 1.0/driveStatsKilo)

			eff := 50.0
			if batchWhKm != nil && !math.IsNaN(*batchWhKm) {
				v := *batchWhKm
				if v <= 150 {
					eff = 100
				} else if v >= 300 {
					eff = 0
				} else {
					eff = (1 - (v-150)/150) * 100
				}
			}
			sm := 70.0
			if batchPMax != nil && batchPMin != nil && *batchPMin != 0 {
				ratio := math.Abs(*batchPMax / *batchPMin)
				if ratio <= 1 {
					sm = 100
				} else if ratio >= 5 {
					sm = 0
				} else {
					sm = (1 - (ratio-1)/4) * 100
				}
			}
			sd := 50.0
			if batchTotal > 0 {
				sd = float64(batchDisciplined) / float64(batchTotal) * 100
			}
			return clamp(eff*0.4 + sm*0.3 + sd*0.3)
		}

		recentScore := scoreForBatch(0)
		prevScore := scoreForBatch(10)
		diff := recentScore - prevScore
		if diff > 3 {
			trend = "up"
		} else if diff < -3 {
			trend = "down"
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"overall":          overall,
		"efficiency":       efficiency,
		"smoothness":       smoothness,
		"speed_discipline": speedDiscipline,
		"grade":            grade,
		"total_drives":     totalDrives,
		"trend":            trend,
	})
}

// Dynamics returns driving dynamics / G-force approximations for a vehicle.
func (h *DriveHandler) Dynamics(w http.ResponseWriter, r *http.Request) {
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

	// SI columns: max_speed_mps, distance_m, duration_s, avg_power_w.
	// Convert to legacy units (mph, kW) in Go so the downstream G-force math
	// (which uses km/h → m/s and kW → W intermediate steps) keeps the same
	// expression structure and the same numeric answer.
	var totalDrives int
	var maxSpeedMaxMps, avgSpeedMpsRaw, maxPowerMaxW, avgPowerMaxW, avgPowerMinW *float64
	err = h.db.Pool.QueryRow(ctx, `
		SELECT COUNT(*),
		       MAX(max_speed_mps),
		       AVG(CASE WHEN duration_s > 0 THEN distance_m / duration_s ELSE NULL END),
		       MAX(avg_power_w),
		       AVG(avg_power_w),
		       AVG(avg_power_w)
		FROM drives
		WHERE vehicle_id = $1 AND ended_at IS NOT NULL`, vehicleID,
	).Scan(&totalDrives, &maxSpeedMaxMps, &avgSpeedMpsRaw, &maxPowerMaxW, &avgPowerMaxW, &avgPowerMinW)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("dynamics: failed to query")
		writeError(w, http.StatusInternalServerError, "failed to compute dynamics")
		return
	}
	maxSpeedMax := scaleNullable(maxSpeedMaxMps, 1.0/driveStatsMpsPerMph)
	_ = maxSpeedMax // retained as legacy unused symbol; original handler scanned it but never read it
	// avgSpeed is read by safeVal as "km/h"; the prior code computed mph here
	// (mile-distance over hour-duration) and labelled the variable "km/h",
	// a long-standing pre-existing quirk in this handler. Convert m/s → mph
	// to preserve the downstream numeric path bit-for-bit.
	avgSpeed := scaleNullable(avgSpeedMpsRaw, 1.0/driveStatsMpsPerMph)
	maxPowerMax := scaleNullable(maxPowerMaxW, 1.0/driveStatsKilo)
	avgPowerMax := scaleNullable(avgPowerMaxW, 1.0/driveStatsKilo)
	avgPowerMin := scaleNullable(avgPowerMinW, 1.0/driveStatsKilo)

	if totalDrives == 0 {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"max_acceleration_g": 0,
			"max_braking_g":      0,
			"max_cornering_g":    0,
			"avg_acceleration_g": 0,
			"avg_braking_g":      0,
			"smoothness_score":   0,
		})
		return
	}

	const vehicleMassKg = 2000.0
	const gravity = 9.81

	safeVal := func(v *float64, fallback float64) float64 {
		if v == nil || math.IsNaN(*v) || math.IsInf(*v, 0) {
			return fallback
		}
		return *v
	}

	vAvg := safeVal(avgSpeed, 60.0)                 // km/h
	vAvgMs := vAvg * 1000.0 / 3600.0                // m/s
	pMax := safeVal(maxPowerMax, 100.0) * 1000.0    // kW → W
	pAvg := safeVal(avgPowerMax, 50.0) * 1000.0     // kW → W
	pMinAvg := safeVal(avgPowerMin, -30.0) * 1000.0 // kW → W (negative = regen)

	// Estimate acceleration G from power: a = P / (m * v), G = a / 9.81
	maxAccG := 0.0
	avgAccG := 0.0
	if vAvgMs > 1 {
		maxAccG = (pMax / (vehicleMassKg * vAvgMs)) / gravity
		avgAccG = (pAvg / (vehicleMassKg * vAvgMs)) / gravity
	}

	// Braking G from regen power (negative average-power values)
	maxBrakeG := 0.0
	avgBrakeG := 0.0
	if vAvgMs > 1 {
		maxBrakeG = math.Abs(pMinAvg) / (vehicleMassKg * vAvgMs) / gravity
		avgBrakeG = maxBrakeG * 0.6
	}

	// Cornering: approximate as fraction of acceleration
	maxCornerG := maxAccG * 0.4

	// Clamp to reasonable ranges
	clampG := func(v, max float64) float64 {
		v = math.Round(v*100) / 100
		if v < 0 {
			return 0
		}
		if v > max {
			return max
		}
		return v
	}

	maxAccG = clampG(maxAccG, 1.5)
	avgAccG = clampG(avgAccG, 1.0)
	maxBrakeG = clampG(maxBrakeG, 1.5)
	avgBrakeG = clampG(avgBrakeG, 1.0)
	maxCornerG = clampG(maxCornerG, 1.2)

	// Smoothness: lower power variance = smoother
	smoothScore := 70.0
	if avgPowerMax != nil && avgPowerMin != nil && *avgPowerMin != 0 {
		ratio := math.Abs(*avgPowerMax / *avgPowerMin)
		if ratio <= 1 {
			smoothScore = 100
		} else if ratio >= 5 {
			smoothScore = 0
		} else {
			smoothScore = math.Round((1 - (ratio-1)/4) * 100)
		}
	}
	if smoothScore < 0 {
		smoothScore = 0
	}
	if smoothScore > 100 {
		smoothScore = 100
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"max_acceleration_g": maxAccG,
		"max_braking_g":      maxBrakeG,
		"max_cornering_g":    maxCornerG,
		"avg_acceleration_g": avgAccG,
		"avg_braking_g":      avgBrakeG,
		"smoothness_score":   smoothScore,
	})
}

// AccelerationDistribution computes acceleration G readings from consecutive
// VehicleSpeed signals in signal_log for histogram analysis.
func (h *DriveHandler) AccelerationDistribution(w http.ResponseWriter, r *http.Request) {
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

	startTime, endTime := parseDateRange(r)
	if startTime.IsZero() {
		startTime = time.Now().AddDate(0, 0, -30)
	}
	if endTime.IsZero() {
		endTime = time.Now()
	}

	ctx := r.Context()

	rows, err := h.db.Pool.Query(ctx, `
		SELECT ts, COALESCE(float_value, int_value::float8)
		FROM signal_log
		WHERE vehicle_id = $1 AND field = 'VehicleSpeed'
		  AND (float_value IS NOT NULL OR int_value IS NOT NULL)
		  AND ts >= $2 AND ts <= $3
		ORDER BY ts ASC`, vehicleID, startTime, endTime)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("acceleration distribution: query failed")
		writeError(w, http.StatusInternalServerError, "failed to get acceleration distribution")
		return
	}
	defer rows.Close()

	type speedPoint struct {
		ts    time.Time
		speed float64
	}
	var points []speedPoint
	for rows.Next() {
		var p speedPoint
		if err := rows.Scan(&p.ts, &p.speed); err != nil {
			log.Warn().Err(err).Msg("acceleration distribution: scan error")
			continue
		}
		points = append(points, p)
	}
	if err := rows.Err(); err != nil {
		log.Error().Err(err).Msg("acceleration distribution: rows iteration error")
		writeError(w, http.StatusInternalServerError, "failed to read acceleration data")
		return
	}

	// Compute acceleration in G from consecutive speed pairs.
	// For each pair: accel_g = (speed2 - speed1) / dt_seconds / 9.81
	// Only use closely-spaced readings (gap < 10s) to avoid artifacts.
	values := make([]float64, 0, len(points))
	for i := 0; i < len(points)-1; i++ {
		dt := points[i+1].ts.Sub(points[i].ts).Seconds()
		if dt > 0 && dt < 10 {
			dv := points[i+1].speed - points[i].speed
			accelG := dv / dt / 9.81
			accelG = math.Round(accelG*1000) / 1000
			values = append(values, accelG)
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"values": values,
	})
}
