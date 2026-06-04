// Package maintenance contains read-only AI tools for predictive maintenance.
//
// query_maintenance_context builds a typed envelope from the same maintenance
// items and recent service records shown on the operator-facing Maintenance
// page. The request-scoped vehicle ID is enforced before any data is loaded,
// preventing prompt-injected cross-vehicle reads.
//
// retrieve_maintenance_chunks searches the calling operator's RAG corpora with
// a fixed source-type allowlist. Its input deliberately has no vehicle_id;
// per-vehicle separation stays in the retriever subject and source filters.
//
// Both tools are read-only and have no database handle.

package maintenance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// maintenanceSourceMaintenanceEvent is reserved for the future
// per-service-event embedding corpus. It stays local until an
// indexer exists; then it should be promoted to rag.SourceMaintenanceEvent.
const maintenanceSourceMaintenanceEvent = "maintenance_event"

// maintenanceSourceVehicleState is the source-type string
// reserved for the future per-vehicle-state-summary embedding
// corpus (idle hours, drive-state distribution, charge cadence
// etc. — the rolling-window signals the maintenance advisor
// pairs with item progress). Same forward-compatibility
// rationale as maintenanceSourceMaintenanceEvent.
const maintenanceSourceVehicleState = "vehicle_state"

// maintenanceSourceMLAnomaly is reserved for the future learned
// per-vehicle anomaly-baseline corpus. The future indexer should
// add a typed constant.
const maintenanceSourceMLAnomaly = "ml_anomaly"

// maintenancePredictionAllowedSourceTypes is the source-type allowlist
// for predictive-maintenance retrieval. New sources must be added here
// and reflected in the strategy's system prompt and goldens.
//
// Kept in lex order so error messages list a stable allowed-set.
var maintenancePredictionAllowedSourceTypes = []string{
	maintenanceSourceMaintenanceEvent,
	maintenanceSourceMLAnomaly,
	maintenanceSourceVehicleState,
}

// maintenancePredictionAllowedSourceTypeSet is the O(1)
// membership lookup for the allowlist above.
var maintenancePredictionAllowedSourceTypeSet = func() map[string]struct{} {
	out := make(map[string]struct{}, len(maintenancePredictionAllowedSourceTypes))
	for _, s := range maintenancePredictionAllowedSourceTypes {
		out[s] = struct{}{}
	}
	return out
}()

// maintenancePredictionAllowedSourceTypesHint is the comma-
// separated allowlist rendered in retrieve_maintenance_chunks's
// Description.
var maintenancePredictionAllowedSourceTypesHint = strings.Join(maintenancePredictionAllowedSourceTypes, ", ")

// maintenancePredictionMaxK is the per-call upper bound on the
// retriever's k parameter.
const maintenancePredictionMaxK = 12

// maintenancePredictionDefaultK is the value substituted when the
// LLM omits k.
const maintenancePredictionDefaultK = 5

// maintenancePredictionMaxQueryChars caps the user-supplied
// natural-language query at the tool boundary.
const maintenancePredictionMaxQueryChars = 1024

// ---------------------------------------------------------------------------
// Per-request maintenance-prediction scope binding
// ---------------------------------------------------------------------------

// scopedMaintenancePredictionWindowKey is the unexported context-
// key type used to carry the body-supplied vehicle_id through
// the dispatcher to the tool. A per-package unexported type
// prevents accidental key collisions with any other context
// value in the request lifetime.
type scopedMaintenancePredictionWindowKey struct{}

// ScopedMaintenancePredictionWindow is the in-scope tuple
// installed by the AI handler. Maintenance items are not
// time-windowed (they are "due in 6 months" or "due in 10000
// miles", not "show me what happened between T1 and T2"), so
// the scope contains only the vehicle_id; the dispatcher
// propagates it through ctx so the tool can refuse any
// LLM-supplied vehicle_id outside it.
type ScopedMaintenancePredictionWindow struct {
	// VehicleID is the vehicle the prediction covers. Strictly
	// positive in a well-installed scope.
	VehicleID int64
}

