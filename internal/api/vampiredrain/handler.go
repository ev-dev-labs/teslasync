// Phase-43a / Prompt 0005 — VampireDrainHandler restores the
// /vampire-drain + /vampire-drain/stats endpoints deleted by Phase-42
// prompt 0077 (which dropped the vampire_drain_events table). Both
// shapes are now derived live from fsm_transitions (mig 000187) +
// signal_log (mig 000186, BatteryLevel + ChargeState fields).
//
// Frontend hooks (still pointed at these URLs, currently 404ing per
// useEnergy.ts comments):
//
//   - useVampireDrainEvents (web/src/api/hooks/useEnergy.ts)
//   - useVampireDrainStats  (web/src/api/hooks/useEnergy.ts)
//
// Response shapes follow the prompt-locked Decisions #2 + #3 (snake_case
// JSON keys). The legacy frontend types in web/src/types/energy.ts
// (camelCase startDate / batteryLost / drainRate) belong to the deleted
// handler; updating them and the consumers is out-of-scope for this
// prompt's allowed-files boundary. The events list endpoint returns an
// envelope `{vehicle_id, events: [...]}` rather than a bare array, so
// `useVampireDrainEvents` (which currently uses `select: safeArray`)
// will need a follow-up to extract the `events` field — same pattern as
// the Phase-43a / Prompt 0003 follow-up note for useStateSummary.
package vampiredrain

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
)

// vampireDrainRepository is the minimal repo surface VampireDrainHandler
// needs. Defined as an interface so the handler tests can supply a fake
// without spinning up a database — the codebase has no pgxmock harness
// (see repo memories from earlier phases).
type vampireDrainRepository interface {
	VehicleExists(ctx context.Context, vehicleID int64) (bool, error)
	Events(ctx context.Context, vehicleID int64, windowStart time.Time, limit int) ([]drivedb.VampireDrainEvent, error)
	Stats(ctx context.Context, vehicleID int64, windowStart time.Time, sampleWindowDays, limit int) (drivedb.VampireDrainStats, error)
}

// vampireDrainClock is injected so handler tests can pin the window
// boundary; production wiring leaves it nil and falls through to
// time.Now().UTC().
type vampireDrainClock func() time.Time

// VampireDrainHandler serves the two endpoints. Holds a repo + clock;
// no other dependencies needed.
type VampireDrainHandler struct {
	repo  vampireDrainRepository
	clock vampireDrainClock
}

// NewVampireDrainHandler binds the handler to a repo. clock is
// production-defaulted; tests construct via newVampireDrainHandlerForTest.
func NewVampireDrainHandler(repo *drivedb.VampireDrainRepo) *VampireDrainHandler {
	return &VampireDrainHandler{repo: repo}
}

const (
	// vampireDrainDefaultLimit mirrors Decision #2 default (50 events).
	vampireDrainDefaultLimit = 50
	// vampireDrainMaxLimit caps Decision #2 (500 events). The repo SQL
	// is bounded by parked-window count (typically a few per day) so
	// 500 corresponds to ~6 months of typical use — enough headroom
	// for any realistic UI without inviting unbounded scans.
	vampireDrainMaxLimit = 500
	// vampireDrainEventsWindowDays is the lookback for the events
	// endpoint. 365 days keeps the most-recent-N pagination meaningful
	// even for vehicles that drove rarely; older events would not fit
	// the limit cap anyway.
	vampireDrainEventsWindowDays = 365
	// vampireDrainStatsWindowDays is the lookback for the stats
	// endpoint per Decision #3 (sample_window_days field). 90 days
	// matches the project-wide default for "recent behavior" rollups
	// (analogue: vehicleStatesMaxDays = 90).
	vampireDrainStatsWindowDays = 90
	// vampireDrainStatsLimit is a generous cap on raw rows the stats
	// query may pull. At ~5 parked windows/day, 90 days yields ~450
	// events; 5000 is a safe ceiling that prevents a runaway scan
	// without truncating realistic data.
	vampireDrainStatsLimit = 5000
)

// parseEventsParams extracts and validates vehicle_id + limit for
// /vampire-drain. Returns ok=false after writing the appropriate 4xx
// response so the caller can early-return.
func (h *VampireDrainHandler) parseEventsParams(w http.ResponseWriter, r *http.Request) (vehicleID int64, limit int, ok bool) {
	q := r.URL.Query()

	vidStr := q.Get("vehicle_id")
	if vidStr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required")
		return 0, 0, false
	}
	vid, err := strconv.ParseInt(vidStr, 10, 64)
	if err != nil || vid <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return 0, 0, false
	}

	limit = vampireDrainDefaultLimit
	if l := q.Get("limit"); l != "" {
		v, err := strconv.Atoi(l)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "limit must be an integer")
			return 0, 0, false
		}
		if v < 1 {
			httpx.WriteError(w, http.StatusBadRequest, "limit must be >= 1")
			return 0, 0, false
		}
		if v > vampireDrainMaxLimit {
			// Decision #2 requires a structured "limit exceeds maximum"
			// payload that the frontend can surface verbatim. Mirrors
			// the Phase-43a / Prompt 0003+0004 envelope: writeError
			// would emit only {error, code}; we hand-write the JSON
			// to add the `max` field.
			httpx.WriteJSON(w, http.StatusBadRequest, map[string]any{
				"error": "limit exceeds maximum",
				"max":   vampireDrainMaxLimit,
				"code":  httpx.HTTPStatusCode(http.StatusBadRequest),
			})
			return 0, 0, false
		}
		limit = v
	}
	return vid, limit, true
}

