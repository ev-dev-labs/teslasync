package api

import (
	"net/http"
	"sort"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/config"
	teslaconfig "github.com/ev-dev-labs/teslasync/internal/tesla/config"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// FleetTelemetryHandler serves the canonical Fleet Telemetry subscription
// shape and the per-category routing destination map for the Settings /
// Diagnostics pages. It is intentionally read-only and DB-free: the
// "current config" view comes from teslaconfig.Builder (the same
// generator the production subscription path uses) and the routing view
// comes from router.LoadMap() (the embedded routing.yaml).
//
// Phase-42 prompt 0068 introduced this handler to replace the legacy
// fleet_telemetry_subscriptions table query with package-derived state
// (per ADR-004 #2 — the routing layer is the single source of truth for
// "what's actively ingested"). The handler is registered into the chi
// router by a follow-on wiring prompt; this file only owns the methods
// and their JSON contracts.
type FleetTelemetryHandler struct {
	cfg *config.Config
}

// NewFleetTelemetryHandler returns a handler bound to the supplied
// app config so CurrentSubscription can render the same hostname/port
// the production subscription path would push to Tesla.
func NewFleetTelemetryHandler(cfg *config.Config) *FleetTelemetryHandler {
	return &FleetTelemetryHandler{cfg: cfg}
}

// CurrentSubscription returns the canonical Fleet Telemetry subscription
// body the API would currently push to Tesla, sourced from
// teslaconfig.Builder. No DB access — replaces the legacy
// fleet_telemetry_subscriptions table query (phase-42 ADR-004 #2).
//
// GET /api/v1/tesla/fleet-telemetry/subscription
func (h *FleetTelemetryHandler) CurrentSubscription(w http.ResponseWriter, r *http.Request) {
	builder := teslaconfig.NewBuilder()
	if h.cfg != nil {
		if h.cfg.FleetTelemetry.Host != "" {
			builder.Hostname = h.cfg.FleetTelemetry.Host
		}
		if h.cfg.FleetTelemetry.Port != 0 {
			builder.Port = h.cfg.FleetTelemetry.Port
		}
	}
	body, err := builder.BuildSubscription()
	if err != nil {
		log.Error().Err(err).Msg("failed to build fleet telemetry subscription")
		writeError(w, http.StatusInternalServerError, "failed to build subscription")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

// fieldCoverage describes one routed Tesla proto Field for the /coverage
// response. Field is the canonical proto name as emitted by the codec
// (compound flattened children appear by their flattened name, e.g.
// "LocationLatitude"). Subscribed reflects whether teslaconfig.Builder
// would currently include the parent field in the subscription request.
type fieldCoverage struct {
	Field         string `json:"field"`
	Destination   string `json:"destination"`
	Column        string `json:"column,omitempty"`
	AlsoSignalLog bool   `json:"also_signal_log,omitempty"`
	Subscribed    bool   `json:"subscribed"`
}

// categoryCoverage groups routed fields by their protomodel Category.
// Destinations is the count of routed fields per Destination within
// the category (dual-writes to signal_log are counted under signal_log
// too, matching the runtime fan-out semantics).
type categoryCoverage struct {
	Category     string          `json:"category"`
	TotalFields  int             `json:"total_fields"`
	Destinations map[string]int  `json:"destinations"`
	Fields       []fieldCoverage `json:"fields"`
}

// coverageResponse is the per-category routing view served by
// /api/v1/tesla/fleet-telemetry/coverage. OrphanFields is empty in
// healthy deployments — a non-empty list signals a routing.yaml entry
// whose Field name is neither in protomodel.SignalsByName nor a strict
// prefix-extension of a compound parent (i.e. a deployment drift
// between the vendored proto and routing.yaml).
type coverageResponse struct {
	Categories        []categoryCoverage `json:"categories"`
	DestinationTotals map[string]int     `json:"destination_totals"`
	OrphanFields      []string           `json:"orphan_fields,omitempty"`
}

// Coverage returns the per-category routing destination map. The frontend
// uses this to surface "what's actively ingested" — every entry in the
// embedded routing.yaml is keyed by its protomodel Category (or, for
// codec-flattened compound children like "LocationLatitude", the parent
// compound's Category, matching the algorithm in
// internal/tesla/router/coverage_test.go).
//
// The Subscribed flag on each field reflects whether
// teslaconfig.Builder would currently include the field's parent in the
// subscription body. Routed-but-not-subscribed entries indicate a field
// we have a writer for but Tesla is not currently pushing — useful
// signal for the Diagnostics page when investigating "writer registered
// but no rows landing".
//
// GET /api/v1/tesla/fleet-telemetry/coverage
func (h *FleetTelemetryHandler) Coverage(w http.ResponseWriter, r *http.Request) {
	routes, err := router.LoadMap()
	if err != nil {
		log.Error().Err(err).Msg("failed to load routing map")
		writeError(w, http.StatusInternalServerError, "failed to load routing map")
		return
	}

	type parentCat struct {
		name     string
		category string
	}
	var compoundParents []parentCat
	for i := range protomodel.Signals {
		s := &protomodel.Signals[i]
		if s.IsCompound {
			compoundParents = append(compoundParents, parentCat{name: s.Field, category: s.Category})
		}
	}

	subscribed := make(map[string]struct{})
	for _, fe := range teslaconfig.NewBuilder().SubscriptionFields() {
		subscribed[fe.Name] = struct{}{}
	}

	perCategoryFields := map[string][]fieldCoverage{}
	perCategoryDest := map[string]map[string]int{}
	destTotals := map[string]int{}
	var orphans []string

	for field, entry := range routes {
		category := ""
		if meta, ok := protomodel.SignalsByName[field]; ok && meta != nil {
			category = meta.Category
		} else {
			for _, p := range compoundParents {
				if len(field) > len(p.name) && strings.HasPrefix(field, p.name) {
					category = p.category
					break
				}
			}
		}
		if category == "" {
			orphans = append(orphans, field)
			continue
		}

		// A flattened compound child inherits its subscription from
		// the compound parent (Tesla subscribes to "Location", the
		// codec emits "LocationLatitude" et al.).
		isSubscribed := false
		if _, ok := subscribed[field]; ok {
			isSubscribed = true
		} else {
			for _, p := range compoundParents {
				if len(field) > len(p.name) && strings.HasPrefix(field, p.name) {
					if _, ok := subscribed[p.name]; ok {
						isSubscribed = true
					}
					break
				}
			}
		}

		perCategoryFields[category] = append(perCategoryFields[category], fieldCoverage{
			Field:         field,
			Destination:   string(entry.Destination),
			Column:        entry.Column,
			AlsoSignalLog: entry.ToColdLogToo,
			Subscribed:    isSubscribed,
		})
		if _, ok := perCategoryDest[category]; !ok {
			perCategoryDest[category] = map[string]int{}
		}
		perCategoryDest[category][string(entry.Destination)]++
		destTotals[string(entry.Destination)]++
		if entry.ToColdLogToo && entry.Destination != router.DestSignalLog {
			perCategoryDest[category][string(router.DestSignalLog)]++
			destTotals[string(router.DestSignalLog)]++
		}
	}

	cats := make([]categoryCoverage, 0, len(perCategoryFields))
	for cat, fields := range perCategoryFields {
		sort.Slice(fields, func(i, j int) bool { return fields[i].Field < fields[j].Field })
		cats = append(cats, categoryCoverage{
			Category:     cat,
			TotalFields:  len(fields),
			Destinations: perCategoryDest[cat],
			Fields:       fields,
		})
	}
	sort.Slice(cats, func(i, j int) bool { return cats[i].Category < cats[j].Category })
	sort.Strings(orphans)

	writeJSON(w, http.StatusOK, coverageResponse{
		Categories:        cats,
		DestinationTotals: destTotals,
		OrphanFields:      orphans,
	})
}