// WithScopedMaintenancePredictionWindow returns ctx with w
// installed as the in-scope vehicle for this request. Called by
// the AI HTTP handler AFTER body validation and BEFORE the
// dispatcher.Run loop is started. The dispatcher then propagates
// ctx unchanged through every Tool.Execute call.
//
// Exported so internal/api can install the scope without
// depending on tool-internal types.
func WithScopedMaintenancePredictionWindow(ctx context.Context, w ScopedMaintenancePredictionWindow) context.Context {
	return context.WithValue(ctx, scopedMaintenancePredictionWindowKey{}, w)
}

// ScopedMaintenancePredictionWindowFromContext returns the
// in-scope tuple and true when one is present, or the zero
// value / false when no scope is installed. Tools that are
// scope-bound MUST treat the missing-scope case as a hard
// failure — the AI handler ALWAYS installs the scope, so an
// absent scope means the dispatcher was invoked from an
// unintended path and the call must be refused.
//
// Exported for symmetry with WithScopedMaintenancePredictionWindow
// and so unit tests in other packages can inspect what the AI
// handler installed.
func ScopedMaintenancePredictionWindowFromContext(ctx context.Context) (ScopedMaintenancePredictionWindow, bool) {
	v, ok := ctx.Value(scopedMaintenancePredictionWindowKey{}).(ScopedMaintenancePredictionWindow)
	return v, ok
}

// ---------------------------------------------------------------------------
// retrieve_maintenance_chunks
// ---------------------------------------------------------------------------

// retrieveMaintenanceChunksInput is the typed input shape for
// retrieve_maintenance_chunks. The dispatcher decodes the LLM's
// tool-call arguments JSON into this struct via ValidateStruct
// so a malformed input fails before any rag.Retriever method
// runs.
//
// Note the deliberate absence of vehicle_id: per-vehicle
// separation is handled by the RAG retriever's per-subject
// filter for the calling operator. Widening the input
// to accept vehicle_id would expose a prompt-injection
// exfiltration surface that the omission closes.
type retrieveMaintenanceChunksInput struct {
	// Query is the natural-language search expression. Required,
	// non-empty, bounded.
	Query string `json:"query" validate:"required" desc:"Natural-language maintenance / vehicle-state / ML-anomaly search query (required, non-empty)."`

	// SourceTypes is the per-call allowlist of corpora to
	// search. Each entry MUST appear in
	// maintenancePredictionAllowedSourceTypes; an unknown source
	// type is refused at validation time.
	SourceTypes []string `json:"source_types" validate:"required,min=1" desc:"List of source types to search; allowed values: maintenance_event, ml_anomaly, vehicle_state."`

	// K is the requested top-k count. Optional; defaults to
	// maintenancePredictionDefaultK when zero. Bounded to
	// [0, maintenancePredictionMaxK].
	K int `json:"k,omitempty" validate:"gte=0,lte=12" desc:"Top-k count to return; default 5 when omitted, max 12."`
}

// retrievedMaintenanceChunk is the shared envelope for one chunk
// in the retrieve_maintenance_chunks output. Mirrors rag.Chunk
// but uses explicit JSON tags so the tool's output marshals
// stably regardless of any future change to the underlying
// rag.Chunk shape.
type retrievedMaintenanceChunk struct {
	SourceType string  `json:"source_type"`
	SourceID   string  `json:"source_id"`
	ChunkIdx   int     `json:"chunk_idx"`
	Text       string  `json:"text"`
	Score      float32 `json:"score"`
}

// retrieveMaintenanceChunks is the read-only tool that calls the
// RAG retriever for the predictive-maintenance domain. It is the
// OPTIONAL secondary tool the LLM may call (per the strategy's
// system prompt) AFTER query_maintenance_context, so the
// narration is grounded FIRST in the deterministic envelope and
// only OPTIONALLY enriched with retrieved per-event context.
type retrieveMaintenanceChunks struct {
	r rag.Retriever
}

// Name implements [Tool].
func (t *retrieveMaintenanceChunks) Name() string { return "retrieve_maintenance_chunks" }

