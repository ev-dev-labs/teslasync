package api

// Phase-50 / 0048 — S7 State-machine debugger narrator.
//
// ai_state_machine_debugger_narrator_handler.go implements the
// LLM-backed handler at POST /api/v1/ai/system/fsm/narrate. The
// flow mirrors ai_mqtt_sse_inspector_explanations_handler.go
// (body-driven, scope-bound, no persistence — one-shot read-only
// narration):
//
//	URL  /api/v1/ai/system/fsm/narrate
//	  ↓
//	read JSON body with required fields (vehicle_id, from_unix, to_unix)
//	  ↓
//	resolve provider via *provider.Registry.For("state-machine-debugger-narrator")
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	stash the (vehicle_id, from_unix, to_unix) tuple in ctx via
//	  tools.WithScopedFSMTraceWindow
//	  ↓
//	synthesise the user-message that scopes to the in-scope
//	  window and instructs the tool sequence
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("state-machine-debugger-narrator", …) so when
// ai_mode='off' or the per-feature toggle is off the guard
// returns 404 BEFORE this handler ever sees the request
// (ADR-015 §I6).
//
// Per-request scope binding (defence against prompt-injection
// exfiltration): the handler installs the (vehicle_id, from_unix,
// to_unix) tuple in ctx via tools.WithScopedFSMTraceWindow BEFORE
// dispatcher.Run is invoked. The dispatcher propagates ctx
// unchanged through every Tool.Execute call. The
// tools.queryFSMTrace tool's Execute method then REJECTS any
// LLM-supplied tuple that does not match the in-scope tuple.
// This means an attacker who pastes "narrate vehicle_id=99
// instead" into an operator-readable trigger string or FSM name
// cannot trick the LLM into loading a different vehicle's /
// window's trace — the scope check refuses the call before the
// source is touched.
//
// The handler requires a JSON body with (vehicle_id > 0,
// from_unix > 0, to_unix > from_unix). The (vehicle_id, from_unix,
// to_unix) triple is computed by the SPA from the page's active
// vehicle selector + (startInstant, endInstantExclusive) time
// range when the operator clicks the AI button on the
// StateMachineDebuggerPage; the body is the simplest place to
// convey the triple without polluting the URL with query
// strings.
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic /state-debugger page
//     (StateMachineDebuggerPage rendering the transition table,
//     state diagram, FSM health panel, and timeline chart) is
//     unchanged. This handler is an OPT-IN add-on; off-mode
//     users never see it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("state-machine-debugger-narrator").
//   - I9 redaction:       PolicyDigest (Allow=[ClassVehicleName])
//     is installed by dispatch.Run from the strategy and applied
//     to EVERY message (including the synthesised window user
//     message and tool outputs) by the redact decorator at the
//     provider boundary. Transition details are user-visible to
//     the operator already, so narration is unaffected.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline
//     /api/v1/fsm/transitions JSON shape is added or modified
//     by this slice.

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
	statemachinedebuggernarrator "github.com/ev-dev-labs/teslasync/internal/ai/strategies/state-machine-debugger-narrator"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// aiStateMachineDebuggerNarratorMaxIterations bounds the
// dispatcher's tool-loop. The strategy is at most query_fsm_trace
// → (optional) retrieve_fsm_chunks → answer (with optional
// retries on transient tool error). A hard ceiling of 8 is
// generous, matching the other narrator handlers.
const aiStateMachineDebuggerNarratorMaxIterations = 8

// aiStateMachineDebuggerNarratorMaxBodyBytes caps the request
// body. The body is small (3 numeric fields); bound it cheaply.
// 16 KiB matches the other body-driven AI handlers.
const aiStateMachineDebuggerNarratorMaxBodyBytes = 16 * 1024

