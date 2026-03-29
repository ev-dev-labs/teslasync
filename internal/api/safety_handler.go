package api

import (
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

type SafetyHandler struct {
	repo *database.SafetyRepo
}

func NewSafetyHandler(db *database.DB) *SafetyHandler {
	return &SafetyHandler{repo: database.NewSafetyRepo(db)}
}

func (h *SafetyHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	limit, _ := pagination(r)
	snaps, err := h.repo.GetByVehicle(r.Context(), vehicleID, limit)
	if err != nil {
		log.Error().Err(err).Msg("failed to get safety data")
		writeError(w, http.StatusInternalServerError, "failed to get safety data")
		return
	}
	if snaps == nil {
		snaps = make([]*models.SafetySnapshot, 0)
	}
	writeJSON(w, http.StatusOK, snaps)
}

func (h *SafetyHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	snap, err := h.repo.GetLatest(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Msg("failed to get latest safety data")
		writeError(w, http.StatusInternalServerError, "failed to get safety data")
		return
	}
	writeJSON(w, http.StatusOK, snap)
}
