package api

import (
	"net/http"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// DriveHandler handles drive-related HTTP requests.
type DriveHandler struct {
	driveRepo *database.DriveRepo
}

func NewDriveHandler(db *database.DB) *DriveHandler {
	return &DriveHandler{driveRepo: database.NewDriveRepo(db)}
}

func (h *DriveHandler) ListByVehicle(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		writeError(w, http.StatusBadRequest, "vehicle_id query parameter required")
		return
	}

	vehicleID, err := parseInt64(vehicleIDStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	limit, offset := pagination(r)
	startTime, endTime := parseDateRange(r)
	drives, err := h.driveRepo.GetByVehicle(r.Context(), vehicleID, limit, offset, startTime, endTime)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("failed to list drives")
		writeError(w, http.StatusInternalServerError, "failed to list drives")
		return
	}
	writeJSON(w, http.StatusOK, drives)
}

func (h *DriveHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "driveID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	drive, err := h.driveRepo.GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get drive")
		writeError(w, http.StatusInternalServerError, "failed to get drive")
		return
	}
	if drive == nil {
		writeError(w, http.StatusNotFound, "drive not found")
		return
	}
	writeJSON(w, http.StatusOK, drive)
}
