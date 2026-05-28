// Phase-43a / Prompt 0003 — VehicleStatesHandler restores the
// /vehicle-states/timeline + /vehicle-states/summary endpoints deleted
// by Phase-42 prompt 0077, backed by fsm_transitions (mig 000187)
// instead of the dropped vehicle_states snapshot table.
//
// Frontend hooks (still pointed at these URLs, currently 404ing):
//
//   - useStateTimeline (web/src/api/hooks/useAdmin.ts)
//   - useTimeline      (web/src/api/hooks/useAnalytics.ts)
//   - useStateSummary  (web/src/api/hooks/useAnalytics.ts)
//
// Response shapes follow the prompt-locked decisions; consumers using
// `select: safeArray` on what is now an object response will need
// follow-up updates outside this prompt's allowed-files boundary.
package api

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
)

// vehicleStatesRepository is the minimal repo surface VehicleStatesHandler
// needs. Defined as an interface so the handler tests can supply a fake
// without spinning up a database — the codebase has no pgxmock harness
// (see repo memories from earlier phases).
type vehicleStatesRepository interface {
	VehicleExists(ctx context.Context, vehicleID int64) (bool, error)
	Timeline(ctx context.Context, vehicleID int64, windowStart, windowEnd time.Time) ([]vehicledb.VehicleStateTransition, error)
	Summary(ctx context.Context, vehicleID int64, windowStart, windowEnd time.Time) ([]vehicledb.VehicleStateSummaryRow, float64, error)
}

// vehicleStatesClock is injected so handler tests can pin the window
// boundary; production wiring leaves it nil and falls through to
// time.Now().UTC().
type vehicleStatesClock func() time.Time

// VehicleStatesHandler serves the two endpoints. Hold a repo + clock;
// no other dependencies needed.
type VehicleStatesHandler struct {
	repo  vehicleStatesRepository
	clock vehicleStatesClock
}

// NewVehicleStatesHandler binds the handler to a repo. clock is
// production-defaulted; tests construct via newVehicleStatesHandlerForTest.
func NewVehicleStatesHandler(repo *vehicledb.VehicleStatesRepo) *VehicleStatesHandler {
	return &VehicleStatesHandler{repo: repo}
}

const (
	// vehicleStatesDefaultDays mirrors the legacy frontend default;
	// useStateTimeline in useAdmin.ts passes days=7 explicitly when
	// callers don't override.
	vehicleStatesDefaultDays = 7
	// vehicleStatesMaxDays caps the window per Decision #4. A 90-day
	// window over fsm_transitions is bounded by the table's per-vehicle
	// row count (~1000s/year per the table doc on mig 000187 line 17),
	// so this cap keeps the SELECT cheap.
	vehicleStatesMaxDays = 90
)

// parseVehicleStatesParams extracts and validates vehicle_id + days.
// Returns ok=false after writing the appropriate 4xx response so the
// caller can early-return.
func (h *VehicleStatesHandler) parseVehicleStatesParams(w http.ResponseWriter, r *http.Request) (vehicleID int64, days int, ok bool) {
	q := r.URL.Query()

	vidStr := q.Get("vehicle_id")
	if vidStr == "" {
		writeError(w, http.StatusBadRequest, "vehicle_id is required")
		return 0, 0, false
	}
	vid, err := strconv.ParseInt(vidStr, 10, 64)
	if err != nil || vid <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return 0, 0, false
	}

	days = vehicleStatesDefaultDays
	if d := q.Get("days"); d != "" {
		v, err := strconv.Atoi(d)
		if err != nil {
			writeError(w, http.StatusBadRequest, "days must be an integer")
			return 0, 0, false
		}
		if v < 1 {
			writeError(w, http.StatusBadRequest, "days must be >= 1")
			return 0, 0, false
		}
		if v > vehicleStatesMaxDays {
			// Decision #4 requires a structured "days exceeds maximum"
			// payload that the frontend can surface verbatim. The
			// shared writeError helper would emit only {error, code};
			// we hand-write the JSON to add the `max` field.
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": "days exceeds maximum",
				"max":   vehicleStatesMaxDays,
				"code":  httpStatusCode(http.StatusBadRequest),
			})
			return 0, 0, false
		}
		days = v
	}
	return vid, days, true
}

