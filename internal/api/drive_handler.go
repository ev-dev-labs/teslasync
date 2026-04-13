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

	drive, err := h.driveRepo.GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get drive")
		writeError(w, http.StatusInternalServerError, "failed to get drive")
		return
	}
	if drive == nil {
		writeError(w, http.StatusNotFound, "drive not found")
		return
	}
	writeJSON(w, http.StatusOK, drive)
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
