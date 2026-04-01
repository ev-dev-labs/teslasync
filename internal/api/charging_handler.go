package api

import (
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ChargingHandler handles charging session HTTP requests.
type ChargingHandler struct {
	chargingRepo *database.ChargingRepo
	chargeTelRepo *database.ChargeTelemetryReadingRepo
}

func NewChargingHandler(db *database.DB) *ChargingHandler {
	return &ChargingHandler{
		chargingRepo:  database.NewChargingRepo(db),
		chargeTelRepo: database.NewChargeTelemetryReadingRepo(db),
	}
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

	readings, err := h.chargeTelRepo.GetBySessionID(r.Context(), sessionID)
	if err != nil {
		log.Error().Err(err).Int64("id", sessionID).Msg("failed to get charge telemetry")
		writeError(w, http.StatusInternalServerError, "failed to get charge telemetry")
		return
	}
	if readings == nil {
		readings = make([]*models.ChargeTelemetryReading, 0)
	}
	writeJSON(w, http.StatusOK, readings)
}

func parseInt64(s string) (int64, error) {
	return strconv.ParseInt(s, 10, 64)
}
