package api

import (
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

type MotorHandler struct {
	repo *database.MotorRepo
}

func NewMotorHandler(db *database.DB) *MotorHandler {
	return &MotorHandler{repo: database.NewMotorRepo(db)}
}

func (h *MotorHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	// Motor snapshots are retrieved via GetLatest; for the list view
	// we return the latest snapshot if available.
	snap, err := h.repo.GetLatest(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Msg("failed to get motor data")
		writeError(w, http.StatusInternalServerError, "failed to get motor data")
		return
	}
	if snap == nil {
		writeJSON(w, http.StatusOK, []models.MotorSnapshot{})
		return
	}
	writeJSON(w, http.StatusOK, []*models.MotorSnapshot{snap})
}

func (h *MotorHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	snap, err := h.repo.GetLatest(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Msg("failed to get latest motor data")
		writeError(w, http.StatusInternalServerError, "failed to get motor data")
		return
	}
	if snap == nil {
		writeJSON(w, http.StatusOK, nil)
		return
	}
	writeJSON(w, http.StatusOK, snap)
}
