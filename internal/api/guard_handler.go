// Phase-43a / Prompt 0006 — GuardHandler restores the
// /vehicles/{vehicleID}/guard, /guard/events,
// /guard/events/{eventID}/acknowledge and /guard/panic endpoints
// deleted by Phase-42 prompt 0077.
//
// Scope and shape are governed by the prompt's locked Decisions:
//
//   - Decision #1 — Status: { vehicle_id, sentry_mode_active,
//     last_state, last_state_at, recent_event_count_24h }. Derived
//     from the latest security_events row with event_type='sentry_mode'
//     plus a 24h count over all security_events rows. SentryMode IS
//     routed to dest:security_event in routing.yaml line 799 — the
//     escape hatch authorising security_events as the sentry-state
//     source applies (see GuardRepo doc for details).
//   - Decision #2 — Events: { vehicle_id, events: [...] }. Most-recent-
//     first; default 100, max 1000.
//   - Decision #3 — Acknowledge: POST with no body, UPDATE security_events
//     SET acknowledged_at=now(), acknowledged_by=actorFromRequest(r);
//     404 if event_id is unknown OR belongs to a different vehicle.
//   - Decision #5 — Panic: 501 "Tesla command proxy not configured" if
//     cfg.Tesla.CommandProxyURL is empty; otherwise sends sentry_on +
//     honk_horn + flash_lights via the existing tesla.Client. Partial
//     failures return 502 with detail of which command failed.
//   - Decision #6 — Auth: all four require auth; panic additionally
//     wears RequireSudo (router-level wiring), acknowledge stays IP
//     rate-limited (soft mark-read).
//
// Frontend hook: web/src/api/hooks/useGuard.ts
package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// guardRepository is the minimal repo surface GuardHandler needs.
// Defined as an interface so handler tests can supply a fake without
// a database — the codebase has no pgxmock harness (see prior phase
// memories — vampire_drain_handler / mileage_handler / vehicle_states_handler
// follow the same pattern).
type guardRepository interface {
	VehicleExists(ctx context.Context, vehicleID int64) (bool, error)
	Status(ctx context.Context, vehicleID int64, now time.Time) (database.GuardStatus, error)
	Events(ctx context.Context, vehicleID int64, limit int) ([]database.GuardEvent, error)
	Acknowledge(ctx context.Context, vehicleID, eventID int64, actor string) (database.GuardEvent, error)
}

// guardVehicleResolver looks up the VIN required by tesla.Client.SendCommand.
// The production wiring satisfies this with *database.VehicleRepo; tests
// supply a fake.
type guardVehicleResolver interface {
	GetByID(ctx context.Context, id int64) (*models.Vehicle, error)
}

// guardCommandClient is the narrow tesla.Client surface Panic uses. The
// production type *tesla.Client satisfies this; tests use a fake.
type guardCommandClient interface {
	SendCommand(ctx context.Context, vin string, command string, params map[string]interface{}) error
}

// guardClock is injected so handler tests can pin the 24h window
// boundary. Production wiring leaves it nil and falls through to
// time.Now().UTC().
type guardClock func() time.Time

// GuardHandler serves the four /guard endpoints.
type GuardHandler struct {
	repo                   guardRepository
	vehicles               guardVehicleResolver
	cmd                    guardCommandClient
	authHdr                string
	commandProxyConfigured bool
	clock                  guardClock
}

// NewGuardHandler wires GuardHandler against production dependencies.
//
// commandProxyConfigured is sourced from cfg.Tesla.CommandProxyURL at
// construction (rather than re-read on every Panic request) so the
// 501-vs-attempt decision is stable for the lifetime of the router and
// can be tested without mutating shared config state.
func NewGuardHandler(
	repo *database.GuardRepo,
	vehicles *database.VehicleRepo,
	cmd *tesla.Client,
	cfg *config.Config,
) *GuardHandler {
	return &GuardHandler{
		repo:                   repo,
		vehicles:               vehicles,
		cmd:                    cmd,
		authHdr:                cfg.Auth.ForwardAuthHeader,
		commandProxyConfigured: cfg.Tesla.CommandProxyURL != "",
	}
}

const (
	// guardEventsDefaultLimit mirrors Decision #2 default (100 events).
	guardEventsDefaultLimit = 100
	// guardEventsMaxLimit caps Decision #2 (1000 events). The repo SQL
	// is indexed on (vehicle_id, ts DESC) so 1000 rows fits one
	// chunk-time-interval seek without paging.
	guardEventsMaxLimit = 1000
)

// now returns the injected clock or wall time.
func (h *GuardHandler) now() time.Time {
	if h.clock != nil {
		return h.clock()
	}
	return time.Now().UTC()
}

