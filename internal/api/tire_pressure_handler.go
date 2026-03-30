package api

import (
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

type TirePressureHandler struct {
	repo *database.TirePressureRepo
}

func NewTirePressureHandler(db *database.DB) *TirePressureHandler {
	return &TirePressureHandler{repo: database.NewTirePressureRepo(db)}
}

func (h *TirePressureHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	limit, _ := pagination(r)
	snaps, err := h.repo.GetByVehicle(r.Context(), vehicleID, limit)
	if err != nil {
		log.Error().Err(err).Msg("failed to get tire pressure data")
		writeError(w, http.StatusInternalServerError, "failed to get tire pressure data")
		return
	}
	if snaps == nil {
		snaps = make([]*models.TirePressureSnapshot, 0)
	}
	writeJSON(w, http.StatusOK, snaps)
}

func (h *TirePressureHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	snap, err := h.repo.GetLatest(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Msg("failed to get latest tire pressure")
		writeError(w, http.StatusInternalServerError, "failed to get tire pressure")
		return
	}
	if snap == nil {
		writeJSON(w, http.StatusOK, nil)
		return
	}
	writeJSON(w, http.StatusOK, snap)
}
