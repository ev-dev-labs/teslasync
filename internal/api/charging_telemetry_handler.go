package api

import (
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

type ChargingTelemetryHandler struct {
	repo *database.ChargingTelemetryRepo
}

func NewChargingTelemetryHandler(db *database.DB) *ChargingTelemetryHandler {
	return &ChargingTelemetryHandler{repo: database.NewChargingTelemetryRepo(db)}
}

func (h *ChargingTelemetryHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	limit, _ := pagination(r)
	data, err := h.repo.GetByVehicle(r.Context(), vehicleID, limit)
	if err != nil {
		log.Error().Err(err).Msg("failed to get charging telemetry")
		writeError(w, http.StatusInternalServerError, "failed to get charging telemetry")
		return
	}
	if data == nil {
		data = make([]*models.ChargingTelemetry, 0)
	}
	writeJSON(w, http.StatusOK, data)
}

func (h *ChargingTelemetryHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	data, err := h.repo.GetLatest(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Msg("failed to get latest charging telemetry")
		writeError(w, http.StatusInternalServerError, "failed to get charging telemetry")
		return
	}
	writeJSON(w, http.StatusOK, data)
}
