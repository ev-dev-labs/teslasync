package api

import (
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

type SecurityHandler struct {
	repo *database.SecurityRepo
}

func NewSecurityHandler(db *database.DB) *SecurityHandler {
	return &SecurityHandler{repo: database.NewSecurityRepo(db)}
}

func (h *SecurityHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	limit, _ := pagination(r)
	evts, err := h.repo.GetByVehicle(r.Context(), vehicleID, limit)
	if err != nil {
		log.Error().Err(err).Msg("failed to get security events")
		writeError(w, http.StatusInternalServerError, "failed to get security events")
		return
	}
	if evts == nil {
		evts = make([]*models.SecurityEvent, 0)
	}
	writeJSON(w, http.StatusOK, evts)
}

func (h *SecurityHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	evt, err := h.repo.GetLatest(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Msg("failed to get latest security event")
		writeError(w, http.StatusInternalServerError, "failed to get security data")
		return
	}
	if evt == nil {
		writeError(w, http.StatusNotFound, "no security data available")
		return
	}
	writeJSON(w, http.StatusOK, evt)
}