// Description implements [Tool].
func (t *retrieveMaintenanceChunks) Description() string {
	return "Find the top-k nearest chunks to a natural-language query across the calling user's " +
		"maintenance-event / vehicle-state-summary / ML-anomaly corpus via the F7 RAG retriever. " +
		"READ-only: no record is created, mutated, or deleted. " +
		"Allowed source_types: " + maintenancePredictionAllowedSourceTypesHint + ". " +
		"Vehicle scoping is implicit (the F7 retriever filters by the calling operator's subject); " +
		"do NOT pass a vehicle id in the query string. " +
		"Returns {chunks: [{source_type, source_id, chunk_idx, text, score}]}; an empty list means no match — " +
		"DO NOT fabricate a maintenance event, vehicle-state summary, or anomaly excerpt to fill the void."
}

// InputSchema implements [Tool].
func (t *retrieveMaintenanceChunks) InputSchema() json.RawMessage {
	return tools.CachedSchema(retrieveMaintenanceChunksInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *retrieveMaintenanceChunks) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. READ-only.
func (t *retrieveMaintenanceChunks) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *retrieveMaintenanceChunks) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator,
// then enforces the source-type allowlist that the validator's
// `oneof` tag cannot express for slice fields.
func (t *retrieveMaintenanceChunks) Validate(raw json.RawMessage) (any, error) {
	v, err := tools.ValidateStruct[retrieveMaintenanceChunksInput](raw)
	if err != nil {
		return nil, err
	}
	in := v.(retrieveMaintenanceChunksInput)
	if err := assertAllowedMaintenancePredictionSourceTypes(in.SourceTypes); err != nil {
		return nil, err
	}
	if len(in.Query) > maintenancePredictionMaxQueryChars {
		return nil, fmt.Errorf("retrieve_maintenance_chunks: query length %d exceeds cap %d",
			len(in.Query), maintenancePredictionMaxQueryChars)
	}
	return in, nil
}

// Execute implements [Tool].
func (t *retrieveMaintenanceChunks) Execute(ctx context.Context, in any) (any, error) {
	input := in.(retrieveMaintenanceChunksInput)
	if t.r == nil {
		return nil, errors.New("retrieve_maintenance_chunks: no rag.Retriever wired")
	}
	k := input.K
	if k == 0 {
		k = maintenancePredictionDefaultK
	}
	subject := provider.SubjectFromContext(ctx)
	chunks, err := t.r.Retrieve(ctx, subject, input.Query, input.SourceTypes, k)
	if err != nil {
		return nil, fmt.Errorf("retrieve_maintenance_chunks: rag.Retrieve: %w", err)
	}
	out := make([]retrievedMaintenanceChunk, 0, len(chunks))
	for _, c := range chunks {
		out = append(out, retrievedMaintenanceChunk{
			SourceType: c.SourceType,
			SourceID:   c.SourceID,
			ChunkIdx:   c.ChunkIdx,
			Text:       c.Text,
			Score:      c.Score,
		})
	}
	return map[string]any{
		"query":        input.Query,
		"source_types": input.SourceTypes,
		"k":            k,
		"chunks":       out,
	}, nil
}

// ---------------------------------------------------------------------------
// query_maintenance_context
// ---------------------------------------------------------------------------

