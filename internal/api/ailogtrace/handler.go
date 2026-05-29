package ailogtrace

// Phase-50 / 0045 — S4 Log and trace summarization.
//
// LLM-backed POST /api/v1/ai/system/logs/summarize. The guard in ai_routes.go
// fails closed before this handler when AI mode or the feature toggle is off
// (ADR-015 §I6).
//
// The request-scoped (from_unix, to_unix, vehicle_id) tuple is installed in
// context before dispatcher.Run; tools reject any LLM-supplied window that does
// not match it. The surface is opt-in, read-only, and leaves the baseline live
// log stream shape unchanged (ADR-015 §I3, §I9-I10).

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
	logtracesummarization "github.com/ev-dev-labs/teslasync/internal/ai/strategies/log-trace-summarization"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/summary"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// maxIterations bounds the dispatcher's
// tool-loop. The strategy is at most query_trace_window →
// (optional) retrieve_log_chunks → answer (with optional retries
// on transient tool error). A hard ceiling of 8 is generous,
// matching the other narrator handlers.
const maxIterations = 8

// maxBodyBytes caps the request body. The
// body is small (3 numeric fields); bound it cheaply. 16 KiB
// matches the other body-driven AI handlers.
const maxBodyBytes = 16 * 1024

// maxWindowSeconds caps the window the
// caller may request. 24 hours is generous for an operator log-
// triage workflow and bounds the size of the envelope the source
// has to compute.
const maxWindowSeconds = 24 * 60 * 60

// maxFromUnix is a sanity upper bound on
// from_unix to reject obvious garbage (e.g. epoch year 9999). Set
// to year 2100 in Unix seconds.
const maxFromUnix = int64(4102444800)

// summarizationRequest is the typed body shape. Only
// from_unix / to_unix are required; vehicle_id is optional.
type summarizationRequest struct {
	// FromUnix is the inclusive start of the window in Unix
	// seconds. Required + positive.
	FromUnix int64 `json:"from_unix"`

	// ToUnix is the inclusive end of the window in Unix seconds.
	// Required + strictly greater than FromUnix.
	ToUnix int64 `json:"to_unix"`

	// VehicleID, when non-zero, narrows the window to one
	// vehicle. Optional. Zero means "all vehicles" — the
	// LiveLogsPage's vehicle filter passes the chosen vehicle ID
	// if any.
	VehicleID int64 `json:"vehicle_id,omitempty"`
}

// Handler is the HTTP handler for
// POST /api/v1/ai/system/logs/summarize.
//
// Stateless beyond its constructor inputs; safe for concurrent use
// across requests. Construction is in router.go so the dispatcher's
// tool registry + provider registry are wired once at boot.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	source     summary.TraceWindowSource
	headerName string
	maxIters   int
}

// NewHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on a
// nil so the wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already
//
//	applied).
//
// toolReg:    process-wide tool registry. MUST contain
//
//	query_trace_window AND retrieve_log_chunks
//	(registered by summary.RegisterLogTraceSummarizerTools
//	in router.go).
//
// strat:      the log-trace-summarization Strategy (one per
//
//	process).
//
// source:     the production summary.TraceWindowSource (currently
//
//	TraceWindowSource — a deterministic empty
//	adapter; the operator-facing log surface is
//	stream-only and has no historical reader yet).
//
// headerName: forward-auth header name; used to extract subject
//
//	for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	source summary.TraceWindowSource,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("ailogtrace: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("ailogtrace: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("ailogtrace: NewHandler: nil strategy.Strategy")
	case source == nil:
		panic("ailogtrace: NewHandler: nil summary.TraceWindowSource")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		source:     source,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// parseRequest drains the body. Both
