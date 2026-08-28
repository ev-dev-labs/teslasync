package v1

// Fleet batch current-state handler (ADR-009 canonical home).
//
// GET /api/v1/vehicles/states replaces the SPA's per-vehicle fan-out with a
// single request. The route is a NOUN under /vehicles and is registered as a
// STATIC segment inside the existing /vehicles group, so chi's trie resolves
// it ahead of the /vehicles/{vehicleID} parameter node (same shape as the
// pre-existing /vehicles/sync route).

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"

	"github.com/ev-dev-labs/teslasync/internal/app/fleetstatesvc"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// maxRequestedVehicleIDs caps the `vehicle_ids` filter. A client cannot make
// the server parse an unbounded list, and the cap is above MaxLimit so a
// caller never silently loses ids it would have been allowed to page through.
const maxRequestedVehicleIDs = fleetstatesvc.MaxLimit

// FleetStateHandler serves the fleet-wide batch current-state read.
type FleetStateHandler struct {
	svc          *fleetstatesvc.Service
	observeBatch func(time.Time, []metrics.FleetStateMetricObservation)
}

// NewFleetStateHandler wires the handler.
func NewFleetStateHandler(svc *fleetstatesvc.Service) *FleetStateHandler {
	return &FleetStateHandler{
		svc:          svc,
		observeBatch: metrics.ObserveFleetStateBatch,
	}
}

// List returns the current state of every requested vehicle in one response.
//
// Query parameters (snake_case, matching every other endpoint):
//
//	vehicle_ids — optional CSV of positive int64 ids. Omitted = whole fleet.
//	limit       — 1..500, default 200.
//	offset      — >= 0, default 0.
func (h *FleetStateHandler) List(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.vehicles.states")
	defer span.End()

	query, ok := parseFleetStateQuery(w, r)
	if !ok {
		return
	}
	span.SetAttributes(
		attribute.Int("fleet.requested_ids", len(query.VehicleIDs)),
		attribute.Int("fleet.limit", query.Limit),
		attribute.Int("fleet.offset", query.Offset),
	)

	batch, err := h.svc.FleetStates(ctx, query)
	if errors.Is(err, fleetstatesvc.ErrNotConfigured) {
		span.SetStatus(codes.Error, "not configured")
		httputil.RespondError(w, http.StatusServiceUnavailable, "SUBSYSTEM_NOT_CONFIGURED",
			"fleet state subsystem not configured on this deployment")
		return
	}
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "fleet state read failed")
		// Never surface the driver/context error text; it is already logged
		// and recorded on the span with full context.
		httputil.RespondError(w, http.StatusInternalServerError, "FLEET_STATE_FAILED",
			"failed to read fleet state")
		return
	}

	span.SetAttributes(
		attribute.Int("fleet.total", batch.Total),
		attribute.Int("fleet.resolved", batch.Counts.Resolved),
		attribute.Int("fleet.missing", batch.Counts.Missing),
		attribute.Int("fleet.failed", batch.Counts.Failed),
		attribute.Int("fleet.verified", batch.Summary.VerifiedCount),
		attribute.Int("fleet.attention", batch.Summary.AttentionCount),
	)
	h.observeFleetStateBatch(batch)
	httputil.Respond(w, http.StatusOK, batch)
}

func (h *FleetStateHandler) observeFleetStateBatch(batch *fleetstatesvc.Batch) {
	if h == nil || h.observeBatch == nil || batch == nil {
		return
	}
	observations := make([]metrics.FleetStateMetricObservation, 0, len(batch.Vehicles))
	for i := range batch.Vehicles {
		item := &batch.Vehicles[i]
		evidence := fleetstatesvc.EvidenceOutcomeFor(item, batch.Now)
		observation := metrics.FleetStateMetricObservation{
			VehicleID: item.VehicleID,
			Verified:  evidence == fleetstatesvc.EvidenceVerified,
			Reason:    string(evidence),
		}
		if item.ObservedAt != nil {
			observation.ObservedAt = item.ObservedAt.UTC()
		}
		observations = append(observations, observation)
	}
	h.observeBatch(batch.Now, observations)
}

// parseFleetStateQuery validates every input at the handler boundary and
// writes the 400 itself. Returns ok=false when a response has been written.
//
// # Scope
//
// The query is stamped with fleetstatesvc.ScopeGlobalRoster. This deployment
// serves ONE global roster: the roster read has no tenant/owner predicate and
// /api/v1/* is gated by an all-or-nothing ForwardAuth (ADR-005), so every
// authenticated caller is entitled to the same answer to the same normalized
// question. The field is stamped explicitly — rather than left empty — so that
// introducing a tenant dimension is a compile-visible change here, and so the
// coalescing key can never mix two scopes' vehicles.
func parseFleetStateQuery(w http.ResponseWriter, r *http.Request) (fleetstatesvc.Query, bool) {
	params := r.URL.Query()
	out := fleetstatesvc.Query{
		Scope:  fleetstatesvc.ScopeGlobalRoster,
		Limit:  fleetstatesvc.DefaultLimit,
		Offset: 0,
	}

	if raw := strings.TrimSpace(params.Get("vehicle_ids")); raw != "" {
		parts := strings.Split(raw, ",")
		if len(parts) > maxRequestedVehicleIDs {
			httputil.RespondError(w, http.StatusBadRequest, "INVALID_VEHICLE_IDS",
				"vehicle_ids accepts at most "+strconv.Itoa(maxRequestedVehicleIDs)+" ids")
			return out, false
		}
		seen := make(map[int64]struct{}, len(parts))
		ids := make([]int64, 0, len(parts))
		for _, part := range parts {
			trimmed := strings.TrimSpace(part)
			if trimmed == "" {
				continue
			}
			id, err := strconv.ParseInt(trimmed, 10, 64)
			if err != nil || id <= 0 {
				httputil.RespondError(w, http.StatusBadRequest, "INVALID_VEHICLE_IDS",
					"vehicle_ids must be a comma-separated list of positive integers")
				return out, false
			}
			if _, dup := seen[id]; dup {
				continue
			}
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
		out.VehicleIDs = ids
	}

	if raw := strings.TrimSpace(params.Get("limit")); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit <= 0 || limit > fleetstatesvc.MaxLimit {
			httputil.RespondError(w, http.StatusBadRequest, "INVALID_LIMIT",
				"limit must be between 1 and "+strconv.Itoa(fleetstatesvc.MaxLimit))
			return out, false
		}
		out.Limit = limit
	}

	if raw := strings.TrimSpace(params.Get("offset")); raw != "" {
		offset, err := strconv.Atoi(raw)
		if err != nil || offset < 0 {
			httputil.RespondError(w, http.StatusBadRequest, "INVALID_OFFSET",
				"offset must be zero or greater")
			return out, false
		}
		out.Offset = offset
	}

	return out, true
}
