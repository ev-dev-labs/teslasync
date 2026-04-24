package api

import (
	"net/http"
	"strconv"
	"time"

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
	from := time.Now().AddDate(0, 0, -7)
	to := time.Now()
	evts, err := h.repo.ListByVehicle(r.Context(), vehicleID, from, to)
	if err != nil {
		log.Error().Err(err).Msg("failed to get security events")
		writeError(w, http.StatusInternalServerError, "failed to get security events")
		return
	}
	if evts == nil {
		evts = make([]models.SecurityEvent, 0)
	}
	writeJSON(w, http.StatusOK, evts)
}

func (h *SecurityHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	from := time.Now().Add(-1 * time.Hour)
	to := time.Now()
	evts, err := h.repo.ListByVehicle(r.Context(), vehicleID, from, to)
	if err != nil {
		log.Error().Err(err).Msg("failed to get latest security event")
		writeError(w, http.StatusInternalServerError, "failed to get security data")
		return
	}
	if len(evts) == 0 {
		writeJSON(w, http.StatusOK, nil)
		return
	}
	writeJSON(w, http.StatusOK, evts[len(evts)-1])
}
