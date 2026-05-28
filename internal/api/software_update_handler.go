package api

import (
	"net/http"
	"strconv"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	"github.com/ev-dev-labs/teslasync/internal/database"
	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
	"github.com/rs/zerolog/log"
)

type SoftwareUpdateHandler struct {
	repo *systemdb.SoftwareUpdateRepo
}

func NewSoftwareUpdateHandler(db *database.DB) *SoftwareUpdateHandler {
	return &SoftwareUpdateHandler{repo: systemdb.NewSoftwareUpdateRepo(db)}
}

func (h *SoftwareUpdateHandler) List(w http.ResponseWriter, r *http.Request) {
	limit, _ := pagination(r)
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	startTime, endTime := parseDateRange(r)

	if vehicleIDStr != "" {
		vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid vehicle_id")
			return
		}
		updates, err := h.repo.GetByVehicle(r.Context(), vehicleID, limit, startTime, endTime)
		if err != nil {
			log.Error().Err(err).Msg("failed to get software updates")
			writeError(w, http.StatusInternalServerError, "failed to get software updates")
			return
		}
		if updates == nil {
			updates = make([]*vehiclemodel.SoftwareUpdate, 0)
		}
		writeJSON(w, http.StatusOK, updates)
		return
	}

	updates, err := h.repo.GetAll(r.Context(), limit, startTime, endTime)
	if err != nil {
		log.Error().Err(err).Msg("failed to get software updates")
		writeError(w, http.StatusInternalServerError, "failed to get software updates")
		return
	}
	if updates == nil {
		updates = make([]*vehiclemodel.SoftwareUpdate, 0)
	}
	writeJSON(w, http.StatusOK, updates)
}
