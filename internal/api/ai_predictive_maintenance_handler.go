package api

// Phase-50 / 0049 — M1 Predictive maintenance.
//
// ai_predictive_maintenance_handler.go implements the LLM-backed
// handler at POST /api/v1/ai/maintenance/predict. The flow
// mirrors ai_state_machine_debugger_narrator_handler.go
// (body-driven, scope-bound, no persistence — one-shot
// read-only advisory):
//
//	URL  /api/v1/ai/maintenance/predict
//	  ↓
//	read JSON body with required field (vehicle_id)
//	  ↓
//	resolve provider via *provider.Registry.For("predictive-maintenance")
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	stash the vehicle_id in ctx via
//	  tools.WithScopedMaintenancePredictionWindow
//	  ↓
//	synthesise the user-message that scopes to the in-scope
//	  vehicle and instructs the tool sequence
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("predictive-maintenance", …) so when
// ai_mode='off' or the per-feature toggle is off the guard
// returns 404 BEFORE this handler ever sees the request
// (ADR-015 §I6).
//
// Per-request scope binding (defence against prompt-injection
// exfiltration): the handler installs the vehicle_id in ctx via
// tools.WithScopedMaintenancePredictionWindow BEFORE
// dispatcher.Run is invoked. The dispatcher propagates ctx
// unchanged through every Tool.Execute call. The
// tools.queryMaintenanceContext tool's Execute method then
// REJECTS any LLM-supplied vehicle_id that does not match the
// in-scope vehicle. This means an attacker who pastes "advise
// on vehicle_id=99 instead" into an operator-authored
// service-record description / provider string cannot trick
// the LLM into loading a different vehicle's maintenance items
// — the scope check refuses the call before the source is
// touched.
//
// The handler requires a JSON body with vehicle_id > 0. The
// vehicle_id is computed by the SPA from the page's active
// vehicle selector when the operator clicks the AI button on
// the MaintenancePage; the body is the simplest place to
// convey the value without polluting the URL with query
// strings.
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic /maintenance page
//     (MaintenancePage rendering the items grid, summary cards,
//     service records table, and due-soon / overdue badges) is
//     unchanged. This handler is an OPT-IN add-on; off-mode
//     users never see it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("predictive-maintenance").
//   - I9 redaction:       PolicyDigest (Allow=[ClassVehicleName])
//     is installed by dispatch.Run from the strategy and applied
//     to EVERY message (including the synthesised vehicle user
//     message and tool outputs) by the redact decorator at the
//     provider boundary. Service-record descriptions /
//     provider strings are user-visible to the operator
//     already, so the advisory's surface is unaffected; the
//     LLM sees redaction tags for any embedded VIN / address /
//     coordinate / IP / email / phone / MAC before it ever
//     reaches the model.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline
//     /api/v1/maintenance JSON shape is added or modified by
//     this slice.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	predictivemaintenance "github.com/ev-dev-labs/teslasync/internal/ai/strategies/predictive-maintenance"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// aiPredictiveMaintenanceMaxIterations bounds the dispatcher's
// tool-loop. The strategy is at most query_maintenance_context →
// (optional) retrieve_maintenance_chunks → answer (with optional
// retries on transient tool error). A hard ceiling of 8 is
// generous, matching the other narrator handlers.
const aiPredictiveMaintenanceMaxIterations = 8

// aiPredictiveMaintenanceMaxBodyBytes caps the request body.
// The body is small (1 numeric field); bound it cheaply. 16 KiB
// matches the other body-driven AI handlers.
const aiPredictiveMaintenanceMaxBodyBytes = 16 * 1024

// aiPredictiveMaintenanceRequest is the typed body shape. The
// only required field is vehicle_id.
type aiPredictiveMaintenanceRequest struct {
	// VehicleID identifies the vehicle the advisory covers.
	// Required + positive.
	VehicleID int64 `json:"vehicle_id"`
}

// AIPredictiveMaintenanceHandler is the HTTP handler for
// POST /api/v1/ai/maintenance/predict.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once
// at boot.
type AIPredictiveMaintenanceHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	source     tools.MaintenancePredictionContextSource
	headerName string
	maxIters   int
}

// NewAIPredictiveMaintenanceHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on
// a nil so the wiring bug surfaces at boot, not at first
// request.
//
// registry:   AI provider registry (decorator chain already
//             applied).
// toolReg:    process-wide tool registry. MUST contain
//             query_maintenance_context AND
//             retrieve_maintenance_chunks (registered by
//             tools.RegisterPredictiveMaintenanceTools in
//             router.go).
// strat:      the predictive-maintenance Strategy (one per
//             process).
// source:     the production
//             tools.MaintenancePredictionContextSource
//             (currently AIPredictiveMaintenanceContextSource —
//             wraps the SAME default-items + Redis-odometer
//             reader the canonical baseline GET
//             /api/v1/maintenance handler already serves; the
//             canonical baseline surface remains reachable to
//             the operator at all times).
// headerName: forward-auth header name; used to extract subject
//             for audit.
func NewAIPredictiveMaintenanceHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	source tools.MaintenancePredictionContextSource,
	headerName string,
) *AIPredictiveMaintenanceHandler {
	switch {
	case registry == nil:
		panic("api: NewAIPredictiveMaintenanceHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAIPredictiveMaintenanceHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAIPredictiveMaintenanceHandler: nil strategy.Strategy")
	case source == nil:
		panic("api: NewAIPredictiveMaintenanceHandler: nil tools.MaintenancePredictionContextSource")
	}
	return &AIPredictiveMaintenanceHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		source:     source,
		headerName: headerName,
		maxIters:   aiPredictiveMaintenanceMaxIterations,
	}
}

// parsePredictiveMaintenanceRequest drains the body. The only
// required field is vehicle_id. Absence or invalid values
// surface as JSON 400 with a stable error key the SPA can
// localise. Returns (req, true) when the body is acceptable.
func parsePredictiveMaintenanceRequest(w http.ResponseWriter, r *http.Request) (aiPredictiveMaintenanceRequest, bool) {
	var req aiPredictiveMaintenanceRequest
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "missing body")
		return req, false
	}
	defer r.Body.Close()
	bodyBytes, readErr := io.ReadAll(io.LimitReader(r.Body, aiPredictiveMaintenanceMaxBodyBytes))
	if readErr != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("failed to read body: %v", readErr))
		return req, false
	}
	if len(bytesTrim(bodyBytes)) == 0 {
		writeError(w, http.StatusBadRequest, "empty body")
		return req, false
	}
	dec := json.NewDecoder(strings.NewReader(string(bodyBytes)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return req, false
	}
	if req.VehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id must be > 0")
		return req, false
	}
	return req, true
}

