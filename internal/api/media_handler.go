package api

import (
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

type MediaHandler struct {
	repo *database.MediaRepo
}

func NewMediaHandler(db *database.DB) *MediaHandler {
	return &MediaHandler{repo: database.NewMediaRepo(db)}
}

func (h *MediaHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	limit, _ := pagination(r)
	snaps, err := h.repo.GetByVehicle(r.Context(), vehicleID, limit)
	if err != nil {
		log.Error().Err(err).Msg("failed to get media data")
		writeError(w, http.StatusInternalServerError, "failed to get media data")
		return
	}
	if snaps == nil {
		snaps = make([]*models.MediaSnapshot, 0)
	}
	writeJSON(w, http.StatusOK, snaps)
}

func (h *MediaHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	snap, err := h.repo.GetLatest(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Msg("failed to get latest media data")
		writeError(w, http.StatusInternalServerError, "failed to get media data")
		return
	}
	if snap == nil {
		writeJSON(w, http.StatusOK, nil)
		return
	}
	writeJSON(w, http.StatusOK, snap)
}
