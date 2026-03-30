package api

import (
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

type UserPreferenceHandler struct {
	repo *database.UserPreferenceRepo
}

func NewUserPreferenceHandler(db *database.DB) *UserPreferenceHandler {
	return &UserPreferenceHandler{repo: database.NewUserPreferenceRepo(db)}
}

func (h *UserPreferenceHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	limit, _ := pagination(r)
	snaps, err := h.repo.GetByVehicle(r.Context(), vehicleID, limit)
	if err != nil {
		log.Error().Err(err).Msg("failed to get user preference data")
		writeError(w, http.StatusInternalServerError, "failed to get user preference data")
		return
	}
	if snaps == nil {
		snaps = make([]*models.UserPreferenceSnapshot, 0)
	}
	writeJSON(w, http.StatusOK, snaps)
}

func (h *UserPreferenceHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	snap, err := h.repo.GetLatest(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Msg("failed to get latest user preference")
		writeError(w, http.StatusInternalServerError, "failed to get user preference")
		return
	}
	writeJSON(w, http.StatusOK, snap)
}
