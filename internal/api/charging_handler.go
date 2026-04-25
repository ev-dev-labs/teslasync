package api

import (
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// ChargingHandler handles charging session HTTP requests.
type ChargingHandler struct {
	chargingRepo    *database.ChargingRepo
	signalLogReader *database.SignalLogReader
}

func NewChargingHandler(db *database.DB) *ChargingHandler {
	return &ChargingHandler{
		chargingRepo:    database.NewChargingRepo(db),
		signalLogReader: database.NewSignalLogReader(db),
	}
}

// Charge telemetry signal → JSON field mappings (field names match the old
// ChargeTelemetryReading JSON tags so the frontend contract is unchanged).
var chargeTelemetryMappings = []database.PivotMapping{
	{Signal: "BatteryLevel", Field: "battery_level"},
	{Signal: "ChargerVoltage", Field: "voltage"},
	{Signal: "ChargerActualCurrent", Field: "current_amps"},
	{Signal: "ACChargingPower", Field: "power_kw"},
	{Signal: "DCChargingPower", Field: "dc_power_kw"},
	{Signal: "ACChargingEnergyIn", Field: "energy_added"},
	{Signal: "ChargeRateMilePerHour", Field: "charge_rate"},
	{Signal: "BatteryHeaterOn", Field: "battery_heater_on"},
	{Signal: "InsideTemp", Field: "inside_temp"},
	{Signal: "OutsideTemp", Field: "outside_temp"},
}

func (h *ChargingHandler) ListByVehicle(w http.ResponseWriter, r *http.Request) {
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
	sessions, err := h.chargingRepo.GetByVehicle(r.Context(), vehicleID, limit, offset, startTime, endTime)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("failed to list charging sessions")
		writeError(w, http.StatusInternalServerError, "failed to list charging sessions")
		return
	}
	writeJSON(w, http.StatusOK, sessions)
}

func (h *ChargingHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "sessionID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid session ID")
		return
	}

	session, err := h.chargingRepo.GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get charging session")
		writeError(w, http.StatusInternalServerError, "failed to get charging session")
		return
	}
	if session == nil {
		writeError(w, http.StatusNotFound, "charging session not found")
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (h *ChargingHandler) TelemetryReadings(w http.ResponseWriter, r *http.Request) {
	sessionID, err := urlParamInt64(r, "sessionID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid session ID")
		return
	}

	ctx := r.Context()
	session, err := h.chargingRepo.GetByID(ctx, sessionID)
	if err != nil {
		log.Error().Err(err).Int64("sessionID", sessionID).Msg("failed to get charging session for telemetry")
		writeError(w, http.StatusInternalServerError, "failed to get charging session")
		return
	}
	if session == nil {
		writeError(w, http.StatusNotFound, "charging session not found")
		return
	}

	endTs := time.Now().UTC()
	if session.EndTs != nil {
		endTs = *session.EndTs
	}

	rows, err := h.signalLogReader.SignalTracePivotFlat(ctx,
		session.VehicleID, chargeTelemetryMappings, session.StartTs, endTs)
	if err != nil {
		log.Error().Err(err).Int64("sessionID", sessionID).Msg("failed to get charge telemetry from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get telemetry")
		return
	}
	if rows == nil {
		rows = []map[string]interface{}{}
	}
	// Rename "ts" → "created_at" to match old ChargeTelemetryReading JSON shape
	for _, row := range rows {
		if ts, ok := row["ts"]; ok {
			row["created_at"] = ts
			delete(row, "ts")
		}
	}
	writeJSON(w, http.StatusOK, rows)
}


