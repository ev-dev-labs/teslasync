package api

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/rs/zerolog/log"
)

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
	// Alias ts→created_at and speed_mph→speed for frontend PositionRecord
	for _, row := range rows {
		if ts, ok := row["ts"]; ok {
			row["created_at"] = ts
			row["id"] = fmt.Sprintf("%v", ts)
		}
		if v, ok := row["speed_mph"]; ok {
			row["speed"] = v
		}
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