// parseVehicleID extracts the {vehicleID} chi path parameter as a
// positive int64. Writes the appropriate 4xx and returns ok=false on
// any malformed input.
func (h *GuardHandler) parseVehicleID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := chi.URLParam(r, "vehicleID")
	if raw == "" {
		writeError(w, http.StatusBadRequest, "vehicle_id is required")
		return 0, false
	}
	vid, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || vid <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return 0, false
	}
	return vid, true
}

// Status serves GET /vehicles/{vehicleID}/guard.
//
// 404 when the vehicle is unknown so the SPA can render a "select a
// vehicle" empty state. 200 with sentry_mode_active=false +
// last_state=null when the vehicle exists but has never reported any
// SentryMode transition (a brand-new install or a vehicle that has
// not yet streamed telemetry).
func (h *GuardHandler) Status(w http.ResponseWriter, r *http.Request) {
	vehicleID, ok := h.parseVehicleID(w, r)
	if !ok {
		return
	}

	ctx := r.Context()
	exists, err := h.repo.VehicleExists(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("guard.status: existence probe failed")
		writeError(w, http.StatusInternalServerError, "failed to verify vehicle")
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	status, err := h.repo.Status(ctx, vehicleID, h.now())
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("guard.status: query failed")
		writeError(w, http.StatusInternalServerError, "failed to load guard status")
		return
	}
	writeJSON(w, http.StatusOK, status)
}

// GuardEventsResponse is the envelope returned by Events. Mirrors the
// /vampire-drain envelope shape so the frontend can use the same
// `select: (data) => safeArray(data?.events)` extraction pattern.
type GuardEventsResponse struct {
	VehicleID int64                  `json:"vehicle_id"`
	Events    []database.GuardEvent  `json:"events"`
}

// Events serves GET /vehicles/{vehicleID}/guard/events?limit=N.
//
// Returns 200 with an empty events list for an existing vehicle that
// has no recorded security events; returns 404 for an unknown vehicle
// so the operator can distinguish the two cases.
func (h *GuardHandler) Events(w http.ResponseWriter, r *http.Request) {
	vehicleID, ok := h.parseVehicleID(w, r)
	if !ok {
		return
	}

	limit := guardEventsDefaultLimit
	if l := r.URL.Query().Get("limit"); l != "" {
		v, err := strconv.Atoi(l)
		if err != nil {
			writeError(w, http.StatusBadRequest, "limit must be an integer")
			return
		}
		if v < 1 {
			writeError(w, http.StatusBadRequest, "limit must be >= 1")
			return
		}
		if v > guardEventsMaxLimit {
			// Decision #2 max-cap envelope mirrors the Phase-43a /
			// Prompt 0003+0004+0005 precedent — writeError can't add
			// the `max` field, so we hand-write the JSON.
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": "limit exceeds maximum",
				"max":   guardEventsMaxLimit,
				"code":  httpStatusCode(http.StatusBadRequest),
			})
			return
		}
		limit = v
	}

	ctx := r.Context()
	exists, err := h.repo.VehicleExists(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("guard.events: existence probe failed")
		writeError(w, http.StatusInternalServerError, "failed to verify vehicle")
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	events, err := h.repo.Events(ctx, vehicleID, limit)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Int("limit", limit).Msg("guard.events: query failed")
		writeError(w, http.StatusInternalServerError, "failed to load guard events")
		return
	}
	if events == nil {
		events = []database.GuardEvent{}
	}

	writeJSON(w, http.StatusOK, GuardEventsResponse{
		VehicleID: vehicleID,
		Events:    events,
	})
}

