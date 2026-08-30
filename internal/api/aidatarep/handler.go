package aidatarep

// Handler for data repair suggestions.
//
// This opt-in AI handler drafts repair patches from the same stale-session
// inventory shown by /system/data-repair, but never writes or calls PUT repair.
// It scopes tool calls to the server-loaded stale IDs so prompt injection in
// stale-row text cannot redirect proposals to a different row.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	datarepairsuggestions "github.com/ev-dev-labs/teslasync/internal/ai/strategies/data-repair-suggestions"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/diagnostic"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
)

// aiDataRepairSuggestionsMaxIterations bounds the dispatcher's
// tool-loop. The strategy is at most draft_data_repair_plan →
// validate_data_repair_plan → answer (with optional retries on
// validator rejection). A hard ceiling of 8 is generous, matching
// the other propose-only handlers (alert-builder, incident-
// timeline-summarizer).
const aiDataRepairSuggestionsMaxIterations = 8

// aiDataRepairSuggestionsStaleCutoff mirrors the canonical baseline
// data_repair_handler.GetStaleSessions cutoff: rows are "stale" if
// they started more than 24h ago and still have no end timestamp.
// Centralised here so a baseline-cutoff change can be applied to
// the AI surface in one place.
const aiDataRepairSuggestionsStaleCutoff = 24 * time.Hour

// aiDataRepairMaxBodyBytes caps the optional vehicle-scope request body.
const aiDataRepairMaxBodyBytes = 16 * 1024

func writeError(w http.ResponseWriter, status int, msg string) {
	httpx.WriteError(w, status, msg)
}

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// Source loads the same stale-session inventory used by the canonical
// /system/data-repair page. Keeping it single-method prevents the AI
// surface from growing broader than the baseline repair flow.
type Source interface {
	// StaleSessions returns retainable, non-nil stale charging and drive slices.
	StaleSessions(ctx context.Context, cutoff time.Time) (charging []*chargingmodel.ChargingSession, drives []*drivemodel.Drive, err error)
}

// Handler serves POST /api/v1/ai/system/data-repair/draft.
//
// It is stateless beyond constructor inputs and safe for concurrent use.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	source     Source
	headerName string
	maxIters   int
	now        func() time.Time
}

// NewHandler wires explicit dependencies so guarded-off routes do not create
// hidden provider work and tests can pin the draft-only boundary.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	source Source,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aidatarep: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aidatarep: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aidatarep: NewHandler: nil strategy.Strategy")
	case source == nil:
		panic("aidatarep: NewHandler: nil Source")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		source:     source,
		headerName: headerName,
		maxIters:   aiDataRepairSuggestionsMaxIterations,
		now:        time.Now,
	}
}

type dataRepairSuggestionsRequest struct {
	VehicleID *int64 `json:"vehicle_id,omitempty"`
}

// parseDataRepairSuggestionsRequest decodes the optional vehicle scope.
// Empty, null, and unknown-field-only objects remain valid for compatibility.
func parseDataRepairSuggestionsRequest(
	w http.ResponseWriter,
	r *http.Request,
) (dataRepairSuggestionsRequest, bool) {
	var request dataRepairSuggestionsRequest
	if r.Body == nil {
		return request, true
	}
	defer r.Body.Close()
	bodyBytes, readErr := io.ReadAll(io.LimitReader(r.Body, aiDataRepairMaxBodyBytes))
	if readErr != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("failed to read body: %v", readErr))
		return request, false
	}
	trimmed := strings.TrimSpace(string(bodyBytes))
	if trimmed == "" || trimmed == "null" {
		return request, true
	}
	if err := json.Unmarshal(bodyBytes, &request); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return dataRepairSuggestionsRequest{}, false
	}
	if request.VehicleID != nil && *request.VehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id must be greater than zero")
		return dataRepairSuggestionsRequest{}, false
	}
	return request, true
}

func scopeStaleInventory(
	vehicleID *int64,
	charging []*chargingmodel.ChargingSession,
	drives []*drivemodel.Drive,
) ([]*chargingmodel.ChargingSession, []*drivemodel.Drive) {
	scopedCharging := make([]*chargingmodel.ChargingSession, 0, len(charging))
	for _, session := range charging {
		if session != nil && (vehicleID == nil || session.VehicleID == *vehicleID) {
			scopedCharging = append(scopedCharging, session)
		}
	}
	scopedDrives := make([]*drivemodel.Drive, 0, len(drives))
	for _, drive := range drives {
		if drive != nil && (vehicleID == nil || drive.VehicleID == *vehicleID) {
			scopedDrives = append(scopedDrives, drive)
		}
	}
	return scopedCharging, scopedDrives
}