// VehicleStatesTimelineResponse is the envelope returned by Timeline.
// Snake-case JSON tags so the frontend hooks can read either
// camelCaseKeys-transformed or original keys per project convention.
type VehicleStatesTimelineResponse struct {
	VehicleID   int64                              `json:"vehicle_id"`
	Days        int                                `json:"days"`
	Transitions []vehicledb.VehicleStateTransition `json:"transitions"`
}

// VehicleStatesSummaryResponse is the envelope returned by Summary.
type VehicleStatesSummaryResponse struct {
	VehicleID    int64                              `json:"vehicle_id"`
	Days         int                                `json:"days"`
	TotalSeconds float64                            `json:"total_seconds"`
	ByState      []vehicledb.VehicleStateSummaryRow `json:"by_state"`
}

// Timeline serves GET /vehicle-states/timeline?vehicle_id=...&days=N.
//
// Returns 200 with {vehicle_id, days, transitions: []} for an existing
// vehicle even when no transitions are recorded — operators need to
// distinguish "vehicle has no FSM activity yet" from "vehicle does not
// exist". The latter returns 404 because mig 000187 deliberately omits
// an FK on fsm_transitions.vehicle_id (would-be dangling rows must not
// resurrect a deleted vehicle).
func (h *VehicleStatesHandler) Timeline(w http.ResponseWriter, r *http.Request) {
	vehicleID, days, ok := h.parseVehicleStatesParams(w, r)
	if !ok {
		return
	}

	ctx := r.Context()
	exists, err := h.repo.VehicleExists(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("vehicle_states.timeline: existence probe failed")
		writeError(w, http.StatusInternalServerError, "failed to verify vehicle")
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	end, start := h.windowFor(days)
	transitions, err := h.repo.Timeline(ctx, vehicleID, start, end)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Int("days", days).Msg("vehicle_states.timeline: query failed")
		writeError(w, http.StatusInternalServerError, "failed to load timeline")
		return
	}
	if transitions == nil {
		transitions = []vehicledb.VehicleStateTransition{}
	}

	writeJSON(w, http.StatusOK, VehicleStatesTimelineResponse{
		VehicleID:   vehicleID,
		Days:        days,
		Transitions: transitions,
	})
}

// Summary serves GET /vehicle-states/summary?vehicle_id=...&days=N.
//
// 404/200/500 disambiguation matches Timeline. The summary algorithm
// lives in database.computeStateSummary (purely Go, well-tested in the
// repo unit tests).
func (h *VehicleStatesHandler) Summary(w http.ResponseWriter, r *http.Request) {
	vehicleID, days, ok := h.parseVehicleStatesParams(w, r)
	if !ok {
		return
	}

	ctx := r.Context()
	exists, err := h.repo.VehicleExists(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("vehicle_states.summary: existence probe failed")
		writeError(w, http.StatusInternalServerError, "failed to verify vehicle")
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	end, start := h.windowFor(days)
	rows, total, err := h.repo.Summary(ctx, vehicleID, start, end)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Int("days", days).Msg("vehicle_states.summary: query failed")
		writeError(w, http.StatusInternalServerError, "failed to load summary")
		return
	}
	if rows == nil {
		rows = []vehicledb.VehicleStateSummaryRow{}
	}

	writeJSON(w, http.StatusOK, VehicleStatesSummaryResponse{
		VehicleID:    vehicleID,
		Days:         days,
		TotalSeconds: total,
		ByState:      rows,
	})
}

// windowFor returns (end, start) using the injected clock or wall time.
// Computed once per request so both the SQL row filter and the dwell
// algorithm see the same boundaries (eliminating SQL-vs-Go time skew).
func (h *VehicleStatesHandler) windowFor(days int) (end, start time.Time) {
	if h.clock != nil {
		end = h.clock()
	} else {
		end = time.Now().UTC()
	}
	start = end.Add(-time.Duration(days) * 24 * time.Hour)
	return end, start
}