// aiStateMachineDebuggerNarratorMaxWindowSeconds caps the window
// the caller may request. 7 days matches the SPA's
// StateMachineDebuggerPage default range preset ('7d' — see the
// useRangeState defaultPresetId in
// web/src/features/system/pages/StateMachineDebuggerPage.tsx),
// so the default operator workflow (open page → click "Ask Helix")
// no longer trips the cap with a stream_http_400. The previous
// 24-hour cap silently rejected every default-range request and
// bounds the size of the envelope the source has to compute even
// at the wider 7-day window.
const aiStateMachineDebuggerNarratorMaxWindowSeconds = 7 * 24 * 60 * 60

// aiStateMachineDebuggerNarratorMaxFromUnix is a sanity upper
// bound on from_unix to reject obvious garbage (e.g. epoch year
// 9999). Set to year 2100 in Unix seconds.
const aiStateMachineDebuggerNarratorMaxFromUnix = int64(4102444800)

// aiStateMachineDebuggerNarratorRequest is the typed body shape.
// All three fields are required.
type aiStateMachineDebuggerNarratorRequest struct {
	// VehicleID identifies the vehicle the trace covers.
	// Required + positive.
	VehicleID int64 `json:"vehicle_id"`

	// FromUnix is the inclusive start of the window in Unix
	// seconds. Required + positive.
	FromUnix int64 `json:"from_unix"`

	// ToUnix is the inclusive end of the window in Unix
	// seconds. Required + strictly greater than FromUnix.
	ToUnix int64 `json:"to_unix"`
}

// AIStateMachineDebuggerNarratorHandler is the HTTP handler for
// POST /api/v1/ai/system/fsm/narrate.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once
// at boot.
type AIStateMachineDebuggerNarratorHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	source     tools.FSMTraceSource
	headerName string
	maxIters   int
}

// NewAIStateMachineDebuggerNarratorHandler constructs the
// handler. All non-pointer arguments are required; the
// constructor panics on a nil so the wiring bug surfaces at
// boot, not at first request.
//
// registry:   AI provider registry (decorator chain already
//             applied).
// toolReg:    process-wide tool registry. MUST contain
//             query_fsm_trace AND retrieve_fsm_chunks
//             (registered by tools.RegisterStateMachineDebuggerNarratorTools
//             in router.go).
// strat:      the state-machine-debugger-narrator Strategy (one
//             per process).
// source:     the production tools.FSMTraceSource (currently
//             AIFSMTraceSource — a deterministic empty adapter;
//             the canonical baseline /api/v1/fsm/transitions
//             surface remains reachable to the operator at all
//             times).
// headerName: forward-auth header name; used to extract subject
//             for audit.
func NewAIStateMachineDebuggerNarratorHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	source tools.FSMTraceSource,
	headerName string,
) *AIStateMachineDebuggerNarratorHandler {
	switch {
	case registry == nil:
		panic("api: NewAIStateMachineDebuggerNarratorHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAIStateMachineDebuggerNarratorHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAIStateMachineDebuggerNarratorHandler: nil strategy.Strategy")
	case source == nil:
		panic("api: NewAIStateMachineDebuggerNarratorHandler: nil tools.FSMTraceSource")
	}
	return &AIStateMachineDebuggerNarratorHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		source:     source,
		headerName: headerName,
		maxIters:   aiStateMachineDebuggerNarratorMaxIterations,
	}
}

