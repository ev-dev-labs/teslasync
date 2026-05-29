package aipredmaint

// Predictive maintenance streams a one-shot advisory scoped to one vehicle.
// The guard hides the route when AI is off, and context scope binding prevents tool calls for another vehicle.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	predictivemaintenance "github.com/ev-dev-labs/teslasync/internal/ai/strategies/predictive-maintenance"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/maintenance"
	apihttpx "github.com/ev-dev-labs/teslasync/internal/api/httpx"
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

// Handler is the HTTP handler for
// POST /api/v1/ai/maintenance/predict.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once
// at boot.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	source     maintenance.MaintenancePredictionContextSource
	headerName string
	maxIters   int
}

// NewHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on
// a nil so the wiring bug surfaces at boot, not at first
// request.
//
// registry:   AI provider registry (decorator chain already
//
//	applied).
//
// toolReg:    process-wide tool registry. MUST contain
//
//	query_maintenance_context AND
//	retrieve_maintenance_chunks (registered by
//	maintenance.RegisterPredictiveMaintenanceTools in
//	router.go).
//
// strat:      the predictive-maintenance Strategy (one per
//
//	process).
//
// source:     the production
//
//	maintenance.MaintenancePredictionContextSource
//	(currently ContextSource —
//	wraps the SAME default-items + Redis-odometer
//	reader the canonical baseline GET
//	/api/v1/maintenance handler already serves; the
//	canonical baseline surface remains reachable to
//	the operator at all times).
//
// headerName: forward-auth header name; used to extract subject
//
//	for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	source maintenance.MaintenancePredictionContextSource,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("api/aipredmaint: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api/aipredmaint: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("api/aipredmaint: NewHandler: nil strategy.Strategy")
	case source == nil:
		panic("api/aipredmaint: NewHandler: nil maintenance.MaintenancePredictionContextSource")
	}
	return &Handler{
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
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	req, ok := parsePredictiveMaintenanceRequest(w, r)
	if !ok {
		return
	}

	if _, err := h.registry.For(r.Context(), predictivemaintenance.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai predictive-maintenance: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, predictivemaintenance.FeatureID)
	ctx = maintenance.WithScopedMaintenancePredictionWindow(ctx, maintenance.ScopedMaintenancePredictionWindow{
		VehicleID: req.VehicleID,
	})

	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(predictivemaintenance.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai predictive-maintenance: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	prov, err := h.registry.For(ctx, predictivemaintenance.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai predictive-maintenance: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	userMsg := buildPredictiveMaintenanceUserMessage(req.VehicleID)

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

// Compile-time assertion: Handler
// satisfies http.Handler.
var _ http.Handler = (*Handler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the tool interface declared by
// internal/ai/tools/predictive_maintenance.go. Kept in the same
// file as the handler so the wiring intent is local to the
// slice; mirrors the state-machine-debugger-narrator slice's
// AIFSMTraceSource pattern.
// ---------------------------------------------------------------------

// ContextSource is the production
// maintenance.MaintenancePredictionContextSource. The canonical
// baseline /api/v1/maintenance surface remains reachable to the
// operator at all times — this adapter wraps the SAME
// default-items + Redis-odometer reader the canonical
// MaintenanceHandler.List handler serves, so the LLM and the
// operator see the SAME maintenance items list. No new SQL is
// issued by this adapter; the deterministic builder mirrors
// the canonical maintenance handler's item list.
//
// A future slice that wires a per-vehicle persistent
// maintenance-items table (replacing the current hard-coded
// default-items list with a live read) can replace the underlying
// MaintenanceHandler implementation without changing the tool /
// handler / strategy contract.
type ContextSource struct {
	db         *database.DB
	redisCache *signal.RedisSignalCache
}

// NewContextSource constructs the
// production adapter. The db is required (the canonical
// MaintenanceHandler.List handler uses it to look up the
// first-vehicle id; the adapter doesn't do that lookup itself
// because the AI handler always knows the in-scope vehicle_id
// from the request body, but the field is reserved for future
// per-vehicle persistent-items reads). The redisCache is
// optional — when nil, the adapter reports current_mileage as
// unknown (nil pointer).
func NewContextSource(db *database.DB, redisCache *signal.RedisSignalCache) *ContextSource {
	return &ContextSource{
		db:         db,
		redisCache: redisCache,
	}
}

// MaintenanceContext implements
// maintenance.MaintenancePredictionContextSource. Returns a typed
// envelope for the in-scope vehicleID. No state is mutated.
// No SQL is issued by this method (the underlying
// defaultItems is a pure-functional builder
// keyed on (vehicleID, currentOdometer)); the only IO is a
// best-effort Redis read for the live odometer, which falls
// back to "unknown" on miss / error.
//
// The envelope's slices are non-nil (empty-but-allocated) so
// JSON marshalling renders [] rather than null — keeping the
// LLM's tool-reply parsing predictable.
func (a *ContextSource) MaintenanceContext(ctx context.Context, vehicleID int64) (*maintenance.MaintenancePredictionContextEnvelope, error) {
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
	raw := defaultItems(vehicleID, od)

	// Translate the map[string]interface{} default-items shape
	// (legacy pre-Phase-48 baseline; the existing operator
	// surface reads these field names verbatim) into the typed
	// envelope. We preserve the field names because (a) the
	// frontend already reads them as-is from /api/v1/maintenance,
	// (b) the Phase-48 instruction forbids touching the
	// existing SI-canonicalization mapping in this slice.
	items := make([]maintenance.MaintenancePredictionItem, 0, len(raw))
	summary := maintenance.MaintenancePredictionSummary{}
	for _, m := range raw {
		it := maintenance.MaintenancePredictionItem{}
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
	recentRecords := make([]maintenance.MaintenancePredictionServiceRecord, 0)

	return &maintenance.MaintenancePredictionContextEnvelope{
		VehicleID:      vehicleID,
		CurrentMileage: currentMileage,
		Items:          items,
		RecentRecords:  recentRecords,
		Summary:        summary,
	}, nil
}

func writeError(w http.ResponseWriter, status int, msg string) {
	apihttpx.WriteError(w, status, msg)
}

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

func bytesTrim(b []byte) []byte {
	for len(b) > 0 && (b[0] == ' ' || b[0] == '\t' || b[0] == '\r' || b[0] == '\n') {
		b = b[1:]
	}
	for len(b) > 0 && (b[len(b)-1] == ' ' || b[len(b)-1] == '\t' || b[len(b)-1] == '\r' || b[len(b)-1] == '\n') {
		b = b[:len(b)-1]
	}
	return b
}

func defaultItems(vehicleID int64, currentOdometer float64) []map[string]interface{} {
	now := time.Now()
	return []map[string]interface{}{
		{
			"id": 1, "vehicle_id": vehicleID, "category": "filters",
			"name": "Cabin Air Filter", "description": "Replace cabin air filter (HEPA)",
			"due_date": now.AddDate(0, 6, 0).Format("2006-01-02"), "due_mileage": nil,
			"current_mileage": currentOdometer, "last_service_date": nil, "last_service_mileage": nil,
			"interval_months": 24, "interval_miles": nil, "status": "good", "created_at": now.Format(time.RFC3339),
		},
		{
			"id": 2, "vehicle_id": vehicleID, "category": "tires",
			"name": "Tire Rotation", "description": "Rotate tires for even wear",
			"due_date": nil, "due_mileage": currentOdometer + 10000,
			"current_mileage": currentOdometer, "last_service_date": nil, "last_service_mileage": nil,
			"interval_months": nil, "interval_miles": 10000, "status": "good", "created_at": now.Format(time.RFC3339),
		},
		{
			"id": 3, "vehicle_id": vehicleID, "category": "brakes",
			"name": "Brake Fluid Check", "description": "Test brake fluid for moisture content",
			"due_date": now.AddDate(0, 12, 0).Format("2006-01-02"), "due_mileage": nil,
			"current_mileage": currentOdometer, "last_service_date": nil, "last_service_mileage": nil,
			"interval_months": 24, "interval_miles": nil, "status": "good", "created_at": now.Format(time.RFC3339),
		},
		{
			"id": 4, "vehicle_id": vehicleID, "category": "battery",
			"name": "Battery Coolant", "description": "Check battery coolant level and condition",
			"due_date": now.AddDate(2, 0, 0).Format("2006-01-02"), "due_mileage": nil,
			"current_mileage": currentOdometer, "last_service_date": nil, "last_service_mileage": nil,
			"interval_months": 48, "interval_miles": nil, "status": "good", "created_at": now.Format(time.RFC3339),
		},
		{
			"id": 5, "vehicle_id": vehicleID, "category": "fluids",
			"name": "Windshield Washer Fluid", "description": "Top up windshield washer fluid",
			"due_date": nil, "due_mileage": nil,
			"current_mileage": currentOdometer, "last_service_date": nil, "last_service_mileage": nil,
			"interval_months": 6, "interval_miles": nil, "status": "good", "created_at": now.Format(time.RFC3339),
		},
		{
			"id": 6, "vehicle_id": vehicleID, "category": "wipers",
			"name": "Wiper Blades", "description": "Inspect and replace wiper blades if worn",
			"due_date": now.AddDate(0, 3, 0).Format("2006-01-02"), "due_mileage": nil,
			"current_mileage": currentOdometer, "last_service_date": nil, "last_service_mileage": nil,
			"interval_months": 12, "interval_miles": nil, "status": "good", "created_at": now.Format(time.RFC3339),
		},
		{
			"id": 7, "vehicle_id": vehicleID, "category": "alignment",
			"name": "Wheel Alignment", "description": "Check and adjust wheel alignment",
			"due_date": nil, "due_mileage": currentOdometer + 20000,
			"current_mileage": currentOdometer, "last_service_date": nil, "last_service_mileage": nil,
			"interval_months": nil, "interval_miles": 20000, "status": "good", "created_at": now.Format(time.RFC3339),
		},
		{
			"id": 8, "vehicle_id": vehicleID, "category": "brakes",
			"name": "Brake Caliper Cleaning", "description": "Clean and lubricate brake calipers",
			"due_date": nil, "due_mileage": nil,
			"current_mileage": currentOdometer, "last_service_date": nil, "last_service_mileage": nil,
			"interval_months": 12, "interval_miles": 20000, "status": "good", "created_at": now.Format(time.RFC3339),
		},
	}
}

// Compile-time assertion: ContextSource
// satisfies maintenance.MaintenancePredictionContextSource.
var _ maintenance.MaintenancePredictionContextSource = (*ContextSource)(nil)
