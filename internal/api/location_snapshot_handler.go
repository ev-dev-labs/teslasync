package api

import (
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

type LocationSnapshotHandler struct {
	repo *database.LocationSnapshotRepo
}

func NewLocationSnapshotHandler(db *database.DB) *LocationSnapshotHandler {
	return &LocationSnapshotHandler{repo: database.NewLocationSnapshotRepo(db)}
}

func (h *LocationSnapshotHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	limit, _ := pagination(r)
	snaps, err := h.repo.GetByVehicle(r.Context(), vehicleID, limit)
	if err != nil {
		log.Error().Err(err).Msg("failed to get location snapshot data")
		writeError(w, http.StatusInternalServerError, "failed to get location snapshot data")
		return
	}
	if snaps == nil {
		snaps = make([]*models.LocationSnapshot, 0)
	}
	writeJSON(w, http.StatusOK, snaps)
}

func (h *LocationSnapshotHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	snap, err := h.repo.GetLatest(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Msg("failed to get latest location snapshot")
		writeError(w, http.StatusInternalServerError, "failed to get location snapshot")
		return
	}
	writeJSON(w, http.StatusOK, snap)
}
