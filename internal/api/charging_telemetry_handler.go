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
	sessionID, err := strconv.ParseInt(r.URL.Query().Get("session_id"), 10, 64)
	if err != nil || sessionID == 0 {
		writeJSON(w, http.StatusOK, []models.ChargingTelemetry{})
		return
	}
	data, err := h.repo.ListBySession(r.Context(), sessionID)
	if err != nil {
		log.Error().Err(err).Msg("failed to get charging telemetry")
		writeError(w, http.StatusInternalServerError, "failed to get charging telemetry")
		return
	}
	if data == nil {
		data = make([]models.ChargingTelemetry, 0)
	}
	writeJSON(w, http.StatusOK, data)
}

func (h *ChargingTelemetryHandler) Latest(w http.ResponseWriter, r *http.Request) {
	// ChargingTelemetry is now retrieved by session, not by vehicle.
	// Return null when no session is specified.
	writeJSON(w, http.StatusOK, nil)
}
