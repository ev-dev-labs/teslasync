package api

import (
	"math"
	"net/http"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// DriveHandler handles drive-related HTTP requests.
type DriveHandler struct {
	db           *database.DB
	driveRepo    *database.DriveRepo
	posRepo      *database.PositionRepo
	driveTelRepo *database.DriveTelemetryRepo
}

func NewDriveHandler(db *database.DB) *DriveHandler {
	return &DriveHandler{
		db:           db,
		driveRepo:    database.NewDriveRepo(db),
		posRepo:      database.NewPositionRepo(db),
		driveTelRepo: database.NewDriveTelemetryRepo(db),
	}
}

func (h *DriveHandler) ListByVehicle(w http.ResponseWriter, r *http.Request) {
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

	limit, offset := pagination(r)
	startTime, endTime := parseDateRange(r)
	drives, err := h.driveRepo.GetByVehicle(r.Context(), vehicleID, limit, offset, startTime, endTime)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("failed to list drives")
		writeError(w, http.StatusInternalServerError, "failed to list drives")
		return
	}
	writeJSON(w, http.StatusOK, drives)
}

func (h *DriveHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "driveID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	ctx := r.Context()

	drive, err := h.driveRepo.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get drive")
		writeError(w, http.StatusInternalServerError, "failed to get drive")
		return
	}
	if drive == nil {
		writeError(w, http.StatusNotFound, "drive not found")
		return
	}

	// Fetch telemetry readings for this drive
	telemetry, err := h.driveTelRepo.GetByDriveID(ctx, id)
	if err != nil {
		log.Warn().Err(err).Int64("driveID", id).Msg("failed to get drive telemetry")
		telemetry = nil
	}
	if telemetry == nil {
		telemetry = make([]*models.DriveTelemetryReading, 0)
	}

	// Fetch positions for this drive's time range
	var positions []*models.Position
	if drive.EndDate != nil {
		positions, err = h.posRepo.GetByTimeRange(ctx, drive.VehicleID, drive.StartDate, drive.EndDate)
		if err != nil {
			log.Warn().Err(err).Int64("driveID", id).Msg("failed to get drive positions")
		}
	}
	if positions == nil {
		positions = make([]*models.Position, 0)
	}

	// Build response with embedded telemetry and positions
	type driveDetailResponse struct {
		*models.Drive
		Telemetry []*models.DriveTelemetryReading `json:"telemetry"`
		Positions []*models.Position               `json:"positions"`
	}

	writeJSON(w, http.StatusOK, driveDetailResponse{
		Drive:     drive,
		Telemetry: telemetry,
		Positions: positions,
	})
}