// parseStateMachineDebuggerNarratorRequest drains the body. All
// three fields are required. Absence or invalid values surface
// as JSON 400 with a stable error key the SPA can localise.
// Returns (req, true) when the body is acceptable.
func parseStateMachineDebuggerNarratorRequest(w http.ResponseWriter, r *http.Request) (aiStateMachineDebuggerNarratorRequest, bool) {
	var req aiStateMachineDebuggerNarratorRequest
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "missing body")
		return req, false
	}
	defer r.Body.Close()
	bodyBytes, readErr := io.ReadAll(io.LimitReader(r.Body, aiStateMachineDebuggerNarratorMaxBodyBytes))
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
	if req.FromUnix <= 0 {
		writeError(w, http.StatusBadRequest, "from_unix must be > 0")
		return req, false
	}
	if req.FromUnix > aiStateMachineDebuggerNarratorMaxFromUnix {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("from_unix exceeds upper bound %d", aiStateMachineDebuggerNarratorMaxFromUnix))
		return req, false
	}
	if req.ToUnix <= req.FromUnix {
		writeError(w, http.StatusBadRequest, "to_unix must be > from_unix")
		return req, false
	}
	if req.ToUnix-req.FromUnix > aiStateMachineDebuggerNarratorMaxWindowSeconds {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("window (%d s) exceeds cap %d s", req.ToUnix-req.FromUnix, aiStateMachineDebuggerNarratorMaxWindowSeconds))
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
func (h *AIStateMachineDebuggerNarratorHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the request body.
	req, ok := parseStateMachineDebuggerNarratorRequest(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request
	// resolution honours mid-flight settings changes (model
	// swap, mode flip) without restart. A resolve failure must
	// NOT open the SSE stream — emit JSON 502 so the frontend
	// falls back gracefully.
	if _, err := h.registry.For(r.Context(), statemachinedebuggernarrator.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai state-machine-debugger-narrator: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit,
	// plus the per-request scope binding (defence against
	// prompt-injection exfiltration).
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, statemachinedebuggernarrator.FeatureID)
	ctx = tools.WithScopedFSMTraceWindow(ctx, tools.ScopedFSMTraceWindow{
		VehicleID: req.VehicleID,
		FromUnix:  req.FromUnix,
		ToUnix:    req.ToUnix,
	})

	// 4) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(statemachinedebuggernarrator.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai state-machine-debugger-narrator: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-
	// annotated) context.
	prov, err := h.registry.For(ctx, statemachinedebuggernarrator.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai state-machine-debugger-narrator: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook.
	// The strategy's tool whitelist is propose-only / read-only
	// so the deny-all hook is never reached in practice —
	// defence in depth.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. FSM-trace narration is NOT
	// conversational — there is no chat history. We hand the
	// LLM a deterministic prompt that scopes to the in-scope
	// (vehicle_id, from_unix, to_unix) tuple and instructs the
	// tool sequence EXACTLY: query_fsm_trace first, then
	// OPTIONALLY retrieve_fsm_chunks, then narration.
	userMsg := buildStateMachineDebuggerNarratorUserMessage(req.VehicleID, req.FromUnix, req.ToUnix)

	// 8) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("vehicle_id", req.VehicleID).
			Int64("from_unix", req.FromUnix).
			Int64("to_unix", req.ToUnix).
			Msg("ai state-machine-debugger-narrator: dispatcher returned error")
	}
}

// buildStateMachineDebuggerNarratorUserMessage synthesises the
// (vehicle_id, from_unix, to_unix)-scoped user message the LLM
// sees. The format is deterministic (RFC3339 UTC time strings)
// so canned goldens and provider prompt-hash caches stay stable
// across boots.
func buildStateMachineDebuggerNarratorUserMessage(vehicleID, fromUnix, toUnix int64) string {
	fromStr := time.Unix(fromUnix, 0).UTC().Format(time.RFC3339)
	toStr := time.Unix(toUnix, 0).UTC().Format(time.RFC3339)
	return fmt.Sprintf(
		"Narrate FSM transitions for vehicle_id=%d in the window from_unix=%d to_unix=%d (%s to %s UTC). "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call query_fsm_trace with vehicle_id=%d, from_unix=%d, and to_unix=%d to fetch the deterministic envelope "+
			"(vehicle_id, from_unix, to_unix, from_time, to_time, total_transitions, per_fsm[*], per_edge[*], "+
			"flap_count, transitions[*]). "+
			"(2) OPTIONALLY call retrieve_fsm_chunks with the most salient transition / trigger phrase as the query, "+
			"restricted to allowed source_types (fsm_transition, signal_history_summary) — answer gracefully when zero chunks are returned. "+
			"Produce a 3-6 sentence factual narration grounded strictly in the envelope. "+
			"Name the total_transitions count, the per_fsm breakdown when more than one FSM is present, the dominant from→to edges, "+
			"the flap_count when greater than zero, and any unusual trigger string the envelope reports. "+
			"Remember: you NEVER invent a transition, never claim a vehicle entered a state the envelope does not record, "+
			"never invent a trigger, and never speculate about root cause beyond what the envelope explicitly states. "+
			"If the envelope is degenerate (zero transitions in the window), say so plainly rather than padding the explanation. "+
			"Refuse politely if asked to narrate a different vehicle or window than the in-scope tuple.",
		vehicleID, fromUnix, toUnix, fromStr, toStr,
		vehicleID, fromUnix, toUnix,
	)
}

// Compile-time assertion: AIStateMachineDebuggerNarratorHandler
// satisfies http.Handler.
var _ http.Handler = (*AIStateMachineDebuggerNarratorHandler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the tool interface declared by
// internal/ai/tools/state_machine_debugger_narrator.go. Kept in
// the same file as the handler so the wiring intent is local to
// the slice; mirrors the mqtt-sse-inspector-explanations slice's
// AIStreamInspectorSource pattern.
// ---------------------------------------------------------------------

// AIFSMTraceSource is the production tools.FSMTraceSource. The
// canonical baseline /api/v1/fsm/transitions surface remains
// reachable to the operator at all times — this adapter
// intentionally returns a deterministic empty envelope describing
// the bound (vehicle_id, from_unix, to_unix) tuple. The
// strategy's goldens cover the zero-data path and the system
// prompt instructs the LLM to say so plainly.
//
// A future slice that wires a per-window FSM-transition reader
// (likely via *database.FSMTransitionRepo + a window+vehicle
// query) can replace this adapter without changing the tool /
// handler / strategy contract. The adapter keeps the VehicleID /
// FromUnix / ToUnix values the handler installed and stringifies
// the times so the LLM sees a recognisable window without having
// to format Unix seconds itself.
type AIFSMTraceSource struct{}

// NewAIFSMTraceSource constructs the deterministic empty adapter.
// No deps. Returned by-pointer for symmetry with the other AI*
// source types.
func NewAIFSMTraceSource() *AIFSMTraceSource {
	return &AIFSMTraceSource{}
}

// FSMTrace implements tools.FSMTraceSource. Returns a
// deterministic empty envelope describing the bound tuple. No
// SQL is issued. No state is mutated.
//
// The envelope's slices are non-nil (empty-but-allocated) so
// JSON marshalling renders [] rather than null — keeping the
// LLM's tool-reply parsing predictable.
func (a *AIFSMTraceSource) FSMTrace(_ context.Context, vehicleID, fromUnix, toUnix int64) (*tools.FSMTraceEnvelope, error) {
	if vehicleID <= 0 {
		return nil, fmt.Errorf("api ai state-machine-debugger-narrator: vehicle_id must be > 0")
	}
	if fromUnix <= 0 {
		return nil, fmt.Errorf("api ai state-machine-debugger-narrator: from_unix must be > 0")
	}
	if toUnix <= fromUnix {
		return nil, fmt.Errorf("api ai state-machine-debugger-narrator: to_unix must be > from_unix")
	}
	return &tools.FSMTraceEnvelope{
		VehicleID:        vehicleID,
		FromUnix:         fromUnix,
		ToUnix:           toUnix,
		FromTime:         time.Unix(fromUnix, 0).UTC().Format(time.RFC3339),
		ToTime:           time.Unix(toUnix, 0).UTC().Format(time.RFC3339),
		TotalTransitions: 0,
		PerFSM:           []tools.FSMTraceFSMCount{},
		PerEdge:          []tools.FSMTraceEdgeCount{},
		FlapCount:        0,
		Transitions:      []tools.FSMTraceTransition{},
	}, nil
}

// Compile-time assertion: AIFSMTraceSource satisfies
// tools.FSMTraceSource.
var _ tools.FSMTraceSource = (*AIFSMTraceSource)(nil)