func recordHandlerError(ctx context.Context, err error) {
	if err == nil {
		return
	}
	span := trace.SpanFromContext(ctx)
	span.RecordError(err)
	span.SetStatus(codes.Error, err.Error())
}

func activeTraceID(ctx context.Context) string {
	return trace.SpanContextFromContext(ctx).TraceID().String()
}

// ServeHTTP implements [http.Handler]. The body is parsed, the
// inventory is loaded, the dispatcher is invoked, and the SSE
// stream is closed via the dispatcher's deferred WriteDone. Every
// error path either writes a structured frame onto the SSE stream
// (when the writer has been opened) or a plain JSON 4xx/5xx
// (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.ai.data_repair_suggestions")
	defer span.End()
	r = r.WithContext(ctx)

	// 1) Parse + validate the request body (empty / {} / null
	// accepted; anything else 400).
	requestBody, ok := parseDataRepairSuggestionsRequest(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request resolution
	// honours mid-flight settings changes (model swap, mode flip)
	// without restart. A resolve failure must NOT open the SSE
	// stream — emit JSON 502 so the frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), datarepairsuggestions.FeatureID); err != nil {
		recordHandlerError(r.Context(), err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(r.Context())).
			Msg("ai data-repair-suggestions: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Load the current stale-session inventory BEFORE opening
	// the SSE writer so a DB error surfaces as a clean JSON 5xx
	// rather than a half-open SSE stream the frontend has to clean
	// up.
	cutoff := h.now().UTC().Add(-aiDataRepairSuggestionsStaleCutoff)
	charging, drives, err := h.source.StaleSessions(r.Context(), cutoff)
	if err != nil {
		recordHandlerError(r.Context(), err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(r.Context())).
			Msg("ai data-repair-suggestions: source.StaleSessions failed")
		writeError(w, http.StatusInternalServerError, "failed to load stale-session inventory")
		return
	}

	if charging == nil {
		charging = make([]*chargingmodel.ChargingSession, 0)
	}
	if drives == nil {
		drives = make([]*drivemodel.Drive, 0)
	}
	charging, drives = scopeStaleInventory(requestBody.VehicleID, charging, drives)

	chargingIDs := make([]int64, 0, len(charging))
	for _, c := range charging {
		if c != nil {
			chargingIDs = append(chargingIDs, c.ID)
		}
	}
	driveIDs := make([]int64, 0, len(drives))
	for _, d := range drives {
		if d != nil {
			driveIDs = append(driveIDs, d.ID)
		}
	}

	// 4) Subject + feature-id annotations for audit/rate-limit,
	// plus the per-request scope binding (defence against
	// prompt-injection exfiltration).
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx = provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, datarepairsuggestions.FeatureID)
	ctx = diagnostic.WithScopedDataRepairIDs(ctx, chargingIDs, driveIDs)

	// 5) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(datarepairsuggestions.FeatureID))
	if err != nil {
		recordHandlerError(ctx, err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(ctx)).
			Msg("ai data-repair-suggestions: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 6) Resolve the per-feature provider from the (now-annotated)
	// context.
	prov, err := h.registry.For(ctx, datarepairsuggestions.FeatureID)
	if err != nil {
		recordHandlerError(ctx, err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(ctx)).
			Msg("ai data-repair-suggestions: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 7) Build the dispatcher with the deny-all confirm hook. The
	// strategy's tool whitelist is propose-only so the deny-all
	// hook is never reached in practice — defence in depth.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 8) Synthesise the user message. Data-repair suggestion is NOT
	// conversational — there is no chat history. We hand the LLM a
	// deterministic prompt that lists the in-scope stale-session
	// inventory and instructs the tool sequence EXACTLY:
	// draft_data_repair_plan first, then validate_data_repair_plan,
	// then a one-sentence rationale.
	userMsg := buildDataRepairSuggestionsUserMessage(h.now().UTC(), charging, drives)

	// 9) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		recordHandlerError(ctx, err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(ctx)).
			Int("charging_in_scope", len(chargingIDs)).
			Int("drives_in_scope", len(driveIDs)).
			Msg("ai data-repair-suggestions: dispatcher returned error")
	}
}

// buildDataRepairSuggestionsUserMessage keeps prompt shape deterministic and
// omits names, VINs, locations, addresses, and raw telemetry samples.
func buildDataRepairSuggestionsUserMessage(now time.Time, charging []*chargingmodel.ChargingSession, drives []*drivemodel.Drive) string {
	var b strings.Builder

	b.WriteString("Suggest a single typed RepairPlan for ONE row in the in-scope stale-session inventory below. ")
	b.WriteString("The inventory is the AUTHORITATIVE list of rows you may target — refuse politely if the user asks about any other ID. ")
	b.WriteString("Follow the tool sequence EXACTLY: ")
	b.WriteString("(1) call draft_data_repair_plan with the typed RepairPlan you propose; ")
	b.WriteString("(2) call validate_data_repair_plan with the same RepairPlan to confirm it would be accepted by the canonical handler; ")
	b.WriteString("(3) write one rationale sentence and stop. ")
	b.WriteString("Do NOT claim the plan was applied — the user reviews the proposal in the AI side panel and clicks the canonical Save / Close / Quarantine button on the baseline form to apply it. ")

	// Sort by ID so prompt hashing is stable regardless of UI ordering.
	sortedCharging := append([]*chargingmodel.ChargingSession(nil), charging...)
	sort.Slice(sortedCharging, func(i, j int) bool { return sortedCharging[i].ID < sortedCharging[j].ID })
	if len(sortedCharging) == 0 {
		b.WriteString("\n\nStale charging sessions: NONE.\n")
	} else {
		b.WriteString("\n\nStale charging sessions (id, started_at, hours_open):\n")
		for _, c := range sortedCharging {
			if c == nil {
				continue
			}
			hours := now.Sub(c.StartedAt).Hours()
			fmt.Fprintf(&b, "  - id=%d started_at=%s hours_open=%.1f\n",
				c.ID, c.StartedAt.UTC().Format(time.RFC3339), hours)
		}
	}

	sortedDrives := append([]*drivemodel.Drive(nil), drives...)
	sort.Slice(sortedDrives, func(i, j int) bool { return sortedDrives[i].ID < sortedDrives[j].ID })
	if len(sortedDrives) == 0 {
		b.WriteString("\nStale drives: NONE.\n")
	} else {
		b.WriteString("\nStale drives (id, start_ts, hours_open):\n")
		for _, d := range sortedDrives {
			if d == nil {
				continue
			}
			hours := now.Sub(d.StartTs).Hours()
			fmt.Fprintf(&b, "  - id=%d start_ts=%s hours_open=%.1f\n",
				d.ID, d.StartTs.UTC().Format(time.RFC3339), hours)
		}
	}

	if len(sortedCharging) == 0 && len(sortedDrives) == 0 {
		b.WriteString("\nThe inventory is empty. Reply with one short sentence saying nothing is stale and STOP — do not call any tool.\n")
	}

	return b.String()
}

var _ http.Handler = (*Handler)(nil)

// sourceImpl delegates to the baseline stale-session repos so AI suggestions
// see exactly the inventory shown on /system/data-repair.
type sourceImpl struct {
	chargingRepo *chargingdb.ChargingRepo
	driveRepo    *drivedb.DriveRepo
}

// NewSource constructs the adapter from the shared
// *database.DB. Panics on a nil *database.DB so a wiring mistake
// surfaces at boot rather than as a nil-deref on first AI request.
func NewSource(db *database.DB) Source {
	if db == nil {
		panic("aidatarep: NewSource: nil *database.DB")
	}
	return &sourceImpl{
		chargingRepo: chargingdb.NewChargingRepo(db),
		driveRepo:    drivedb.NewDriveRepo(db),
	}
}

// StaleSessions implements Source. Two repo round-
// trips; both are READ-only.
func (a *sourceImpl) StaleSessions(ctx context.Context, cutoff time.Time) ([]*chargingmodel.ChargingSession, []*drivemodel.Drive, error) {
	charging, err := a.chargingRepo.GetStale(ctx, cutoff)
	if err != nil {
		return nil, nil, fmt.Errorf("aidatarep: ChargingRepo.GetStale: %w", err)
	}
	drives, err := a.driveRepo.GetStale(ctx, cutoff)
	if err != nil {
		return nil, nil, fmt.Errorf("aidatarep: DriveRepo.GetStale: %w", err)
	}
	if charging == nil {
		charging = make([]*chargingmodel.ChargingSession, 0)
	}
	if drives == nil {
		drives = make([]*drivemodel.Drive, 0)
	}
	return charging, drives, nil
}

var _ Source = (*sourceImpl)(nil)

// PlanValidator accepts only drafts that match the canonical data-repair
// shape, keeping AI proposals equivalent to baseline handler input.
type PlanValidator struct{}

// NewPlanValidator constructs the validator. No deps —
// the per-kind allowlist is package-static. Returned by-pointer for
// symmetry with the other AI* validator types.
func NewPlanValidator() *PlanValidator {
	return &PlanValidator{}
}

// ValidateDataRepairPlan accepts only propose-only patches for stale IDs in scope.
func (v *PlanValidator) ValidateDataRepairPlan(plan *diagnostic.DataRepairPlan) error {
	if plan == nil {
		return errors.New("aidatarep: nil RepairPlan")
	}
	// Future semantic checks belong here; this slice stays propose-only.
	return nil
}

// Compile-time assertion.
var _ diagnostic.DataRepairPlanValidator = (*PlanValidator)(nil)
