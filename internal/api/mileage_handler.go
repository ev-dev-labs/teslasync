package api

import (
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

type MileageHandler struct {
	repo *database.MileageRepo
}

func NewMileageHandler(db *database.DB) *MileageHandler {
	return &MileageHandler{repo: database.NewMileageRepo(db)}
}

func (h *MileageHandler) Daily(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	limit, _ := pagination(r)
	mileage, err := h.repo.GetByVehicle(r.Context(), vehicleID, limit)
	if err != nil {
		log.Error().Err(err).Msg("failed to get daily mileage")
		writeError(w, http.StatusInternalServerError, "failed to get mileage data")
		return
	}
	if mileage == nil {
		mileage = make([]*models.DailyMileage, 0)
	}
	writeJSON(w, http.StatusOK, mileage)
}

func (h *MileageHandler) Monthly(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	data, err := h.repo.GetMonthlyByVehicle(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Msg("failed to get monthly mileage")
		writeError(w, http.StatusInternalServerError, "failed to get mileage data")
		return
	}
	writeJSON(w, http.StatusOK, data)
}

func (h *MileageHandler) Stats(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	stats, err := h.repo.GetStats(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Msg("failed to get mileage stats")
		writeError(w, http.StatusInternalServerError, "failed to get mileage stats")
		return
	}
	writeJSON(w, http.StatusOK, stats)
}