// MaintenancePredictionItem is one maintenance item in the
// envelope. Field names match the operator-facing
// GET /api/v1/maintenance JSON shape verbatim so the LLM sees
// the same vocabulary the operator does in the UI. Mileage
// fields use `*float64` so unknown is distinct from zero (a
// freshly-built vehicle legitimately has current_mileage=0
// versus an unread odometer where current_mileage is unknown).
type MaintenancePredictionItem struct {
	// ID is the item's primary-key id.
	ID int64 `json:"id"`

	// Category is the maintenance category (tires, brakes,
	// battery, filters, fluids, wipers, alignment, general).
	// Free-form.
	Category string `json:"category"`

	// Name is the operator-readable item name (e.g. "Cabin Air
	// Filter").
	Name string `json:"name"`

	// Description is the operator-readable description.
	Description string `json:"description"`

	// Status is the deterministic status from the baseline
	// handler: one of {"good", "soon", "overdue", "completed"}.
	// The advisor MUST treat this as ground truth.
	Status string `json:"status"`

	// DueDate is the RFC3339 date string for time-based items
	// (e.g. "2025-08-01"). Empty when the item is mileage-
	// only.
	DueDate string `json:"due_date,omitempty"`

	// DueMileage is the odometer reading at which the item
	// becomes due. Nil for time-only items.
	DueMileage *float64 `json:"due_mileage"`

	// CurrentMileage is the vehicle's current odometer reading
	// at envelope-build time. Nil when the odometer is
	// unknown (Redis cache miss, fresh boot, no live signal).
	CurrentMileage *float64 `json:"current_mileage"`

	// LastServiceDate is the RFC3339 date string of the
	// previous service (if any). Empty when no service is
	// recorded.
	LastServiceDate string `json:"last_service_date,omitempty"`

	// LastServiceMileage is the odometer reading at the
	// previous service. Nil when no service is recorded.
	LastServiceMileage *float64 `json:"last_service_mileage"`

	// IntervalMonths is the calendar interval in months
	// between services. Zero when the item is mileage-only.
	IntervalMonths int `json:"interval_months,omitempty"`

	// IntervalMiles is the odometer interval between services
	// (NB: the existing baseline `/api/v1/maintenance` handler
	// emits the field as `interval_miles`; preserve the field
	// name to match the
	// surface the operator already sees).
	IntervalMiles int `json:"interval_miles,omitempty"`
}

// MaintenancePredictionServiceRecord is one row in the recent-
// records section of the envelope. Mirrors the operator-facing
// GET /api/v1/maintenance/records shape; the production source
// reads the same data the canonical baseline endpoint does (or
// returns an empty slice when no records are logged).
type MaintenancePredictionServiceRecord struct {
	// ID is the record's primary-key id.
	ID int64 `json:"id"`

	// Date is the RFC3339 date+time of the service event.
	Date string `json:"date"`

	// Description is the operator-typed description (may
	// contain free-form text — the redaction layer tags
	// non-vehicle-name PII before this string reaches the
	// provider).
	Description string `json:"description"`

	// Mileage is the odometer reading at the time of service.
	Mileage float64 `json:"mileage"`

	// Cost is the service cost in the operator's configured
	// currency (the per-request UserPrefs middleware seeds
	// the locale; the LLM narrates in the operator's currency).
	Cost float64 `json:"cost"`

	// Provider is the operator-typed service provider name
	// (may contain free-form text).
	Provider string `json:"provider,omitempty"`
}

// MaintenancePredictionSummary is the count breakdown derived
// from the items list. Computed deterministically by the
// source so the LLM does not have to recount.
type MaintenancePredictionSummary struct {
	// Total is the total number of items in the envelope.
	Total int `json:"total"`

	// Overdue is the count of items with derived status
	// "overdue".
	Overdue int `json:"overdue"`

	// DueSoon is the count of items with derived status
	// "soon".
	DueSoon int `json:"due_soon"`

	// Completed is the count of items with derived status
	// "completed".
	Completed int `json:"completed"`
}

// MaintenancePredictionContextEnvelope is the typed envelope
// query_maintenance_context returns. Designed to be mappable
// 1:1 to the operator-facing GET /api/v1/maintenance JSON
// shape without renaming any field.
type MaintenancePredictionContextEnvelope struct {
	// VehicleID mirrors the in-scope tuple for the LLM's
	// convenience.
	VehicleID int64 `json:"vehicle_id"`

	// CurrentMileage is the vehicle's current odometer
	// reading at envelope-build time, OR nil when the
	// odometer is unknown (Redis cache miss, no live signal,
	// vehicle never reported). Sentinel 0 would silently
	// conflate "unread" with "brand-new vehicle" — the
	// pointer makes the distinction explicit so the LLM can
	// say so plainly.
	CurrentMileage *float64 `json:"current_mileage"`

	// Items is the deterministic list of maintenance items
	// the operator sees in the MaintenancePage. Empty when
	// the vehicle has no items (deterministic-empty source).
	Items []MaintenancePredictionItem `json:"items"`

	// RecentRecords is the chronologically-ordered list of
	// service-history records. Empty when no records have
	// been logged.
	RecentRecords []MaintenancePredictionServiceRecord `json:"recent_records"`

	// Summary is the derived count breakdown.
	Summary MaintenancePredictionSummary `json:"summary"`
}

