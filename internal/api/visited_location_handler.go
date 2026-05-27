package api

import (
	"net/http"
	"strconv"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/rs/zerolog/log"
)

type VisitedLocationHandler struct {
	repo *database.VisitedLocationRepo
}

func NewVisitedLocationHandler(db *database.DB) *VisitedLocationHandler {
	return &VisitedLocationHandler{repo: database.NewVisitedLocationRepo(db)}
}

func (h *VisitedLocationHandler) List(w http.ResponseWriter, r *http.Request) {
	limit, _ := pagination(r)
	vehicleIDStr := r.URL.Query().Get("vehicle_id")

	if vehicleIDStr != "" {
		vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid vehicle_id")
			return
		}
		locs, err := h.repo.GetByVehicle(r.Context(), vehicleID, limit)
		if err != nil {
			log.Error().Err(err).Msg("failed to get visited locations")
			writeError(w, http.StatusInternalServerError, "failed to get visited locations")
			return
		}
		if locs == nil {
			locs = make([]*models.VisitedLocation, 0)
		}
		writeJSON(w, http.StatusOK, locs)
		return
	}

	locs, err := h.repo.GetAll(r.Context(), limit)
	if err != nil {
		log.Error().Err(err).Msg("failed to get visited locations")
		writeError(w, http.StatusInternalServerError, "failed to get visited locations")
		return
	}
	if locs == nil {
		locs = make([]*models.VisitedLocation, 0)
	}
	writeJSON(w, http.StatusOK, locs)
}
