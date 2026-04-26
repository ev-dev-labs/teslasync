package api

import (
	"context"
	"math"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// DriveHandler handles drive-related HTTP requests.
type DriveHandler struct {
	db              *database.DB
	driveRepo       *database.DriveRepo
	posRepo         *database.PositionRepo
	signalLogReader *database.SignalLogReader
	redisCache      *signal.RedisSignalCache
}

func NewDriveHandler(db *database.DB) *DriveHandler {
	return &DriveHandler{
		db:              db,
		driveRepo:       database.NewDriveRepo(db),
		posRepo:         database.NewPositionRepo(db),
		signalLogReader: database.NewSignalLogReader(db),
	}
}

// WithRedisCache sets the Redis signal cache for computing live in-progress drive values.
func (h *DriveHandler) WithRedisCache(cache *signal.RedisSignalCache) *DriveHandler {
	h.redisCache = cache
	return h
}

// Drive telemetry signal → JSON field mappings (field names match the old
// DriveTelemetryReading JSON tags so the frontend contract is unchanged).
var driveTelemetryMappings = []database.PivotMapping{
	{Signal: "VehicleSpeed", Field: "speed"},
	{Signal: "PackCurrent", Field: "pack_current"},
	{Signal: "PackVoltage", Field: "pack_voltage"},
	{Signal: "BatteryLevel", Field: "battery_level"},
	{Signal: "Elevation", Field: "elevation"},
	{Signal: "InsideTemp", Field: "inside_temp"},
	{Signal: "OutsideTemp", Field: "outside_temp"},
	{Signal: "TpmsPressureFl", Field: "tire_pressure_fl"},
	{Signal: "TpmsPressureFr", Field: "tire_pressure_fr"},
	{Signal: "TpmsPressureRl", Field: "tire_pressure_rl"},
	{Signal: "TpmsPressureRr", Field: "tire_pressure_rr"},
	{Signal: "Latitude", Field: "latitude"},
	{Signal: "Longitude", Field: "longitude"},
}

// Position signal → JSON field mappings (field names match Position model tags).
var positionMappings = []database.PivotMapping{
	{Signal: "Latitude", Field: "latitude"},
	{Signal: "Longitude", Field: "longitude"},
	{Signal: "GpsHeading", Field: "heading"},
	{Signal: "VehicleSpeed", Field: "speed_mph"},
	{Signal: "Elevation", Field: "elevation_m"},
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

	live := false
	endTs := time.Now().UTC()
	if drive.EndTs != nil {
		endTs = *drive.EndTs
	} else {
		// In-progress drive — compute live values from signal snapshots
		live = true
		h.enrichLiveDrive(ctx, drive, endTs)
	}

	// Telemetry from signal_log via pivot
	telemetry, err := h.signalLogReader.SignalTracePivotFlat(ctx,
		drive.VehicleID, driveTelemetryMappings, drive.StartTs, endTs)
	if err != nil {
		log.Warn().Err(err).Int64("driveID", id).Msg("failed to get drive telemetry from signal_log")
		telemetry = []map[string]interface{}{}
	}
	// Rename "ts" → "created_at" to match old DriveTelemetryReading JSON shape
	for _, row := range telemetry {
		if ts, ok := row["ts"]; ok {
			row["created_at"] = ts
			delete(row, "ts")
		}
	}

	// Positions from signal_log via pivot
	positions, err := h.signalLogReader.SignalTracePivotFlat(ctx,
		drive.VehicleID, positionMappings, drive.StartTs, endTs)
	if err != nil {
		log.Warn().Err(err).Int64("driveID", id).Msg("failed to get drive positions from signal_log")
		positions = []map[string]interface{}{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"id":                 drive.ID,
		"vehicle_id":         drive.VehicleID,
		"start_ts":           drive.StartTs,
		"end_ts":             drive.EndTs,
		"duration_min":       drive.DurationMin,
		"distance_mi":        drive.DistanceMi,
		"start_address":      drive.StartAddress,
		"end_address":        drive.EndAddress,
		"start_lat":          drive.StartLat,
		"start_lon":          drive.StartLon,
		"end_lat":            drive.EndLat,
		"end_lon":            drive.EndLon,
		"start_battery_pct":  drive.StartBatteryPct,
		"end_battery_pct":    drive.EndBatteryPct,
		"energy_used_kwh":    drive.EnergyUsedKwh,
		"regen_kwh":          drive.RegenKwh,
		"avg_speed_mph":      drive.AvgSpeedMph,
		"max_speed_mph":      drive.MaxSpeedMph,
		"avg_power_kw":       drive.AvgPowerKw,
		"outside_temp_avg_c": drive.OutsideTempAvgC,
		"inside_temp_avg_c":  drive.InsideTempAvgC,
		"score":              drive.Score,
		"ended_status":       drive.EndedStatus,
		"created_at":         drive.CreatedAt,
		"live":               live,
		"telemetry":          telemetry,
		"positions":          positions,
	})
}

// enrichLiveDrive computes live values for an in-progress drive by reading
// start-of-drive state from signal_log and current state from Redis (with
// signal_log fallback). The drive struct is mutated in place.
func (h *DriveHandler) enrichLiveDrive(ctx context.Context, drive *models.Drive, now time.Time) {
	startSnap, err := h.signalLogReader.SnapshotAt(ctx, drive.VehicleID, drive.StartTs)
	if err != nil {
		log.Warn().Err(err).Int64("driveID", drive.ID).Msg("live drive: failed to get start snapshot")
		startSnap = map[string]interface{}{}
	}

	currentSnap := h.currentSignals(ctx, drive.VehicleID)

	// Duration — always computable from wall clock
	durationMin := now.Sub(drive.StartTs).Minutes()
	drive.DurationMin = safeFloat(durationMin)

	// Distance from odometer delta
	startOdo, startOdoOk := signalFloat(startSnap, "Odometer")
	currentOdo, currentOdoOk := signalFloat(currentSnap, "Odometer")
	if startOdoOk && currentOdoOk && currentOdo > startOdo {
		drive.DistanceMi = safeFloat(currentOdo - startOdo)
	}

	// Battery levels
	if startBat, ok := signalFloat(startSnap, "BatteryLevel"); ok {
		v := int16(startBat)
		drive.StartBatteryPct = &v
	}
	if currentBat, ok := signalFloat(currentSnap, "BatteryLevel"); ok {
		v := int16(currentBat)
		drive.EndBatteryPct = &v
	}

	// Average speed (distance / hours)
	if drive.DistanceMi > 0 && durationMin > 0 {
		avgSpeed := safeFloat(drive.DistanceMi / (durationMin / 60.0))
		drive.AvgSpeedMph = &avgSpeed
	}

	// Current speed as max (best approximation during live drive)
	if currentSpeed, ok := signalFloat(currentSnap, "VehicleSpeed"); ok {
		if drive.MaxSpeedMph == nil || currentSpeed > *drive.MaxSpeedMph {
			v := safeFloat(currentSpeed)
			drive.MaxSpeedMph = &v
		}
	}

	// Current position as end position
	if lat, ok := signalFloat(currentSnap, "Latitude"); ok {
		drive.EndLat = &lat
	}
	if lon, ok := signalFloat(currentSnap, "Longitude"); ok {
		drive.EndLon = &lon
	}

	// Power
	if voltage, vOk := signalFloat(currentSnap, "PackVoltage"); vOk {
		if current, cOk := signalFloat(currentSnap, "PackCurrent"); cOk {
			power := safeFloat(voltage * current / 1000.0)
			drive.AvgPowerKw = &power
		}
	}

	// Temps
	if outside, ok := signalFloat(currentSnap, "OutsideTemp"); ok {
		drive.OutsideTempAvgC = &outside
	}
	if inside, ok := signalFloat(currentSnap, "InsideTemp"); ok {
		drive.InsideTempAvgC = &inside
	}
}

// currentSignals returns the latest signal values for a vehicle, preferring
// Redis (sub-ms) with signal_log SnapshotAt(now) as fallback.
func (h *DriveHandler) currentSignals(ctx context.Context, vehicleID int64) map[string]interface{} {
	if h.redisCache != nil {
		snap, err := h.redisCache.GetAll(ctx, vehicleID)
		if err == nil && snap != nil {
			return snap
		}
		log.Debug().Err(err).Int64("vehicleID", vehicleID).Msg("live drive: Redis unavailable, falling back to signal_log")
	}
	snap, err := h.signalLogReader.SnapshotAt(ctx, vehicleID, time.Now().UTC())
	if err != nil {
		log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("live drive: failed to get current snapshot from signal_log")
		return map[string]interface{}{}
	}
	return snap
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

	endTs := time.Now()
	if drive.EndTs != nil {
		endTs = *drive.EndTs
	}

	rows, err := h.signalLogReader.SignalTracePivotFlat(r.Context(),
		drive.VehicleID, positionMappings, drive.StartTs, endTs)
	if err != nil {
		log.Error().Err(err).Int64("driveID", driveID).Msg("failed to get drive positions from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get positions")
		return
	}
	if rows == nil {
		rows = []map[string]interface{}{}
	}
	writeJSON(w, http.StatusOK, rows)
}

func (h *DriveHandler) TelemetryReadings(w http.ResponseWriter, r *http.Request) {
	driveID, err := urlParamInt64(r, "driveID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	drive, err := h.driveRepo.GetByID(r.Context(), driveID)
	if err != nil {
		log.Error().Err(err).Int64("id", driveID).Msg("failed to get drive for telemetry")
		writeError(w, http.StatusInternalServerError, "failed to get drive")
		return
	}
	if drive == nil {
		writeError(w, http.StatusNotFound, "drive not found")
		return
	}

	endTs := time.Now()
	if drive.EndTs != nil {
		endTs = *drive.EndTs
	}

	rows, err := h.signalLogReader.SignalTracePivotFlat(r.Context(),
		drive.VehicleID, driveTelemetryMappings, drive.StartTs, endTs)
	if err != nil {
		log.Error().Err(err).Int64("driveID", driveID).Msg("failed to get telemetry from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get telemetry")
		return
	}
	if rows == nil {
		rows = []map[string]interface{}{}
	}
	// Rename "ts" → "created_at" to match old DriveTelemetryReading JSON shape
	for _, row := range rows {
		if ts, ok := row["ts"]; ok {
			row["created_at"] = ts
			delete(row, "ts")
		}
	}
	writeJSON(w, http.StatusOK, rows)
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
		       SUM(distance_mi),
		       SUM(duration_min),
		       AVG(CASE WHEN duration_min > 0 THEN distance_mi / (duration_min / 60) ELSE NULL END),
		       MAX(max_speed_mph)
		FROM drives
		WHERE vehicle_id = $1 AND end_ts IS NOT NULL`, vehicleID,
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
			CASE WHEN distance_mi > 2 AND start_battery_pct IS NOT NULL AND end_battery_pct IS NOT NULL
			THEN (start_battery_pct - end_battery_pct)::float / distance_mi * 100 * 0.75
			ELSE NULL END
		)
		FROM drives
		WHERE vehicle_id = $1 AND end_ts IS NOT NULL`, vehicleID,
	).Scan(&avgEfficiency)
	if err != nil {
		log.Debug().Err(err).Msg("drive stats: efficiency query")
	}

	// Regen: estimate from negative power readings
	var totalRegenKwh *float64
	err = h.db.Pool.QueryRow(ctx, `
		SELECT SUM(CASE WHEN avg_power_kw IS NOT NULL AND avg_power_kw < 0
		           THEN ABS(avg_power_kw) * duration_min / 60 ELSE 0 END)
		FROM drives
		WHERE vehicle_id = $1 AND end_ts IS NOT NULL`, vehicleID,
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
		       AVG(CASE WHEN distance_mi > 2 AND start_battery_pct IS NOT NULL AND end_battery_pct IS NOT NULL
		            THEN (start_battery_pct - end_battery_pct)::float / distance_mi * 100 * 0.75
		            ELSE NULL END),
		       MAX(avg_power_kw),
		       MIN(avg_power_kw)
		FROM drives
		WHERE vehicle_id = $1 AND end_ts IS NOT NULL`, vehicleID,
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

	// Speed discipline: fraction of drives where max_speed_mph < 130
	var disciplinedCount int
	err = h.db.Pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM drives
		WHERE vehicle_id = $1 AND end_ts IS NOT NULL
		  AND (max_speed_mph IS NULL OR max_speed_mph < 130)`, vehicleID,
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
				       AVG(CASE WHEN distance_mi > 2 AND start_battery_pct IS NOT NULL AND end_battery_pct IS NOT NULL
				            THEN (start_battery_pct - end_battery_pct)::float / distance_mi * 100 * 0.75
				            ELSE NULL END),
				       AVG(avg_power_kw),
				       AVG(avg_power_kw)
				FROM (SELECT * FROM drives WHERE vehicle_id = $1 AND end_ts IS NOT NULL
				      ORDER BY end_ts DESC LIMIT 10 OFFSET $2) sub`, vehicleID, offset,
			).Scan(&batchTotal, &batchWhKm, &batchPMax, &batchPMin)
			_ = h.db.Pool.QueryRow(ctx, `
				SELECT COUNT(*)
				FROM (SELECT * FROM drives WHERE vehicle_id = $1 AND end_ts IS NOT NULL
				      ORDER BY end_ts DESC LIMIT 10 OFFSET $2) sub
				WHERE max_speed_mph IS NULL OR max_speed_mph < 130`, vehicleID, offset,
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
		       MAX(max_speed_mph),
		       AVG(CASE WHEN duration_min > 0 THEN distance_mi / (duration_min / 60) ELSE NULL END),
		       MAX(avg_power_kw),
		       AVG(avg_power_kw),
		       AVG(avg_power_kw)
		FROM drives
		WHERE vehicle_id = $1 AND end_ts IS NOT NULL`, vehicleID,
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

	// Braking G from regen power (negative avg_power_kw)
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
		SELECT created_at, value_num
		FROM signal_log
		WHERE vehicle_id = $1 AND signal = 'VehicleSpeed'
		  AND value_num IS NOT NULL
		  AND created_at >= $2 AND created_at <= $3
		ORDER BY created_at ASC`, vehicleID, startTime, endTime)
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