// MaintenancePredictionContextSource is the narrow port the
// query_maintenance_context tool delegates to. In production it
// is satisfied by an AIPredictiveMaintenanceContextSource
// adapter that wraps the SAME default-items + Redis-odometer
// reader the canonical baseline GET /api/v1/maintenance handler
// already serves. The canonical baseline surface remains
// reachable to the operator at all times — the AI tool does
// not duplicate the maintenance items list, it only wraps the
// same data behind a typed envelope shape suitable for
// grounded narration.
//
// In tests we substitute deterministic fakes so the tool unit
// tests stay hermetic.
//
// The interface MUST stay read-only — adding a Save / Update
// method here would defeat the read-only contract that
// ADR-015 §I3 mandate.
type MaintenancePredictionContextSource interface {
	// MaintenanceContext returns the deterministic envelope
	// describing the in-scope vehicleID. Implementations MUST
	// NOT reach outside the in-scope vehicle.
	MaintenanceContext(ctx context.Context, vehicleID int64) (*MaintenancePredictionContextEnvelope, error)
}

// queryMaintenanceContextInput is the typed input shape.
type queryMaintenanceContextInput struct {
	// VehicleID identifies the vehicle the prediction covers.
	// Required + positive — the AI handler ALWAYS scopes to
	// one vehicle the caller supplied via the request body;
	// the tool ADDITIONALLY rejects any value that does not
	// match the in-scope VehicleID.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Vehicle id (required, positive). MUST match the in-scope vehicle installed by the AI handler."`
}

// queryMaintenanceContext is the read-only tool that returns
// the deterministic maintenance-context envelope.
type queryMaintenanceContext struct {
	src MaintenancePredictionContextSource
}

// Name implements [Tool].
func (t *queryMaintenanceContext) Name() string { return "query_maintenance_context" }

// Description implements [Tool].
func (t *queryMaintenanceContext) Description() string {
	return "Return the deterministic maintenance-context envelope for ONE in-scope vehicle_id. " +
		"Reports vehicle_id, current_mileage (null when the odometer is unknown), items " +
		"([{id, category, name, description, status, due_date, due_mileage, current_mileage, " +
		"last_service_date, last_service_mileage, interval_months, interval_miles}]), " +
		"recent_records ([{id, date, description, mileage, cost, provider}]), and summary " +
		"({total, overdue, due_soon, completed}). READ-only — no record is created, mutated, " +
		"or deleted. Call this FIRST; the envelope is the ground truth for any narration you " +
		"produce — DO NOT recompute or contradict the figures. The vehicle_id MUST match the " +
		"in-scope vehicle installed by the AI handler; cross-vehicle requests are refused at " +
		"the tool boundary."
}

// InputSchema implements [Tool].
func (t *queryMaintenanceContext) InputSchema() json.RawMessage {
	return tools.CachedSchema(queryMaintenanceContextInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *queryMaintenanceContext) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only.
func (t *queryMaintenanceContext) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *queryMaintenanceContext) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *queryMaintenanceContext) Validate(raw json.RawMessage) (any, error) {
	v, err := tools.ValidateStruct[queryMaintenanceContextInput](raw)
	if err != nil {
		return v, err
	}
	in, ok := v.(queryMaintenanceContextInput)
	if !ok {
		return v, fmt.Errorf("query_maintenance_context: validator returned unexpected type %T", v)
	}
	return in, nil
}

