// GuardHandler serves guard status, events, acknowledge, and panic routes.
//
// Sentry status intentionally reads security_events because SentryMode is
// routed there by routing.yaml, and acknowledge returns generic 404s to avoid
// cross-vehicle event enumeration. Panic sends sentry_on before honk/flash and
// relies on router-level auth/sudo enforcement.
package guard

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/config"
	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// guardRepository is narrow so handler tests can use fakes without a database.
type guardRepository interface {
	VehicleExists(ctx context.Context, vehicleID int64) (bool, error)
	Status(ctx context.Context, vehicleID int64, now time.Time) (systemdb.GuardStatus, error)
	Events(ctx context.Context, vehicleID int64, limit int) ([]systemdb.GuardEvent, error)
	Acknowledge(ctx context.Context, vehicleID, eventID int64, actor string) (systemdb.GuardEvent, error)
}

// guardVehicleResolver looks up the VIN required by tesla.Client.SendCommand.
// The production wiring satisfies this with *vehicledb.VehicleRepo; tests
// supply a fake.
type guardVehicleResolver interface {
	GetByID(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error)
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
// construction (rather than re-read on every Panic request) so the choice
// between returning 501 and attempting the command is stable for the
// lifetime of the router and can be tested without mutating shared config state.
func NewGuardHandler(
	repo *systemdb.GuardRepo,
	vehicles *vehicledb.VehicleRepo,
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

func actorFromRequest(r *http.Request, headerName string) string {
	if r == nil || headerName == "" {
		return ""
	}
	return strings.TrimSpace(r.Header.Get(headerName))
}

// parseVehicleID extracts the {vehicleID} chi path parameter as a
// positive int64. Writes the appropriate 4xx and returns ok=false on
// any malformed input.
func (h *GuardHandler) parseVehicleID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := chi.URLParam(r, "vehicleID")
	if raw == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required")
		return 0, false
	}
	vid, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || vid <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
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
		httpx.WriteError(w, http.StatusInternalServerError, "failed to verify vehicle")
		return
	}
	if !exists {
		httpx.WriteError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	status, err := h.repo.Status(ctx, vehicleID, h.now())
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("guard.status: query failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load guard status")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, status)
}

// GuardEventsResponse is the envelope returned by Events. Mirrors the
// /vampire-drain envelope shape so the frontend can use the same
// `select: (data) => safeArray(data?.events)` extraction pattern.
type GuardEventsResponse struct {
	VehicleID int64                 `json:"vehicle_id"`
	Events    []systemdb.GuardEvent `json:"events"`
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
			httpx.WriteError(w, http.StatusBadRequest, "limit must be an integer")
			return
		}
		if v < 1 {
			httpx.WriteError(w, http.StatusBadRequest, "limit must be >= 1")
			return
		}
		if v > guardEventsMaxLimit {
			// writeError can't add the `max` field, so hand-write the
			// max-cap envelope JSON.
			httpx.WriteJSON(w, http.StatusBadRequest, map[string]any{
				"error": "limit exceeds maximum",
				"max":   guardEventsMaxLimit,
				"code":  httpx.HTTPStatusCode(http.StatusBadRequest),
			})
			return
		}
		limit = v
	}

	ctx := r.Context()
	exists, err := h.repo.VehicleExists(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("guard.events: existence probe failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to verify vehicle")
		return
	}
	if !exists {
		httpx.WriteError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	events, err := h.repo.Events(ctx, vehicleID, limit)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Int("limit", limit).Msg("guard.events: query failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load guard events")
		return
	}
	if events == nil {
		events = []systemdb.GuardEvent{}
	}

	httpx.WriteJSON(w, http.StatusOK, GuardEventsResponse{
		VehicleID: vehicleID,
		Events:    events,
	})
}

// Acknowledge serves POST /vehicles/{vehicleID}/guard/events/{eventID}/acknowledge.
// Unknown and cross-vehicle event IDs both return 404 to avoid an authorization
// side channel. Re-acknowledgement records the most recent operator.
func (h *GuardHandler) Acknowledge(w http.ResponseWriter, r *http.Request) {
	vehicleID, ok := h.parseVehicleID(w, r)
	if !ok {
		return
	}

	eventIDRaw := chi.URLParam(r, "eventID")
	if eventIDRaw == "" {
		httpx.WriteError(w, http.StatusBadRequest, "event_id is required")
		return
	}
	eventID, err := strconv.ParseInt(eventIDRaw, 10, 64)
	if err != nil || eventID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "event_id must be a positive integer")
		return
	}

	ctx := r.Context()
	// Probe the vehicle first so logs can distinguish vehicle misses from event misses.
	exists, err := h.repo.VehicleExists(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("guard.ack: existence probe failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to verify vehicle")
		return
	}
	if !exists {
		httpx.WriteError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	// In open mode, store the empty actor instead of inventing an identity.
	actor := actorFromRequest(r, h.authHdr)

	updated, err := h.repo.Acknowledge(ctx, vehicleID, eventID, actor)
	if errors.Is(err, systemdb.ErrGuardEventNotFound) {
		httpx.WriteError(w, http.StatusNotFound, "guard event not found")
		return
	}
	if err != nil {
		log.Error().Err(err).
			Int64("vehicle_id", vehicleID).
			Int64("event_id", eventID).
			Str("actor", actor).
			Msg("guard.ack: update failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to acknowledge guard event")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, updated)
}

// guardPanicCommands starts Sentry before audible/visible alerts so recording
// is active even if honk or flash later fails.
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
	VehicleID int64              `json:"vehicle_id"`
	VIN       string             `json:"vin"`
	Results   []GuardPanicResult `json:"results"`
}

// GuardPanicResult is one entry in GuardPanicResponse.results.
type GuardPanicResult struct {
	Command string `json:"command"`
	OK      bool   `json:"ok"`
	Error   string `json:"error,omitempty"`
}

// Panic serves POST /vehicles/{vehicleID}/guard/panic. It keeps running later
// commands after a failure so the SPA can show which of sentry/honk/flash
// worked. It does not write security_events because that table is
// telemetry-derived; command audit belongs in a future separate surface.
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
		httpx.WriteError(w, http.StatusNotImplemented, "Tesla command proxy not configured")
		return
	}

	ctx := r.Context()
	vehicle, err := h.vehicles.GetByID(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("guard.panic: vehicle lookup failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load vehicle")
		return
	}
	if vehicle == nil {
		httpx.WriteError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	results := make([]GuardPanicResult, 0, len(guardPanicCommands))
	anyFailure := false
	for _, cmd := range guardPanicCommands {
		err := h.cmd.SendCommand(ctx, vehicle.VIN, cmd, nil)
		if err != nil {
			// Fleet API daily budget errors are systemic, not per-command:
			// the same shared budget will reject every remaining command in
			// this loop identically, so continuing would just spend time
			// re-deriving a 502 that hides the real cause. Abort immediately
			// and surface the structured 429/503 status instead.
			if failure, matched := httpx.ClassifyTeslaBudgetError(err); matched {
				log.Warn().Err(err).
					Int64("vehicle_id", vehicleID).
					Str("command", cmd).
					Msg("guard.panic: Fleet API budget constraint — aborting remaining commands")
				httpx.WriteError(w, failure.StatusCode, failure.Message)
				return
			}
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
		httpx.WriteJSON(w, http.StatusBadGateway, resp)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
}
