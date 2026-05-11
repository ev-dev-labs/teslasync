// Phase-43a / Prompt 0007 — SignalsCatalogHandler restores the
// /signals/catalog + /signals/observations endpoints deleted by
// Phase-42 prompt 0077, backed by routing.yaml (catalog spine) +
// signal_log (mig 000186, aggregates + observations).
//
// Frontend hooks (still pointed at these URLs, currently 404ing):
//
//   - useSignalCatalog       (web/src/api/hooks/useTelemetry.ts L254)
//   - useSignalObservations  (web/src/api/hooks/useTelemetry.ts L273)
//
// Response shapes follow the prompt-locked decisions; the legacy
// frontend types in web/src/types/signals.ts (SignalCatalogEntry +
// SignalObservation) describe the dropped endpoint and will need a
// follow-up update outside this prompt's allowed-files boundary.
// The 404 -> 200 transition is the win this prompt ships.
package api

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// signalsCatalogRepository is the minimal repo surface
// SignalsCatalogHandler needs. Defined as an interface so the handler
// tests can supply a fake without spinning up a database — the codebase
// has no pgxmock harness (see repo memories from earlier phase-43a
// prompts).
type signalsCatalogRepository interface {
	CatalogAggregates(ctx context.Context) (map[string]database.CatalogAggregate, error)
	ObservationsCount(ctx context.Context, params database.ObservationsParams) (int64, error)
	Observations(ctx context.Context, params database.ObservationsParams) ([]database.SignalObservation, error)
}

// signalsCatalogClock is injected so handler tests can pin
// generated_at; production wiring leaves it nil and falls through to
// time.Now().UTC().
type signalsCatalogClock func() time.Time

// SignalsCatalogHandler serves the two endpoints. The routing.yaml
// entries are parsed once at construction (per Decision #6 — the
// catalog is read-heavy and the underlying YAML changes only when a
// new Tesla firmware bumps the proto, both of which require a process
// restart anyway).
type SignalsCatalogHandler struct {
	repo    signalsCatalogRepository
	entries []router.Entry
	clock   signalsCatalogClock
}

// NewSignalsCatalogHandler binds the handler to a repo and parses the
// embedded routing.yaml via router.Load(). Panics on parse failure
// because every other consumer of router.Load() does the same — a
// malformed embedded YAML is a compile-equivalent bug, not a runtime
// condition.
func NewSignalsCatalogHandler(repo *database.SignalsCatalogRepo) *SignalsCatalogHandler {
	entries, err := router.Load()
	if err != nil {
		panic(fmt.Sprintf("api.NewSignalsCatalogHandler: parse embedded routing.yaml: %v", err))
	}
	return &SignalsCatalogHandler{repo: repo, entries: entries}
}

// signalsCatalogLimitDefault and signalsCatalogLimitMax cap the
// observations page size per Decision #4. The default mirrors the
// legacy /observations endpoint behaviour the frontend was built
// against; the max cap keeps the WHERE-less probe bounded so an
// admin's "Load all" misclick can't run a 100M-row scan.
const (
	signalsCatalogLimitDefault = 100
	signalsCatalogLimitMax     = 1000
)

// SignalCatalogEntryView is one row in the catalog response. Snake-case
// JSON tags so the frontend hooks can read either camelCaseKeys-
// transformed or original keys per project convention.
//
// LastSeenAt + counts are pointer types because routed-but-unobserved
// signals must serialise as JSON null (not zero), so the consumer can
// tell "no rows yet" from "1 row at the unix epoch".
type SignalCatalogEntryView struct {
	Field            string     `json:"field"`
	Destination      string     `json:"destination"`
	ValueKind        string     `json:"value_kind"`
	LastSeenAt       *time.Time `json:"last_seen_at"`
	SampleCountTotal *int64     `json:"sample_count_total"`
	VehicleCount     *int64     `json:"vehicle_count"`
}

// SignalsCatalogResponse is the envelope returned by Catalog.
type SignalsCatalogResponse struct {
	Signals     []SignalCatalogEntryView `json:"signals"`
	GeneratedAt time.Time                `json:"generated_at"`
}

