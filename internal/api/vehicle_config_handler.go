package api

import (
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

type VehicleConfigHandler struct {
	repo *database.VehicleConfigRepo
}

func NewVehicleConfigHandler(db *database.DB) *VehicleConfigHandler {
	return &VehicleConfigHandler{repo: database.NewVehicleConfigRepo(db)}
}

func (h *VehicleConfigHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	limit, _ := pagination(r)
	snaps, err := h.repo.GetByVehicle(r.Context(), vehicleID, limit)
	if err != nil {
		log.Error().Err(err).Msg("failed to get vehicle config data")
		writeError(w, http.StatusInternalServerError, "failed to get vehicle config data")
		return
	}
	if snaps == nil {
		snaps = make([]*models.VehicleConfigSnapshot, 0)
	}
	writeJSON(w, http.StatusOK, snaps)
}

func (h *VehicleConfigHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	snap, err := h.repo.GetLatest(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Msg("failed to get latest vehicle config")
		writeError(w, http.StatusInternalServerError, "failed to get vehicle config")
		return
	}
	writeJSON(w, http.StatusOK, snap)
}