// Acknowledge serves POST /vehicles/{vehicleID}/guard/events/{eventID}/acknowledge.
//
// 404 (with a generic message) when the event id is unknown OR when it
// belongs to a different vehicle — leaking the difference would be an
// authorisation side-channel.
//
// Re-acknowledgement (a second POST against an already-acked row)
// overwrites acknowledged_at + acknowledged_by per the literal SQL in
// Decision #3, so an audit trail of the most-recent operator is
// preserved.
func (h *GuardHandler) Acknowledge(w http.ResponseWriter, r *http.Request) {
	vehicleID, ok := h.parseVehicleID(w, r)
	if !ok {
		return
	}

	eventIDRaw := chi.URLParam(r, "eventID")
	if eventIDRaw == "" {
		writeError(w, http.StatusBadRequest, "event_id is required")
		return
	}
	eventID, err := strconv.ParseInt(eventIDRaw, 10, 64)
	if err != nil || eventID <= 0 {
		writeError(w, http.StatusBadRequest, "event_id must be a positive integer")
		return
	}

	ctx := r.Context()
	// VehicleExists FIRST so a 404 disambiguates "vehicle is unknown"
	// from "vehicle exists but has no event with that id". Both
	// ultimately respond with 404 to the operator, but the log trail
	// distinguishes them for ops triage.
	exists, err := h.repo.VehicleExists(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("guard.ack: existence probe failed")
		writeError(w, http.StatusInternalServerError, "failed to verify vehicle")
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	// actorFromRequest returns "" when no ForwardAuth header is
	// configured (open-mode installs) — store the empty string verbatim
	// rather than fabricating a "system" / "anonymous" identity.
	actor := actorFromRequest(r, h.authHdr)

	updated, err := h.repo.Acknowledge(ctx, vehicleID, eventID, actor)
	if errors.Is(err, database.ErrGuardEventNotFound) {
		writeError(w, http.StatusNotFound, "guard event not found")
		return
	}
	if err != nil {
		log.Error().Err(err).
			Int64("vehicle_id", vehicleID).
			Int64("event_id", eventID).
			Str("actor", actor).
			Msg("guard.ack: update failed")
		writeError(w, http.StatusInternalServerError, "failed to acknowledge guard event")
		return
	}

	writeJSON(w, http.StatusOK, updated)
}

// guardPanicCommands is the fixed sequence Panic dispatches when the
// proxy is configured. sentry_on FIRST so the vehicle starts recording
// and uploading clips before the audible/visible alerts; honk + flash
// last so the dashboard reflects "Sentry on" state regardless of
// whether the operator is in audible range.
var guardPanicCommands = []string{
	"sentry_on",
	"honk_horn",
	"flash_lights",
}

// GuardPanicResponse is returned by Panic on success and on partial
// failure. results lists every command attempted in order; on partial
// failure the failed command's error message is captured and the
// overall HTTP status is 502 so the SPA can render a degraded-success
// banner.
type GuardPanicResponse struct {
	VehicleID int64               `json:"vehicle_id"`
	VIN       string              `json:"vin"`
	Results   []GuardPanicResult  `json:"results"`
}

// GuardPanicResult is one entry in GuardPanicResponse.results.
type GuardPanicResult struct {
	Command string `json:"command"`
	OK      bool   `json:"ok"`
	Error   string `json:"error,omitempty"`
}

// Panic serves POST /vehicles/{vehicleID}/guard/panic.
//
// Behaviour matrix:
//
//	Proxy not configured    → 501 with explicit message; no commands sent.
//	Vehicle unknown         → 404; no commands sent.
//	All commands succeed    → 200 with results=[{ok:true},{ok:true},{ok:true}].
//	Any command fails       → 502 with results capturing per-command status.
//	                          Subsequent commands STILL run so the SPA
//	                          can show which of sentry/honk/flash worked.
//
// Notes on safety:
//
//   - We do NOT persist a row in security_events for the panic event.
//     security_events is the telemetry-derived table; mixing
//     user-initiated commands into it would corrupt every analytic
//     that consumes it. A future "command_log" surface (separate table)
//     is the right home for that audit trail and is out of scope here.
//   - RequireSudo middleware at the router enforces sudo confirmation
//     in production deployments; this handler trusts that the request
//     is authorised by the time it reaches Panic.
func (h *GuardHandler) Panic(w http.ResponseWriter, r *http.Request) {
	vehicleID, ok := h.parseVehicleID(w, r)
	if !ok {
		return
	}

	if !h.commandProxyConfigured {
		// Decision #5 — report 501 BEFORE doing any DB work so an
		// open-mode install where the operator has not configured a
		// command proxy returns a clear actionable error rather than
		// a 200 with an empty results array.
		writeError(w, http.StatusNotImplemented, "Tesla command proxy not configured")
		return
	}

	ctx := r.Context()
	vehicle, err := h.vehicles.GetByID(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("guard.panic: vehicle lookup failed")
		writeError(w, http.StatusInternalServerError, "failed to load vehicle")
		return
	}
	if vehicle == nil {
		writeError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	results := make([]GuardPanicResult, 0, len(guardPanicCommands))
	anyFailure := false
	for _, cmd := range guardPanicCommands {
		err := h.cmd.SendCommand(ctx, vehicle.VIN, cmd, nil)
		if err != nil {
			anyFailure = true
			log.Warn().Err(err).
				Int64("vehicle_id", vehicleID).
				Str("command", cmd).
				Msg("guard.panic: command failed (continuing)")
			results = append(results, GuardPanicResult{
				Command: cmd,
				OK:      false,
				Error:   err.Error(),
			})
			continue
		}
		results = append(results, GuardPanicResult{Command: cmd, OK: true})
	}

	resp := GuardPanicResponse{
		VehicleID: vehicleID,
		VIN:       vehicle.VIN,
		Results:   results,
	}

	if anyFailure {
		// 502 Bad Gateway — the proxy/Tesla rejected at least one
		// command. The body still includes per-command results so the
		// SPA can render which alerts succeeded.
		writeJSON(w, http.StatusBadGateway, resp)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}
