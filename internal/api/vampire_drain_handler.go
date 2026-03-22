package api

import (
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

type VampireDrainHandler struct {
	repo *database.VampireDrainRepo
}

func NewVampireDrainHandler(db *database.DB) *VampireDrainHandler {
	return &VampireDrainHandler{repo: database.NewVampireDrainRepo(db)}
}

func (h *VampireDrainHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	limit, _ := pagination(r)
	startTime, endTime := parseDateRange(r)
	events, err := h.repo.GetByVehicle(r.Context(), vehicleID, limit, startTime, endTime)
	if err != nil {
		log.Error().Err(err).Msg("failed to get vampire drain events")
		writeError(w, http.StatusInternalServerError, "failed to get vampire drain data")
		return
	}
	if events == nil {
		events = make([]*models.VampireDrainEvent, 0)
	}
	writeJSON(w, http.StatusOK, events)
}

func (h *VampireDrainHandler) Stats(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	stats, err := h.repo.GetStats(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Msg("failed to get vampire drain stats")
		writeError(w, http.StatusInternalServerError, "failed to get vampire drain stats")
		return
	}
	writeJSON(w, http.StatusOK, stats)
}
