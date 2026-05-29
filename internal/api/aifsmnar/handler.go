package aifsmnar

// Phase-50 / 0048 — S7 State-machine debugger narrator.
//
// POST /api/v1/ai/system/fsm/narrate streams one-shot FSM narration for
// a body-scoped (vehicle_id, from_unix, to_unix) window. The scoped window
// is installed in context before dispatch so tool calls cannot be steered
// to another vehicle or interval; ADR-015 guard wrapping keeps the route
// hidden in off-mode without changing the deterministic debugger page.

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
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/summary"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
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

// aiStateMachineDebuggerNarratorMaxWindowSeconds matches the SPA's 7-day
// default range so the normal "Ask Helix" workflow does not self-reject,
// while still bounding the source envelope.
const aiStateMachineDebuggerNarratorMaxWindowSeconds = 7 * 24 * 60 * 60

// aiStateMachineDebuggerNarratorMaxFromUnix is a sanity upper
// bound on from_unix to reject obvious garbage (e.g. epoch year
// 9999). Set to year 2100 in Unix seconds.
const aiStateMachineDebuggerNarratorMaxFromUnix = int64(4102444800)

// aiStateMachineDebuggerNarratorRequest is the required JSON body.
type aiStateMachineDebuggerNarratorRequest struct {
	VehicleID int64 `json:"vehicle_id"`

	FromUnix int64 `json:"from_unix"`

	ToUnix int64 `json:"to_unix"`
}

func writeError(w http.ResponseWriter, status int, msg string) {
	httpx.WriteError(w, status, msg)
}

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// bytesTrim is a defensive ASCII whitespace trimmer used only by
// the body-empty check. Avoids importing bytes for one call.
func bytesTrim(b []byte) []byte {
	for len(b) > 0 && (b[0] == ' ' || b[0] == '\t' || b[0] == '\r' || b[0] == '\n') {
		b = b[1:]
	}
	for len(b) > 0 && (b[len(b)-1] == ' ' || b[len(b)-1] == '\t' || b[len(b)-1] == '\r' || b[len(b)-1] == '\n') {
		b = b[:len(b)-1]
	}
	return b
}

// Handler is the HTTP handler for
// POST /api/v1/ai/system/fsm/narrate.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once
// at boot.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	source     summary.FSMTraceSource
	headerName string
	maxIters   int
}

// NewHandler constructs the handler and panics on nil dependencies so
// wiring bugs fail at boot instead of the first AI request. toolReg must
// contain query_fsm_trace and retrieve_fsm_chunks.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	source summary.FSMTraceSource,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aifsmnar: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aifsmnar: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aifsmnar: NewHandler: nil strategy.Strategy")
	case source == nil:
		panic("aifsmnar: NewHandler: nil summary.FSMTraceSource")
	}
	return &Handler{
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
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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
	ctx = summary.WithScopedFSMTraceWindow(ctx, summary.ScopedFSMTraceWindow{
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

// Compile-time assertion: Handler satisfies http.Handler.
var _ http.Handler = (*Handler)(nil)

// Production wiring for the summary.FSMTraceSource adapter.

// FSMTraceSource is the production summary.FSMTraceSource. The
// canonical baseline /api/v1/fsm/transitions surface remains
// reachable to the operator at all times — this adapter
// intentionally returns a deterministic empty envelope describing
// the bound (vehicle_id, from_unix, to_unix) tuple. The
// strategy's goldens cover the zero-data path and the system
// prompt instructs the LLM to say so plainly.
//
// A future slice that wires a per-window FSM-transition reader
// (likely via *dbobs.FSMTransitionRepo + a window+vehicle
// query) can replace this adapter without changing the tool /
// handler / strategy contract. The adapter keeps the VehicleID /
// FromUnix / ToUnix values the handler installed and stringifies
// the times so the LLM sees a recognisable window without having
// to format Unix seconds itself.
type FSMTraceSource struct{}

// NewFSMTraceSource constructs the deterministic empty adapter.
func NewFSMTraceSource() *FSMTraceSource {
	return &FSMTraceSource{}
}

// FSMTrace returns a deterministic, side-effect-free empty envelope. Slices
// are allocated so JSON renders [] rather than null for predictable tool replies.
func (a *FSMTraceSource) FSMTrace(_ context.Context, vehicleID, fromUnix, toUnix int64) (*summary.FSMTraceEnvelope, error) {
	if vehicleID <= 0 {
		return nil, fmt.Errorf("api ai state-machine-debugger-narrator: vehicle_id must be > 0")
	}
	if fromUnix <= 0 {
		return nil, fmt.Errorf("api ai state-machine-debugger-narrator: from_unix must be > 0")
	}
	if toUnix <= fromUnix {
		return nil, fmt.Errorf("api ai state-machine-debugger-narrator: to_unix must be > from_unix")
	}
	return &summary.FSMTraceEnvelope{
		VehicleID:        vehicleID,
		FromUnix:         fromUnix,
		ToUnix:           toUnix,
		FromTime:         time.Unix(fromUnix, 0).UTC().Format(time.RFC3339),
		ToTime:           time.Unix(toUnix, 0).UTC().Format(time.RFC3339),
		TotalTransitions: 0,
		PerFSM:           []summary.FSMTraceFSMCount{},
		PerEdge:          []summary.FSMTraceEdgeCount{},
		FlapCount:        0,
		Transitions:      []summary.FSMTraceTransition{},
	}, nil
}

// Compile-time assertion: FSMTraceSource satisfies summary.FSMTraceSource.
var _ summary.FSMTraceSource = (*FSMTraceSource)(nil)
