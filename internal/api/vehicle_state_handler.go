package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/teslasync/teslasync/internal/database"
	"github.com/teslasync/teslasync/internal/models"
)

type VehicleStateHandler struct {
	repo *database.VehicleStateRepo
}

func NewVehicleStateHandler(db *database.DB) *VehicleStateHandler {
	return &VehicleStateHandler{repo: database.NewVehicleStateRepo(db)}
}

func (h *VehicleStateHandler) Timeline(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	limit, _ := pagination(r)
	states, err := h.repo.GetByVehicle(r.Context(), vehicleID, limit)
	if err != nil {
		log.Error().Err(err).Msg("failed to get vehicle states")
		writeError(w, http.StatusInternalServerError, "failed to get timeline data")
		return
	}
	if states == nil {
		states = make([]*models.VehicleStateRecord, 0)
	}
	writeJSON(w, http.StatusOK, states)
}

func (h *VehicleStateHandler) Summary(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	days := 30
	if s := r.URL.Query().Get("start"); s != "" {
		if t, err := time.Parse("2006-01-02", s); err == nil {
			days = int(time.Since(t).Hours()/24) + 1
			if days < 1 {
				days = 1
			}
		}
	} else if d := r.URL.Query().Get("days"); d != "" {
		if v, err := strconv.Atoi(d); err == nil && v > 0 && v <= 3650 {
			days = v
		}
	}
	summary, err := h.repo.GetStateSummary(r.Context(), vehicleID, days)
	if err != nil {
		log.Error().Err(err).Msg("failed to get state summary")
		writeError(w, http.StatusInternalServerError, "failed to get state summary")
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (h *VehicleStateHandler) DailyBreakdown(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	days := 30
	if s := r.URL.Query().Get("start"); s != "" {
		if t, err := time.Parse("2006-01-02", s); err == nil {
			days = int(time.Since(t).Hours()/24) + 1
			if days < 1 {
				days = 1
			}
		}
	} else if d := r.URL.Query().Get("days"); d != "" {
		if v, err := strconv.Atoi(d); err == nil && v > 0 && v <= 3650 {
			days = v
		}
	}
	breakdown, err := h.repo.GetDailyBreakdown(r.Context(), vehicleID, days)
	if err != nil {
		log.Error().Err(err).Msg("failed to get daily breakdown")
		writeError(w, http.StatusInternalServerError, "failed to get daily breakdown")
		return
	}
	writeJSON(w, http.StatusOK, breakdown)
}
