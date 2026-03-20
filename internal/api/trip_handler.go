package api

import (
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"
	"github.com/teslasync/teslasync/internal/database"
	"github.com/teslasync/teslasync/internal/models"
)

type TripHandler struct {
	repo *database.TripRepo
}

func NewTripHandler(db *database.DB) *TripHandler {
	return &TripHandler{repo: database.NewTripRepo(db)}
}

func (h *TripHandler) List(w http.ResponseWriter, r *http.Request) {
	limit, _ := pagination(r)
	startTime, endTime := parseDateRange(r)
	vehicleIDStr := r.URL.Query().Get("vehicle_id")

	if vehicleIDStr != "" {
		vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid vehicle_id")
			return
		}
		trips, err := h.repo.GetByVehicle(r.Context(), vehicleID, limit, startTime, endTime)
		if err != nil {
			log.Error().Err(err).Msg("failed to get trips")
			writeError(w, http.StatusInternalServerError, "failed to get trips")
			return
		}
		if trips == nil {
			trips = make([]*models.Trip, 0)
		}
		writeJSON(w, http.StatusOK, trips)
		return
	}

	trips, err := h.repo.GetAll(r.Context(), limit, startTime, endTime)
	if err != nil {
		log.Error().Err(err).Msg("failed to get trips")
		writeError(w, http.StatusInternalServerError, "failed to get trips")
		return
	}
	if trips == nil {
		trips = make([]*models.Trip, 0)
	}
	writeJSON(w, http.StatusOK, trips)
}