func (h *DriveHandler) Positions(w http.ResponseWriter, r *http.Request) {
	driveID, err := urlParamInt64(r, "driveID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	drive, err := h.driveRepo.GetByID(r.Context(), driveID)
	if err != nil {
		log.Error().Err(err).Int64("id", driveID).Msg("failed to get drive")
		writeError(w, http.StatusInternalServerError, "failed to get drive")
		return
	}
	if drive == nil {
		writeError(w, http.StatusNotFound, "drive not found")
		return
	}

	positions, err := h.posRepo.GetByTimeRange(r.Context(), drive.VehicleID, drive.StartDate, drive.EndDate)
	if err != nil {
		log.Error().Err(err).Msg("failed to get drive positions")
		writeError(w, http.StatusInternalServerError, "failed to get positions")
		return
	}
	if positions == nil {
		positions = make([]*models.Position, 0)
	}
	writeJSON(w, http.StatusOK, positions)
}

func (h *DriveHandler) TelemetryReadings(w http.ResponseWriter, r *http.Request) {
	driveID, err := urlParamInt64(r, "driveID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	readings, err := h.driveTelRepo.GetByDriveID(r.Context(), driveID)
	if err != nil {
		log.Error().Err(err).Int64("id", driveID).Msg("failed to get drive telemetry")
		writeError(w, http.StatusInternalServerError, "failed to get drive telemetry")
		return
	}
	if readings == nil {
		readings = make([]*models.DriveTelemetryReading, 0)
	}
	writeJSON(w, http.StatusOK, readings)
}

// Stats returns aggregate driving statistics for a vehicle.
func (h *DriveHandler) Stats(w http.ResponseWriter, r *http.Request) {
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

	var totalDrives int
	var totalDistKm, totalDurMin, avgSpeedKmh, topSpeedKmh *float64
	err = h.db.Pool.QueryRow(ctx, `
		SELECT COUNT(*),
		       SUM(distance),
		       SUM(duration_min),
		       AVG(CASE WHEN duration_min > 0 THEN distance / (duration_min / 60) ELSE NULL END),
		       MAX(speed_max)
		FROM drives
		WHERE vehicle_id = $1 AND end_date IS NOT NULL`, vehicleID,
	).Scan(&totalDrives, &totalDistKm, &totalDurMin, &avgSpeedKmh, &topSpeedKmh)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("drive stats: failed to query")
		writeError(w, http.StatusInternalServerError, "failed to get driving stats")
		return
	}

	// Efficiency: battery % used per 100 km → approximate Wh/km
	var avgEfficiency *float64
	err = h.db.Pool.QueryRow(ctx, `
		SELECT AVG(
			CASE WHEN distance > 2 AND start_battery_level IS NOT NULL AND end_battery_level IS NOT NULL
			THEN (start_battery_level - end_battery_level)::float / distance * 100 * 0.75
			ELSE NULL END
		)
		FROM drives
		WHERE vehicle_id = $1 AND end_date IS NOT NULL`, vehicleID,
	).Scan(&avgEfficiency)
	if err != nil {
		log.Debug().Err(err).Msg("drive stats: efficiency query")
	}

	// Regen: estimate from negative power readings
	var totalRegenKwh *float64
	err = h.db.Pool.QueryRow(ctx, `
		SELECT SUM(CASE WHEN power_min IS NOT NULL AND power_min < 0
		           THEN ABS(power_min) * duration_min / 60 ELSE 0 END)
		FROM drives
		WHERE vehicle_id = $1 AND end_date IS NOT NULL`, vehicleID,
	).Scan(&totalRegenKwh)
	if err != nil {
		log.Debug().Err(err).Msg("drive stats: regen query")
	}

	sf := func(v *float64) float64 {
		if v == nil {
			return 0
		}
		if math.IsNaN(*v) || math.IsInf(*v, 0) {
			return 0
		}
		return math.Round(*v*100) / 100
	}

	totalDist := sf(totalDistKm)
	regenKwh := sf(totalRegenKwh)

	// CO2 saved: ~120g CO2/km for an average ICE car, minus ~50g/km for EV
	co2SavedKg := totalDist * 0.070 // net 70g/km saved

	// Regen ratio (fraction of energy recovered)
	regenRatio := 0.0
	if totalDist > 0 {
		// Approximate total energy used: ~150 Wh/km average
		totalEnergyKwh := totalDist * 0.15
		if totalEnergyKwh > 0 {
			regenRatio = regenKwh / totalEnergyKwh
			if regenRatio > 1 {
				regenRatio = 1
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"total_drives":        totalDrives,
		"total_distance_km":   math.Round(totalDist*100) / 100,
		"total_duration_min":  sf(totalDurMin),
		"avg_efficiency_wh_km": sf(avgEfficiency),
		"avg_speed_kmh":       sf(avgSpeedKmh),
		"top_speed_kmh":       sf(topSpeedKmh),
		"regen_ratio":         math.Round(regenRatio*1000) / 1000,
		"total_regen_kwh":     math.Round(regenKwh*100) / 100,
		"co2_saved_kg":        math.Round(co2SavedKg*100) / 100,
	})
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

	// Aggregate stats for completed drives
	var totalDrives int
	var avgWhKm, avgPowerMax, avgPowerMin *float64
	err = h.db.Pool.QueryRow(ctx, `
		SELECT COUNT(*),
		       AVG(CASE WHEN distance > 2 AND start_battery_level IS NOT NULL AND end_battery_level IS NOT NULL
		            THEN (start_battery_level - end_battery_level)::float / distance * 100 * 0.75
		            ELSE NULL END),
		       AVG(power_max),
		       AVG(power_min)
		FROM drives
		WHERE vehicle_id = $1 AND end_date IS NOT NULL`, vehicleID,
	).Scan(&totalDrives, &avgWhKm, &avgPowerMax, &avgPowerMin)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("score: failed to query aggregates")
		writeError(w, http.StatusInternalServerError, "failed to compute score")
		return
	}

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

	// Speed discipline: fraction of drives where speed_max < 130
	var disciplinedCount int
	err = h.db.Pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM drives
		WHERE vehicle_id = $1 AND end_date IS NOT NULL
		  AND (speed_max IS NULL OR speed_max < 130)`, vehicleID,
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

	// Smoothness: lower power_max/abs(power_min) ratio = smoother
	smoothness := 70.0 // default
	if avgPowerMax != nil && avgPowerMin != nil && *avgPowerMin != 0 {
		ratio := math.Abs(*avgPowerMax / *avgPowerMin)
		// ratio near 1 is smooth; ratio > 5 is harsh
		if ratio <= 1 {
			smoothness = 100
		} else if ratio >= 5 {
			smoothness = 0
		} else {
			smoothness = math.Round((1 - (ratio-1)/4) * 100)
		}
	}

	// Speed discipline score
	speedDiscipline := math.Round(float64(disciplinedCount) / float64(totalDrives) * 100)

	// Overall weighted average
	overall := math.Round(efficiency*0.4 + smoothness*0.3 + speedDiscipline*0.3)

	// Clamp scores to 0-100
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

	// Grade
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

	// Trend: compare last 10 vs previous 10 drives
	trend := "flat"
	if totalDrives >= 10 {
		scoreForBatch := func(offset int) float64 {
			var batchWhKm, batchPMax, batchPMin *float64
			var batchTotal, batchDisciplined int
			_ = h.db.Pool.QueryRow(ctx, `
				SELECT COUNT(*),
				       AVG(CASE WHEN distance > 2 AND start_battery_level IS NOT NULL AND end_battery_level IS NOT NULL
				            THEN (start_battery_level - end_battery_level)::float / distance * 100 * 0.75
				            ELSE NULL END),
				       AVG(power_max),
				       AVG(power_min)
				FROM (SELECT * FROM drives WHERE vehicle_id = $1 AND end_date IS NOT NULL
				      ORDER BY end_date DESC LIMIT 10 OFFSET $2) sub`, vehicleID, offset,
			).Scan(&batchTotal, &batchWhKm, &batchPMax, &batchPMin)
			_ = h.db.Pool.QueryRow(ctx, `
				SELECT COUNT(*)
				FROM (SELECT * FROM drives WHERE vehicle_id = $1 AND end_date IS NOT NULL
				      ORDER BY end_date DESC LIMIT 10 OFFSET $2) sub
				WHERE speed_max IS NULL OR speed_max < 130`, vehicleID, offset,
			).Scan(&batchDisciplined)

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

	// Derive approximations from drive stats
	var totalDrives int
	var maxSpeedMax, avgSpeed, maxPowerMax, avgPowerMax, avgPowerMin *float64
	err = h.db.Pool.QueryRow(ctx, `
		SELECT COUNT(*),
		       MAX(speed_max),
		       AVG(CASE WHEN duration_min > 0 THEN distance / (duration_min / 60) ELSE NULL END),
		       MAX(power_max),
		       AVG(power_max),
		       AVG(power_min)
		FROM drives
		WHERE vehicle_id = $1 AND end_date IS NOT NULL`, vehicleID,
	).Scan(&totalDrives, &maxSpeedMax, &avgSpeed, &maxPowerMax, &avgPowerMax, &avgPowerMin)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("dynamics: failed to query")
		writeError(w, http.StatusInternalServerError, "failed to compute dynamics")
		return
	}

	if totalDrives == 0 {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"max_acceleration_g": 0,
			"max_braking_g":     0,
			"max_cornering_g":   0,
			"avg_acceleration_g": 0,
			"avg_braking_g":     0,
			"smoothness_score":  0,
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

	vAvg := safeVal(avgSpeed, 60.0)              // km/h
	vAvgMs := vAvg * 1000.0 / 3600.0             // m/s
	pMax := safeVal(maxPowerMax, 100.0) * 1000.0  // kW → W
	pAvg := safeVal(avgPowerMax, 50.0) * 1000.0   // kW → W
	pMinAvg := safeVal(avgPowerMin, -30.0) * 1000.0 // kW → W (negative = regen)

	// Estimate acceleration G from power: a = P / (m * v), G = a / 9.81
	maxAccG := 0.0
	avgAccG := 0.0
	if vAvgMs > 1 {
		maxAccG = (pMax / (vehicleMassKg * vAvgMs)) / gravity
		avgAccG = (pAvg / (vehicleMassKg * vAvgMs)) / gravity
	}

	// Braking G from regen power (negative power_min)
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
		"max_braking_g":     maxBrakeG,
		"max_cornering_g":   maxCornerG,
		"avg_acceleration_g": avgAccG,
		"avg_braking_g":     avgBrakeG,
		"smoothness_score":  smoothScore,
	})
}