// SignalObservationView is one row in the observations response. The
// repo's database.SignalObservation carries a ValueKind ordinal; we
// re-emit it as the protomodel.ValueKind symbolic string so consumers
// match against stable names rather than numeric tags.
type SignalObservationView struct {
	VehicleID int64     `json:"vehicle_id"`
	Ts        time.Time `json:"ts"`
	Field     string    `json:"field"`
	ValueKind string    `json:"value_kind"`
	Value     any       `json:"value"`
}

// SignalsObservationsResponse is the envelope returned by Observations.
// `count` is the page row count; `total` is the matching row count
// across the entire signal_log under the same WHERE clause.
type SignalsObservationsResponse struct {
	Count        int                     `json:"count"`
	Total        int64                   `json:"total"`
	Observations []SignalObservationView `json:"observations"`
}

// Catalog serves GET /signals/catalog.
//
// Returns 200 with {signals: [...], generated_at} including every
// routing.yaml entry — routed-but-unobserved fields surface with
// last_seen_at=null and the count fields=null. Sort order is field
// ASC for stable rendering across requests.
func (h *SignalsCatalogHandler) Catalog(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	aggregates, err := h.repo.CatalogAggregates(ctx)
	if err != nil {
		log.Error().Err(err).Msg("signals_catalog.catalog: aggregate query failed")
		writeError(w, http.StatusInternalServerError, "failed to load catalog aggregates")
		return
	}

	out := make([]SignalCatalogEntryView, 0, len(h.entries))
	for _, e := range h.entries {
		view := SignalCatalogEntryView{
			Field:       e.Field,
			Destination: string(e.Destination),
			ValueKind:   lookupValueKindString(e.Field),
		}
		if agg, ok := aggregates[e.Field]; ok {
			view.LastSeenAt = agg.LastSeenAt
			sample := agg.SampleCountTotal
			vehicle := agg.VehicleCount
			view.SampleCountTotal = &sample
			view.VehicleCount = &vehicle
		}
		out = append(out, view)
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].Field < out[j].Field
	})

	writeJSON(w, http.StatusOK, SignalsCatalogResponse{
		Signals:     out,
		GeneratedAt: h.now(),
	})
}

// Observations serves GET /signals/observations?...
//
// Filters (all optional, snake_case):
//
//	vehicle_id   comma-separated bigints
//	field        comma-separated field names
//	since        RFC3339 lower bound on ts (inclusive)
//	until        RFC3339 upper bound on ts (inclusive)
//	limit        default 100, max 1000
//	offset       default 0
//
// Returns 200 with {count, total, observations: [...]}.
func (h *SignalsCatalogHandler) Observations(w http.ResponseWriter, r *http.Request) {
	params, ok := h.parseObservationsParams(w, r)
	if !ok {
		return
	}

	ctx := r.Context()

	total, err := h.repo.ObservationsCount(ctx, params)
	if err != nil {
		log.Error().Err(err).Msg("signals_catalog.observations: count query failed")
		writeError(w, http.StatusInternalServerError, "failed to load observations count")
		return
	}

	rows, err := h.repo.Observations(ctx, params)
	if err != nil {
		log.Error().Err(err).Msg("signals_catalog.observations: select query failed")
		writeError(w, http.StatusInternalServerError, "failed to load observations")
		return
	}

	out := make([]SignalObservationView, 0, len(rows))
	for _, o := range rows {
		out = append(out, SignalObservationView{
			VehicleID: o.VehicleID,
			Ts:        o.Ts,
			Field:     o.Field,
			ValueKind: protomodel.ValueKind(o.ValueKind).String(),
			Value:     o.Value,
		})
	}

	writeJSON(w, http.StatusOK, SignalsObservationsResponse{
		Count:        len(out),
		Total:        total,
		Observations: out,
	})
}

