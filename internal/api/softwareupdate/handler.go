package softwareupdate

import (
	"net/http"
	"strconv"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
	"github.com/rs/zerolog/log"
)

type Handler struct {
	repo *systemdb.SoftwareUpdateRepo
}

func NewHandler(db *database.DB) *Handler {
	return &Handler{repo: systemdb.NewSoftwareUpdateRepo(db)}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	limit, _ := apiparams.Pagination(r)
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	startTime, endTime := apiparams.ParseDateRange(r)

	if vehicleIDStr != "" {
		vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle_id")
			return
		}
		updates, err := h.repo.GetByVehicle(r.Context(), vehicleID, limit, startTime, endTime)
		if err != nil {
			log.Error().Err(err).Msg("failed to get software updates")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to get software updates")
			return
		}
		if updates == nil {
			updates = make([]*vehiclemodel.SoftwareUpdate, 0)
		}
		httpx.WriteJSON(w, http.StatusOK, updates)
		return
	}

	updates, err := h.repo.GetAll(r.Context(), limit, startTime, endTime)
	if err != nil {
		log.Error().Err(err).Msg("failed to get software updates")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get software updates")
		return
	}
	if updates == nil {
		updates = make([]*vehiclemodel.SoftwareUpdate, 0)
	}
	httpx.WriteJSON(w, http.StatusOK, updates)
}