// from_unix / to_unix are required; vehicle_id is optional.
// Absence or invalid values surface as JSON 400 with a stable
// error key the SPA can localise. Returns (req, true) when the
// body is acceptable.
func parseRequest(w http.ResponseWriter, r *http.Request) (summarizationRequest, bool) {
	var req summarizationRequest
	if r.Body == nil {
		httpx.WriteError(w, http.StatusBadRequest, "missing body")
		return req, false
	}
	defer r.Body.Close()
	bodyBytes, readErr := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes))
	if readErr != nil {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("failed to read body: %v", readErr))
		return req, false
	}
	if len(trimSpace(bodyBytes)) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "empty body")
		return req, false
	}
	dec := json.NewDecoder(strings.NewReader(string(bodyBytes)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return req, false
	}
	if req.FromUnix <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "from_unix must be > 0")
		return req, false
	}
	if req.FromUnix > maxFromUnix {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("from_unix exceeds upper bound %d", maxFromUnix))
		return req, false
	}
	if req.ToUnix <= req.FromUnix {
		httpx.WriteError(w, http.StatusBadRequest, "to_unix must be > from_unix")
		return req, false
	}
	if req.ToUnix-req.FromUnix > maxWindowSeconds {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("window (%d s) exceeds cap %d s", req.ToUnix-req.FromUnix, maxWindowSeconds))
		return req, false
	}
	if req.VehicleID < 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be >= 0")
		return req, false
	}
	return req, true
}

func trimSpace(b []byte) []byte {
	for len(b) > 0 && (b[0] == ' ' || b[0] == '\t' || b[0] == '\r' || b[0] == '\n') {
		b = b[1:]
	}
	for len(b) > 0 && (b[len(b)-1] == ' ' || b[len(b)-1] == '\t' || b[len(b)-1] == '\r' || b[len(b)-1] == '\n') {
		b = b[:len(b)-1]
	}
	return b
}