// parseObservationsParams extracts and validates the optional filter
// set from the query string. Returns ok=false after writing the
// appropriate 4xx response so the caller can early-return.
func (h *SignalsCatalogHandler) parseObservationsParams(w http.ResponseWriter, r *http.Request) (database.ObservationsParams, bool) {
	q := r.URL.Query()
	var params database.ObservationsParams

	// vehicle_id (comma-separated bigints).
	if raw := q.Get("vehicle_id"); raw != "" {
		ids, err := parseCSVInt64s(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "vehicle_id must be a comma-separated list of positive integers")
			return database.ObservationsParams{}, false
		}
		params.VehicleIDs = ids
	}

	// field (comma-separated; trimmed; empty entries dropped).
	if raw := q.Get("field"); raw != "" {
		fields := splitCSVTrimmed(raw)
		if len(fields) == 0 {
			writeError(w, http.StatusBadRequest, "field must be a comma-separated list of field names")
			return database.ObservationsParams{}, false
		}
		params.Fields = fields
	}

	// since (RFC3339).
	if raw := q.Get("since"); raw != "" {
		ts, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "since must be an RFC3339 timestamp")
			return database.ObservationsParams{}, false
		}
		params.Since = &ts
	}

	// until (RFC3339).
	if raw := q.Get("until"); raw != "" {
		ts, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "until must be an RFC3339 timestamp")
			return database.ObservationsParams{}, false
		}
		params.Until = &ts
	}

	// limit (default 100, max 1000 per Decision #4).
	params.Limit = signalsCatalogLimitDefault
	if raw := q.Get("limit"); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "limit must be an integer")
			return database.ObservationsParams{}, false
		}
		if v < 1 {
			writeError(w, http.StatusBadRequest, "limit must be >= 1")
			return database.ObservationsParams{}, false
		}
		if v > signalsCatalogLimitMax {
			// Decision #4 envelope mirroring vehicle_states / mileage
			// precedent: structured `{error, max, code}` payload that
			// the frontend can surface verbatim.
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": "limit exceeds maximum",
				"max":   signalsCatalogLimitMax,
				"code":  httpStatusCode(http.StatusBadRequest),
			})
			return database.ObservationsParams{}, false
		}
		params.Limit = v
	}

	// offset (default 0).
	if raw := q.Get("offset"); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "offset must be an integer")
			return database.ObservationsParams{}, false
		}
		if v < 0 {
			writeError(w, http.StatusBadRequest, "offset must be >= 0")
			return database.ObservationsParams{}, false
		}
		params.Offset = v
	}

	return params, true
}

// now returns the injected clock or wall time.
func (h *SignalsCatalogHandler) now() time.Time {
	if h.clock != nil {
		return h.clock()
	}
	return time.Now().UTC()
}

// lookupValueKindString resolves a routing.yaml field name to its
// protomodel ValueKind symbolic name. Returns ValueKindUnknown's name
// when the field has no protomodel counterpart (none today, but
// defensively handled for forward-compat with future routing entries
// that lead protomodel by one prompt).
func lookupValueKindString(field string) string {
	if meta, ok := protomodel.SignalsByName[field]; ok && meta != nil {
		return meta.ValueKind.String()
	}
	return protomodel.ValueKindUnknown.String()
}

// parseCSVInt64s splits a comma-separated string into a slice of
// positive int64s. Returns an error on any invalid or non-positive
// entry — vehicle_id 0 is reserved by the codebase for "unset" and
// must not appear as a valid filter.
func parseCSVInt64s(raw string) ([]int64, error) {
	parts := splitCSVTrimmed(raw)
	if len(parts) == 0 {
		return nil, fmt.Errorf("no values")
	}
	out := make([]int64, 0, len(parts))
	for _, p := range parts {
		v, err := strconv.ParseInt(p, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("parse %q: %w", p, err)
		}
		if v <= 0 {
			return nil, fmt.Errorf("non-positive value %d", v)
		}
		out = append(out, v)
	}
	return out, nil
}

// splitCSVTrimmed splits a comma-separated string and drops
// empty / whitespace-only entries so callers don't fan out an
// "empty filter" into the WHERE clause.
func splitCSVTrimmed(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