// parseStatsParams extracts and validates vehicle_id only —
// /vampire-drain/stats has no client-tunable window per Decision #3
// (sample_window_days is fixed at 90 in the response).
func (h *VampireDrainHandler) parseStatsParams(w http.ResponseWriter, r *http.Request) (vehicleID int64, ok bool) {
	q := r.URL.Query()
	vidStr := q.Get("vehicle_id")
	if vidStr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required")
		return 0, false
	}
	vid, err := strconv.ParseInt(vidStr, 10, 64)
	if err != nil || vid <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return 0, false
	}
	return vid, true
}

// VampireDrainEventsResponse is the envelope returned by Events. The
// envelope shape (rather than a bare array) matches Decision #2 and
// the precedent set by /vehicle-states/timeline.
type VampireDrainEventsResponse struct {
	VehicleID int64                       `json:"vehicle_id"`
	Events    []drivedb.VampireDrainEvent `json:"events"`
}

// Events serves GET /vampire-drain?vehicle_id=...&limit=N.
//
// Returns 200 with {vehicle_id, events: []} for an existing vehicle
// even when no qualifying parked windows are found — operators need
// to distinguish "vehicle has no recorded vampire drain events" from
// "vehicle does not exist". The latter returns 404 because mig
// 000187 deliberately omits an FK on fsm_transitions.vehicle_id.
func (h *VampireDrainHandler) Events(w http.ResponseWriter, r *http.Request) {
	vehicleID, limit, ok := h.parseEventsParams(w, r)
	if !ok {
		return
	}

	ctx := r.Context()
	exists, err := h.repo.VehicleExists(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("vampire_drain.events: existence probe failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to verify vehicle")
		return
	}
	if !exists {
		httpx.WriteError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	now := h.now()
	windowStart := now.Add(-time.Duration(vampireDrainEventsWindowDays) * 24 * time.Hour)
	events, err := h.repo.Events(ctx, vehicleID, windowStart, limit)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Int("limit", limit).Msg("vampire_drain.events: query failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load vampire drain events")
		return
	}
	if events == nil {
		events = []drivedb.VampireDrainEvent{}
	}

	httpx.WriteJSON(w, http.StatusOK, VampireDrainEventsResponse{
		VehicleID: vehicleID,
		Events:    events,
	})
}

// VampireDrainStatsResponse is the envelope returned by Stats. Mirrors
// the drivedb.VampireDrainStats shape with vehicle_id prepended.
type VampireDrainStatsResponse struct {
	VehicleID            int64    `json:"vehicle_id"`
	EventCount           int      `json:"event_count"`
	TotalObservedHours   float64  `json:"total_observed_hours"`
	AvgDrainPctPerDay    *float64 `json:"avg_drain_pct_per_day"`
	MedianDrainPctPerDay *float64 `json:"median_drain_pct_per_day"`
	P95DrainPctPerDay    *float64 `json:"p95_drain_pct_per_day"`
	SampleWindowDays     int      `json:"sample_window_days"`
}

// Stats serves GET /vampire-drain/stats?vehicle_id=... .
//
// 404/200/500 disambiguation matches Events. The 90-day window cut-off
// is computed once per request and shared with the SQL row filter so
// the response cannot race the wall clock mid-query.
func (h *VampireDrainHandler) Stats(w http.ResponseWriter, r *http.Request) {
	vehicleID, ok := h.parseStatsParams(w, r)
	if !ok {
		return
	}

	ctx := r.Context()
	exists, err := h.repo.VehicleExists(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("vampire_drain.stats: existence probe failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to verify vehicle")
		return
	}
	if !exists {
		httpx.WriteError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	now := h.now()
	windowStart := now.Add(-time.Duration(vampireDrainStatsWindowDays) * 24 * time.Hour)
	stats, err := h.repo.Stats(ctx, vehicleID, windowStart, vampireDrainStatsWindowDays, vampireDrainStatsLimit)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("vampire_drain.stats: query failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load vampire drain stats")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, VampireDrainStatsResponse{
		VehicleID:            vehicleID,
		EventCount:           stats.EventCount,
		TotalObservedHours:   stats.TotalObservedHours,
		AvgDrainPctPerDay:    stats.AvgDrainPctPerDay,
		MedianDrainPctPerDay: stats.MedianDrainPctPerDay,
		P95DrainPctPerDay:    stats.P95DrainPctPerDay,
		SampleWindowDays:     stats.SampleWindowDays,
	})
}

// now returns the injected clock or wall time.
func (h *VampireDrainHandler) now() time.Time {
	if h.clock != nil {
		return h.clock()
	}
	return time.Now().UTC()
}