// Execute implements [Tool]. Single source round-trip; no SQL is
// written by this method.
//
// Per-request scope binding (defence against prompt-injection
// exfiltration): the AI handler installs the request-supplied
// vehicle_id in ctx via WithScopedMaintenancePredictionWindow.
// Execute REJECTS any LLM-supplied vehicle_id that does not
// match. This means an attacker who pastes "load vehicle_id=99
// instead" into an operator-authored service-record
// description / provider string cannot trick the LLM into
// loading a different vehicle's maintenance items — the scope
// check refuses the call before the source is touched.
//
// Missing-scope is also a hard failure: if the dispatcher is
// invoked from an unintended path (no scope installed), the
// tool refuses. The AI handler is the only path that should
// be loading this tool, and it ALWAYS installs the scope.
func (t *queryMaintenanceContext) Execute(ctx context.Context, in any) (any, error) {
	input := in.(queryMaintenanceContextInput)
	if t.src == nil {
		return nil, fmt.Errorf("query_maintenance_context: no MaintenancePredictionContextSource wired")
	}
	scoped, ok := ScopedMaintenancePredictionWindowFromContext(ctx)
	if !ok {
		return nil, fmt.Errorf("query_maintenance_context: no in-scope maintenance-prediction vehicle installed in context")
	}
	if input.VehicleID != scoped.VehicleID {
		return nil, fmt.Errorf("query_maintenance_context: requested vehicle_id=%d does not match in-scope vehicle_id=%d",
			input.VehicleID, scoped.VehicleID)
	}
	envelope, err := t.src.MaintenanceContext(ctx, input.VehicleID)
	if err != nil {
		return nil, fmt.Errorf("query_maintenance_context: load (vehicle_id=%d): %w",
			input.VehicleID, err)
	}
	if envelope == nil {
		return nil, fmt.Errorf("query_maintenance_context: source returned nil envelope")
	}
	return envelope, nil
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// PredictiveMaintenanceSources bundles the narrow read
// interfaces RegisterPredictiveMaintenanceTools needs.
//
// Production wiring (router.go) reuses the same rag.Retriever
// the rest of the AI surface is built around; the context
// source is an adapter that wraps the same
// /api/v1/maintenance reader the canonical baseline endpoint
// already serves. Tests substitute deterministic fakes
// per-source.
type PredictiveMaintenanceSources struct {
	Retriever          rag.Retriever
	MaintenanceContext MaintenancePredictionContextSource
}

// RegisterPredictiveMaintenanceTools installs the predictive-
// maintenance tools on r. Called from router.go after
// state-machine-debugger-narrator registration so the registry's
// alphabetical Names list
// continues to grow deterministically without disturbing
// earlier registrations or any builtin-names pin tests.
//
// Panics on duplicate registration (Registry.Register panics) —
// a second call is a wiring bug detected at boot, not at first
// request.
func RegisterPredictiveMaintenanceTools(r *tools.Registry, s PredictiveMaintenanceSources) {
	r.Register(&queryMaintenanceContext{src: s.MaintenanceContext})
	r.Register(&retrieveMaintenanceChunks{r: s.Retriever})
}

// assertAllowedMaintenancePredictionSourceTypes enforces the
// per-feature source-type allowlist.
func assertAllowedMaintenancePredictionSourceTypes(types []string) error {
	if len(types) == 0 {
		return errors.New("retrieve_maintenance_chunks: source_types is required and must contain at least one entry")
	}
	seen := make(map[string]struct{}, len(types))
	for _, st := range types {
		if _, ok := maintenancePredictionAllowedSourceTypeSet[st]; !ok {
			return fmt.Errorf("retrieve_maintenance_chunks: source_type %q not in allowed set %s",
				st, maintenancePredictionAllowedSourceTypesHint)
		}
		if _, dup := seen[st]; dup {
			return fmt.Errorf("retrieve_maintenance_chunks: source_type %q appears more than once in source_types", st)
		}
		seen[st] = struct{}{}
	}
	return nil
}

// AllowedMaintenancePredictionSourceTypes returns a defensive
// copy of the per-feature source-type allowlist. Exported so
// the AI handler + tests can reference the same set the tools
// enforce.
func AllowedMaintenancePredictionSourceTypes() []string {
	out := make([]string, len(maintenancePredictionAllowedSourceTypes))
	copy(out, maintenancePredictionAllowedSourceTypes)
	return out
}