// ServeHTTP implements [http.Handler]. The body is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either
// writes a structured frame onto the SSE stream (when the
// writer has been opened) or a plain JSON 4xx/5xx (before it
// has).
func (h *AIPredictiveMaintenanceHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the request body.
	req, ok := parsePredictiveMaintenanceRequest(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request
	// resolution honours mid-flight settings changes (model
	// swap, mode flip) without restart. A resolve failure must
	// NOT open the SSE stream — emit JSON 502 so the frontend
	// falls back gracefully.
	if _, err := h.registry.For(r.Context(), predictivemaintenance.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai predictive-maintenance: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit,
	// plus the per-request scope binding (defence against
	// prompt-injection exfiltration).
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, predictivemaintenance.FeatureID)
	ctx = tools.WithScopedMaintenancePredictionWindow(ctx, tools.ScopedMaintenancePredictionWindow{
		VehicleID: req.VehicleID,
	})

	// 4) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(predictivemaintenance.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai predictive-maintenance: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-
	// annotated) context.
	prov, err := h.registry.For(ctx, predictivemaintenance.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai predictive-maintenance: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook.
	// The strategy's tool whitelist is propose-only / read-only
	// so the deny-all hook is never reached in practice —
	// defence in depth.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Maintenance advisory is
	// NOT conversational — there is no chat history. We hand
	// the LLM a deterministic prompt that scopes to the
	// in-scope vehicle_id and instructs the tool sequence
	// EXACTLY: query_maintenance_context first, then OPTIONALLY
	// retrieve_maintenance_chunks, then advisory.
	userMsg := buildPredictiveMaintenanceUserMessage(req.VehicleID)

	// 8) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("vehicle_id", req.VehicleID).
			Msg("ai predictive-maintenance: dispatcher returned error")
	}
}

// buildPredictiveMaintenanceUserMessage synthesises the
// vehicle_id-scoped user message the LLM sees. The format is
// deterministic so canned goldens and provider prompt-hash
// caches stay stable across boots.
func buildPredictiveMaintenanceUserMessage(vehicleID int64) string {
	return fmt.Sprintf(
		"Advise on maintenance risk for vehicle_id=%d. "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call query_maintenance_context with vehicle_id=%d to fetch the deterministic envelope "+
			"(vehicle_id, current_mileage, items[*], recent_records[*], summary{total, overdue, due_soon, completed}). "+
			"(2) OPTIONALLY call retrieve_maintenance_chunks with the most salient overdue / due-soon item name "+
			"as the query, restricted to allowed source_types (maintenance_event, vehicle_state, ml_anomaly) — "+
			"answer gracefully when zero chunks are returned. "+
			"Produce a 3-6 sentence factual advisory grounded strictly in the envelope. "+
			"Name the summary counts, the highest-priority overdue or due-soon items by name and category, "+
			"the due_date / due_mileage values as the envelope reports them, and recent service records relevant "+
			"to the at-risk items. "+
			"Remember: you NEVER invent a maintenance item, never claim an item is overdue when the envelope "+
			"reports it healthy, never invent a service event, and never speculate about root cause beyond what "+
			"the envelope explicitly states. "+
			"If the envelope is degenerate (zero items or zero overdue / due_soon items), say so plainly rather "+
			"than padding the advisory. "+
			"If current_mileage is null (the odometer is unknown), say so plainly and prefer time-based reasoning "+
			"over mileage-based reasoning. "+
			"Refuse politely if asked to advise on a different vehicle than the in-scope one.",
		vehicleID, vehicleID,
	)
}

// Compile-time assertion: AIPredictiveMaintenanceHandler
// satisfies http.Handler.
var _ http.Handler = (*AIPredictiveMaintenanceHandler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the tool interface declared by
// internal/ai/tools/predictive_maintenance.go. Kept in the same
// file as the handler so the wiring intent is local to the
// slice; mirrors the state-machine-debugger-narrator slice's
// AIFSMTraceSource pattern.
// ---------------------------------------------------------------------

// AIPredictiveMaintenanceContextSource is the production
// tools.MaintenancePredictionContextSource. The canonical
// baseline /api/v1/maintenance surface remains reachable to the
// operator at all times — this adapter wraps the SAME
// default-items + Redis-odometer reader the canonical
// MaintenanceHandler.List handler serves, so the LLM and the
// operator see the SAME maintenance items list. No new SQL is
// issued by this adapter; the read paths are the existing
// in-package methods on MaintenanceHandler.
//
// A future slice that wires a per-vehicle persistent
// maintenance-items table (replacing the current hard-coded
// default-items list with a live read) can replace the underlying
// MaintenanceHandler implementation without changing the tool /
// handler / strategy contract.
type AIPredictiveMaintenanceContextSource struct {
	db         *database.DB
	redisCache *signal.RedisSignalCache
	// items is the in-package handle to the deterministic items
	// builder. We keep a *MaintenanceHandler reference so that
	// any future refactor of defaultItems naturally flows
	// through to this adapter without code duplication.
	items *MaintenanceHandler
}

// NewAIPredictiveMaintenanceContextSource constructs the
// production adapter. The db is required (the canonical
// MaintenanceHandler.List handler uses it to look up the
// first-vehicle id; the adapter doesn't do that lookup itself
// because the AI handler always knows the in-scope vehicle_id
// from the request body, but the field is reserved for future
// per-vehicle persistent-items reads). The redisCache is
// optional — when nil, the adapter reports current_mileage as
// unknown (nil pointer).
func NewAIPredictiveMaintenanceContextSource(db *database.DB, redisCache *signal.RedisSignalCache) *AIPredictiveMaintenanceContextSource {
	mh := NewMaintenanceHandler(db)
	if redisCache != nil {
		mh = mh.WithRedisCache(redisCache)
	}
	return &AIPredictiveMaintenanceContextSource{
		db:         db,
		redisCache: redisCache,
		items:      mh,
	}
}

// MaintenanceContext implements
// tools.MaintenancePredictionContextSource. Returns a typed
// envelope for the in-scope vehicleID. No state is mutated.
// No SQL is issued by this method (the underlying
// MaintenanceHandler.defaultItems is a pure-functional builder
// keyed on (vehicleID, currentOdometer)); the only IO is a
// best-effort Redis read for the live odometer, which falls
// back to "unknown" on miss / error.
//
// The envelope's slices are non-nil (empty-but-allocated) so
// JSON marshalling renders [] rather than null — keeping the
// LLM's tool-reply parsing predictable.
func (a *AIPredictiveMaintenanceContextSource) MaintenanceContext(ctx context.Context, vehicleID int64) (*tools.MaintenancePredictionContextEnvelope, error) {
	if vehicleID <= 0 {
		return nil, fmt.Errorf("api ai predictive-maintenance: vehicle_id must be > 0")
	}

	// Read odometer from Redis signal cache (matches the
	// canonical /api/v1/maintenance handler's logic verbatim).
	// Best-effort: any miss / error → unknown (nil pointer).
	var currentMileage *float64
	if a.redisCache != nil {
		signals, rErr := a.redisCache.GetAll(ctx, vehicleID)
		if rErr == nil && signals != nil {
			if v, ok := signals["Odometer"]; ok {
				if f, ok := v.(float64); ok {
					m := f
					currentMileage = &m
				}
			}
		}
	}

	// Build deterministic items via the same in-package method
	// MaintenanceHandler.List uses. Pass 0 when the odometer is
	// unknown so the due_mileage calculations are deterministic
	// (the LLM is instructed via the system prompt to prefer
	// time-based reasoning when current_mileage is null).
	var od float64
	if currentMileage != nil {
		od = *currentMileage
	}
	raw := a.items.defaultItems(vehicleID, od)

	// Translate the map[string]interface{} default-items shape
	// (legacy pre-Phase-48 baseline; the existing operator
	// surface reads these field names verbatim) into the typed
	// envelope. We preserve the field names because (a) the
	// frontend already reads them as-is from /api/v1/maintenance,
	// (b) the Phase-48 instruction forbids touching the
	// existing SI-canonicalization mapping in this slice.
	items := make([]tools.MaintenancePredictionItem, 0, len(raw))
	summary := tools.MaintenancePredictionSummary{}
	for _, m := range raw {
		it := tools.MaintenancePredictionItem{}
		if v, ok := m["id"].(int); ok {
			it.ID = int64(v)
		}
		if v, ok := m["category"].(string); ok {
			it.Category = v
		}
		if v, ok := m["name"].(string); ok {
			it.Name = v
		}
		if v, ok := m["description"].(string); ok {
			it.Description = v
		}
		if v, ok := m["status"].(string); ok {
			it.Status = v
		}
		if v, ok := m["due_date"].(string); ok {
			it.DueDate = v
		}
		if v, ok := m["due_mileage"].(float64); ok {
			d := v
			it.DueMileage = &d
		}
		if currentMileage != nil {
			cm := *currentMileage
			it.CurrentMileage = &cm
		}
		if v, ok := m["last_service_date"].(string); ok {
			it.LastServiceDate = v
		}
		if v, ok := m["last_service_mileage"].(float64); ok {
			lsm := v
			it.LastServiceMileage = &lsm
		}
		if v, ok := m["interval_months"].(int); ok {
			it.IntervalMonths = v
		}
		if v, ok := m["interval_miles"].(int); ok {
			it.IntervalMiles = v
		}
		items = append(items, it)

		summary.Total++
		switch it.Status {
		case "overdue":
			summary.Overdue++
		case "soon":
			summary.DueSoon++
		case "completed":
			summary.Completed++
		}
	}

	// Recent service records: the canonical baseline
	// /api/v1/maintenance/records returns []; we mirror that
	// here so the LLM never sees records the operator does not
	// also see. A future slice that adds a persistent service-
	// records table can swap the empty-slice initialisation
	// for a real read without changing the tool /
	// handler / strategy contract.
	recentRecords := make([]tools.MaintenancePredictionServiceRecord, 0)

	return &tools.MaintenancePredictionContextEnvelope{
		VehicleID:      vehicleID,
		CurrentMileage: currentMileage,
		Items:          items,
		RecentRecords:  recentRecords,
		Summary:        summary,
	}, nil
}

// Compile-time assertion: AIPredictiveMaintenanceContextSource
// satisfies tools.MaintenancePredictionContextSource.
var _ tools.MaintenancePredictionContextSource = (*AIPredictiveMaintenanceContextSource)(nil)
