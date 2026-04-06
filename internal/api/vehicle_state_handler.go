package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
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
	days := 1
	if d := r.URL.Query().Get("days"); d != "" {
		if v, err := strconv.Atoi(d); err == nil && v > 0 && v <= 365 {
			days = v
		}
	}
	states, err := h.repo.GetTimeline(r.Context(), vehicleID, days)
	if err != nil {
		log.Error().Err(err).Msg("failed to get vehicle states")
		writeError(w, http.StatusInternalServerError, "failed to get timeline data")
		return
	}

	type transition struct {
		State           string  `json:"state"`
		StartedAt       string  `json:"started_at"`
		EndedAt         *string `json:"ended_at"`
		DurationSeconds float64 `json:"duration_seconds"`
	}
	transitions := make([]transition, 0, len(states))
	for _, s := range states {
		t := transition{
			State:           s.State,
			StartedAt:       s.StartDate.Format(time.RFC3339),
			DurationSeconds: s.DurationMin * 60,
		}
		if s.EndDate != nil {
			end := s.EndDate.Format(time.RFC3339)
			t.EndedAt = &end
		}
		transitions = append(transitions, t)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id":  vehicleID,
		"days":        days,
		"transitions": transitions,
	})
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