// ServeHTTP implements [http.Handler]. The body is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either writes
// a structured frame onto the SSE stream (when the writer has
// been opened) or a plain JSON 4xx/5xx (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	req, ok := parseRequest(w, r)
	if !ok {
		return
	}

	// Resolve before opening SSE so provider failures stay plain JSON errors.
	if _, err := h.registry.For(r.Context(), logtracesummarization.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai log-trace-summarization: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// Bind the requested window before any tool can run.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, logtracesummarization.FeatureID)
	ctx = summary.WithScopedLogTraceWindow(ctx, summary.ScopedLogTraceWindow{
		FromUnix:  req.FromUnix,
		ToUnix:    req.ToUnix,
		VehicleID: req.VehicleID,
	})

	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(logtracesummarization.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai log-trace-summarization: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	prov, err := h.registry.For(ctx, logtracesummarization.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai log-trace-summarization: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// Deny-all confirmation is defence in depth for this read-only surface.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Log-trace summarization is
	// NOT conversational — there is no chat history. We hand the
	// LLM a deterministic prompt that scopes to the in-scope
	// window and instructs the tool sequence EXACTLY:
	// query_trace_window first, then OPTIONALLY
	// retrieve_log_chunks, then summary.
	userMsg := buildUserMessage(req.FromUnix, req.ToUnix, req.VehicleID)

	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("from_unix", req.FromUnix).
			Int64("to_unix", req.ToUnix).
			Int64("vehicle_id", req.VehicleID).
			Msg("ai log-trace-summarization: dispatcher returned error")
	}
}

// buildUserMessage synthesises the window-
// scoped user message the LLM sees. The format is deterministic
// (RFC3339 UTC time strings) so canned goldens and provider
// prompt-hash caches stay stable across boots.
func buildUserMessage(fromUnix, toUnix, vehicleID int64) string {
	fromStr := time.Unix(fromUnix, 0).UTC().Format(time.RFC3339)
	toStr := time.Unix(toUnix, 0).UTC().Format(time.RFC3339)
	var vehicleClause string
	if vehicleID > 0 {
		vehicleClause = fmt.Sprintf(" The window is narrowed to vehicle %d.", vehicleID)
	} else {
		vehicleClause = " The window covers all vehicles."
	}
	return fmt.Sprintf(
		"Summarize log/trace activity in the window from_unix=%d to_unix=%d (%s to %s UTC).%s "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call query_trace_window with from_unix=%d, to_unix=%d, and vehicle_id=%d to fetch the deterministic envelope "+
			"(window bounds, log_event_count, level_breakdown, top_templates, trace_span_count, top_trace_ops). "+
			"(2) OPTIONALLY call retrieve_log_chunks with the most salient log-template phrase or operation name as the query, "+
			"restricted to allowed source_types (log_event, trace_span) — answer gracefully when zero chunks are returned. "+
			"Produce a 3-6 sentence factual summary grounded strictly in the tool reply. "+
			"Name the level breakdown (debug/info/warn/error counts), the top recurring log template(s) with their counts, "+
			"the trace-span count, and the top trace-span operation(s) with their mean duration when present. "+
			"Remember: you NEVER invent log lines, never claim a recurring template the envelope does not record, "+
			"never invent a trace operation, and never speculate about root cause beyond what the messages explicitly state. "+
			"If the window is degenerate (zero log events AND zero trace spans), say so plainly rather than padding the summary. "+
			"Refuse politely if asked to summarize a different window than the in-scope tuple.",
		fromUnix, toUnix, fromStr, toStr, vehicleClause,
		fromUnix, toUnix, vehicleID,
	)
}

// denyAllConfirm is the dispatch confirm hook for this read-only AI surface.
func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// Compile-time assertion: Handler satisfies http.Handler.
var _ http.Handler = (*Handler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the tool interface declared by
// internal/ai/tools/log_trace_summarizer.go. Kept in the same file as
// the handler so the wiring intent is local to the slice; mirrors
// the incident-timeline-summarizer slice's AIIncidentTimelineSource
// pattern.
// ---------------------------------------------------------------------

// TraceWindowSource is the production
// summary.TraceWindowSource. The operator-facing log surface is
// stream-only — there is NO historical log persistence beyond
// zerolog's stdout — so this adapter intentionally returns a
// deterministic empty envelope describing the bound window. The
// strategy's goldens cover the zero-data path and the system
// prompt instructs the LLM to say so plainly.
//
// A future slice that wires a log-history reader can replace this
// adapter without changing the tool / handler / strategy contract.
// The adapter keeps the FromUnix / ToUnix / VehicleID values the
// handler installed and stringifies them so the LLM sees a
// recognisable window without having to format Unix seconds
// itself.
type TraceWindowSource struct{}

// NewTraceWindowSource constructs the deterministic empty
// adapter. No deps. Returned by-pointer for symmetry with the
// other AI* source types.
func NewTraceWindowSource() *TraceWindowSource {
	return &TraceWindowSource{}
}

// TraceWindow implements summary.TraceWindowSource. Returns a
// deterministic empty envelope describing the bound window. No
// SQL is issued. No state is mutated.
//
// The envelope's slices are non-nil (empty-but-allocated) so JSON
// marshalling renders [] rather than null — keeping the LLM's
// tool-reply parsing predictable.
func (a *TraceWindowSource) TraceWindow(_ context.Context, fromUnix, toUnix, vehicleID int64) (*summary.TraceWindowEnvelope, error) {
	if fromUnix <= 0 {
		return nil, fmt.Errorf("api ai log-trace-summarization: from_unix must be > 0")
	}
	if toUnix <= fromUnix {
		return nil, fmt.Errorf("api ai log-trace-summarization: to_unix must be > from_unix")
	}
	if vehicleID < 0 {
		return nil, fmt.Errorf("api ai log-trace-summarization: vehicle_id must be >= 0")
	}
	return &summary.TraceWindowEnvelope{
		FromUnix:       fromUnix,
		ToUnix:         toUnix,
		VehicleID:      vehicleID,
		FromTime:       time.Unix(fromUnix, 0).UTC().Format(time.RFC3339),
		ToTime:         time.Unix(toUnix, 0).UTC().Format(time.RFC3339),
		LogEventCount:  0,
		LevelBreakdown: []summary.LogLevelCount{},
		TopTemplates:   []summary.LogTemplateCount{},
		TraceSpanCount: 0,
		TopTraceOps:    []summary.TraceOpStat{},
	}, nil
}

// Compile-time assertion: TraceWindowSource satisfies
// summary.TraceWindowSource.
var _ summary.TraceWindowSource = (*TraceWindowSource)(nil)
