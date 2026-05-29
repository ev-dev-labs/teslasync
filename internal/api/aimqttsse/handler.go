package aimqttsse

// MQTT and SSE inspector explanation handler.
//
// ai_mqtt_sse_inspector_explanations_handler.go implements the
// LLM-backed handler at POST /api/v1/ai/system/streams/explain.
// The flow mirrors ai_log_trace_summarization_handler.go (body-
// driven, scope-bound, no persistence — one-shot read-only
// explanation):
//
//	URL  /api/v1/ai/system/streams/explain
//	  ↓
//	read JSON body with required fields (from_unix, to_unix)
//	  ↓
//	resolve provider via *provider.Registry.For("mqtt-sse-inspector-explanations")
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	stash the (from_unix, to_unix) tuple in ctx via
//	  diagnostic.WithScopedStreamInspectorWindow
//	  ↓
//	synthesise the user-message that scopes to the in-scope
//	  window and instructs the tool sequence
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("mqtt-sse-inspector-explanations", …) so when
// ai_mode='off' or the per-feature toggle is off the guard
// returns 404 BEFORE this handler ever sees the request
// (ADR-015 §I6).
//
// Per-request scope binding (defence against prompt-injection
// exfiltration): the handler installs the (from_unix, to_unix)
// tuple in ctx via diagnostic.WithScopedStreamInspectorWindow BEFORE
// dispatcher.Run is invoked. The dispatcher propagates ctx
// unchanged through every Tool.Execute call. The
// tools.queryStreamInspector tool's Execute method then REJECTS
// any LLM-supplied window that does not match the in-scope
// tuple. This means an attacker who pastes "explain the window
// from 2020-01-01 instead" into an operator-readable VIN /
// broker hostname / topic name cannot trick the LLM into
// loading a different window's envelope — the scope check
// refuses the call before the source is touched.
//
// The handler requires a JSON body with (from_unix > 0,
// to_unix > from_unix). The (from_unix, to_unix) pair is
// computed by the SPA from the current time (now-30min to now)
// when the operator clicks the AI button on the
// MQTTInspectorPage; the body is the simplest place to convey a
// (from_unix, to_unix) tuple without polluting the URL with
// query strings.
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic /mqtt-inspector page
//     (MQTTInspectorPage rendering the broker-status snapshot
//     table, per-vehicle stream stats, and throughput chart) is
//     unchanged. This handler is an OPT-IN add-on; off-mode
//     users never see it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("mqtt-sse-inspector-explanations").
//   - I9 redaction:       PolicyChatbot (deny-by-default; every
//     PII class redacted to a round-trip tag — IPs, hostnames,
//     ports, tokens, VINs, coordinates, place names, vehicle
//     names) is installed by dispatch.Run from the strategy and
//     applied to EVERY message (including the synthesised
//     window user message and tool outputs) by the redact
//     decorator at the provider boundary.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline MQTT
//     status JSON shape is added or modified by this slice.

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
	mqttsseinspectorexplanations "github.com/ev-dev-labs/teslasync/internal/ai/strategies/mqtt-sse-inspector-explanations"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/diagnostic"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

// aiMqttSseInspectorExplanationsMaxIterations bounds the
// dispatcher's tool-loop. The strategy is at most
// query_stream_inspector → (optional) retrieve_stream_chunks →
// answer (with optional retries on transient tool error). A
// hard ceiling of 8 is generous, matching the other narrator
// handlers.
const aiMqttSseInspectorExplanationsMaxIterations = 8

// aiMqttSseInspectorExplanationsMaxBodyBytes caps the request
// body. The body is small (2 numeric fields); bound it cheaply.
// 16 KiB matches the other body-driven AI handlers.
const aiMqttSseInspectorExplanationsMaxBodyBytes = 16 * 1024

// aiMqttSseInspectorExplanationsMaxWindowSeconds caps the window
// the caller may request. 24 hours is generous for an operator
// stream-triage workflow and bounds the size of the envelope
// the source has to compute.
const aiMqttSseInspectorExplanationsMaxWindowSeconds = 24 * 60 * 60

// aiMqttSseInspectorExplanationsMaxFromUnix is a sanity upper
// bound on from_unix to reject obvious garbage (e.g. epoch year
// 9999). Set to year 2100 in Unix seconds.
const aiMqttSseInspectorExplanationsMaxFromUnix = int64(4102444800)

// aiMqttSseInspectorExplanationsRequest is the typed body shape.
// Both from_unix / to_unix are required.
type aiMqttSseInspectorExplanationsRequest struct {
	// FromUnix is the inclusive start of the window in Unix
	// seconds. Required + positive.
	FromUnix int64 `json:"from_unix"`

	// ToUnix is the inclusive end of the window in Unix
	// seconds. Required + strictly greater than FromUnix.
	ToUnix int64 `json:"to_unix"`
}

// Handler is the HTTP handler for
// POST /api/v1/ai/system/streams/explain.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once
// at boot.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	source     diagnostic.StreamInspectorSource
	headerName string
	maxIters   int
}

// NewHandler constructs the
// handler. All non-pointer arguments are required; the
// constructor panics on a nil so the wiring bug surfaces at
// boot, not at first request.
//
// registry:   AI provider registry (decorator chain already
//
//	applied).
//
// toolReg:    process-wide tool registry. MUST contain
//
//	query_stream_inspector AND retrieve_stream_chunks
//	(registered by diagnostic.RegisterMqttSseInspectorExplanationsTools
//	in router.go).
//
// strat:      the mqtt-sse-inspector-explanations Strategy (one
//
//	per process).
//
// source:     the production diagnostic.StreamInspectorSource
//
//	(currently StreamInspectorSource — a
//	deterministic empty adapter; the canonical
//	baseline /api/v1/admin/mqtt/status surface remains
//	reachable to the operator at all times).
//
// headerName: forward-auth header name; used to extract subject
//
//	for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	source diagnostic.StreamInspectorSource,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aimqttsse: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aimqttsse: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aimqttsse: NewHandler: nil strategy.Strategy")
	case source == nil:
		panic("aimqttsse: NewHandler: nil diagnostic.StreamInspectorSource")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		source:     source,
		headerName: headerName,
		maxIters:   aiMqttSseInspectorExplanationsMaxIterations,
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	httpx.WriteError(w, status, msg)
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

// parseMqttSseInspectorExplanationsRequest drains the body. Both
// from_unix / to_unix are required. Absence or invalid values
// surface as JSON 400 with a stable error key the SPA can
// localise. Returns (req, true) when the body is acceptable.
func parseMqttSseInspectorExplanationsRequest(w http.ResponseWriter, r *http.Request) (aiMqttSseInspectorExplanationsRequest, bool) {
	var req aiMqttSseInspectorExplanationsRequest
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "missing body")
		return req, false
	}
	defer r.Body.Close()
	bodyBytes, readErr := io.ReadAll(io.LimitReader(r.Body, aiMqttSseInspectorExplanationsMaxBodyBytes))
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
	if req.FromUnix <= 0 {
		writeError(w, http.StatusBadRequest, "from_unix must be > 0")
		return req, false
	}
	if req.FromUnix > aiMqttSseInspectorExplanationsMaxFromUnix {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("from_unix exceeds upper bound %d", aiMqttSseInspectorExplanationsMaxFromUnix))
		return req, false
	}
	if req.ToUnix <= req.FromUnix {
		writeError(w, http.StatusBadRequest, "to_unix must be > from_unix")
		return req, false
	}
	if req.ToUnix-req.FromUnix > aiMqttSseInspectorExplanationsMaxWindowSeconds {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("window (%d s) exceeds cap %d s", req.ToUnix-req.FromUnix, aiMqttSseInspectorExplanationsMaxWindowSeconds))
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
	// 1) Parse + validate the request body.
	req, ok := parseMqttSseInspectorExplanationsRequest(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request
	// resolution honours mid-flight settings changes (model
	// swap, mode flip) without restart. A resolve failure must
	// NOT open the SSE stream — emit JSON 502 so the frontend
	// falls back gracefully.
	if _, err := h.registry.For(r.Context(), mqttsseinspectorexplanations.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai mqtt-sse-inspector-explanations: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit,
	// plus the per-request scope binding (defence against
	// prompt-injection exfiltration).
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, mqttsseinspectorexplanations.FeatureID)
	ctx = diagnostic.WithScopedStreamInspectorWindow(ctx, diagnostic.ScopedStreamInspectorWindow{
		FromUnix: req.FromUnix,
		ToUnix:   req.ToUnix,
	})

	// 4) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(mqttsseinspectorexplanations.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai mqtt-sse-inspector-explanations: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the (now-
	// annotated) context.
	prov, err := h.registry.For(ctx, mqttsseinspectorexplanations.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai mqtt-sse-inspector-explanations: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook.
	// The strategy's tool whitelist is propose-only / read-only
	// so the deny-all hook is never reached in practice —
	// defence in depth.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Stream-state explanation
	// is NOT conversational — there is no chat history. We hand
	// the LLM a deterministic prompt that scopes to the in-
	// scope window and instructs the tool sequence EXACTLY:
	// query_stream_inspector first, then OPTIONALLY
	// retrieve_stream_chunks, then explanation.
	userMsg := buildMqttSseInspectorExplanationsUserMessage(req.FromUnix, req.ToUnix)

	// 8) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("from_unix", req.FromUnix).
			Int64("to_unix", req.ToUnix).
			Msg("ai mqtt-sse-inspector-explanations: dispatcher returned error")
	}
}

// buildMqttSseInspectorExplanationsUserMessage synthesises the
// window-scoped user message the LLM sees. The format is
// deterministic (RFC3339 UTC time strings) so canned goldens
// and provider prompt-hash caches stay stable across boots.
func buildMqttSseInspectorExplanationsUserMessage(fromUnix, toUnix int64) string {
	fromStr := time.Unix(fromUnix, 0).UTC().Format(time.RFC3339)
	toStr := time.Unix(toUnix, 0).UTC().Format(time.RFC3339)
	return fmt.Sprintf(
		"Explain MQTT/SSE/background-job state in the window from_unix=%d to_unix=%d (%s to %s UTC). "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call query_stream_inspector with from_unix=%d and to_unix=%d to fetch the deterministic envelope "+
			"(window bounds, mqtt_connected, mqtt_uptime_seconds, mqtt_topic_patterns, vehicle_count, stale_vehicle_count, "+
			"total_signals, total_batches, aggregate_signals_per_second, vehicles[*], sse_connected_clients, sse_dropped_frames, "+
			"background_jobs[*]). "+
			"(2) OPTIONALLY call retrieve_stream_chunks with the most salient broker / SSE / job phrase as the query, "+
			"restricted to allowed source_types (mqtt_status, sse_status, job_status) — answer gracefully when zero chunks are returned. "+
			"Produce a 3-6 sentence factual explanation grounded strictly in the envelope. "+
			"Name whether the broker is connected, the vehicle_count and stale_vehicle_count, the aggregate_signals_per_second when present, "+
			"the SSE connected_clients and dropped_frames, and any background_jobs whose last_status is not \"ok\". "+
			"Remember: you NEVER invent a vehicle state, never claim a broker event the envelope does not record, "+
			"never invent a background job, and never speculate about root cause beyond what the envelope explicitly states. "+
			"If the envelope is degenerate (broker disconnected AND zero vehicles AND zero jobs), say so plainly rather than padding the explanation. "+
			"Refuse politely if asked to explain a different window than the in-scope tuple.",
		fromUnix, toUnix, fromStr, toStr,
		fromUnix, toUnix,
	)
}

// Compile-time assertion: Handler
// satisfies http.Handler.
var _ http.Handler = (*Handler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the tool interface declared by
// internal/ai/tools/mqtt_sse_inspector_explanations.go. Kept in
// the same file as the handler so the wiring intent is local to
// the slice; mirrors the log-trace-summarization slice's
// AILogTraceWindowSource pattern.
// ---------------------------------------------------------------------

// StreamInspectorSource is the production
// diagnostic.StreamInspectorSource. The canonical baseline
// /api/v1/admin/mqtt/status surface remains reachable to the
// operator at all times — this adapter intentionally returns a
// deterministic empty envelope describing the bound window. The
// strategy's goldens cover the zero-data path and the system
// prompt instructs the LLM to say so plainly.
//
// A future slice that wires a per-window broker-status reader
// can replace this adapter without changing the tool / handler
// / strategy contract. The adapter keeps the FromUnix / ToUnix
// values the handler installed and stringifies them so the LLM
// sees a recognisable window without having to format Unix
// seconds itself.
type StreamInspectorSource struct{}

// NewStreamInspectorSource constructs the deterministic empty
// adapter. No deps. Returned by-pointer for symmetry with the
// other AI* source types.
func NewStreamInspectorSource() *StreamInspectorSource {
	return &StreamInspectorSource{}
}

// StreamInspector implements diagnostic.StreamInspectorSource.
// Returns a deterministic empty envelope describing the bound
// window. No SQL is issued. No state is mutated.
//
// The envelope's slices are non-nil (empty-but-allocated) so
// JSON marshalling renders [] rather than null — keeping the
// LLM's tool-reply parsing predictable.
func (a *StreamInspectorSource) StreamInspector(_ context.Context, fromUnix, toUnix int64) (*diagnostic.StreamInspectorEnvelope, error) {
	if fromUnix <= 0 {
		return nil, fmt.Errorf("aimqttsse: from_unix must be > 0")
	}
	if toUnix <= fromUnix {
		return nil, fmt.Errorf("aimqttsse: to_unix must be > from_unix")
	}
	return &diagnostic.StreamInspectorEnvelope{
		FromUnix:                  fromUnix,
		ToUnix:                    toUnix,
		FromTime:                  time.Unix(fromUnix, 0).UTC().Format(time.RFC3339),
		ToTime:                    time.Unix(toUnix, 0).UTC().Format(time.RFC3339),
		MQTTConnected:             false,
		MQTTBrokerAddress:         "",
		MQTTUptimeSeconds:         0,
		MQTTTopicPatterns:         []string{},
		VehicleCount:              0,
		StaleVehicleCount:         0,
		TotalSignals:              0,
		TotalBatches:              0,
		AggregateSignalsPerSecond: 0,
		Vehicles:                  []diagnostic.StreamVehicleStat{},
		SSEConnectedClients:       0,
		SSEDroppedFrames:          0,
		BackgroundJobs:            []diagnostic.StreamJobStat{},
	}, nil
}

// Compile-time assertion: StreamInspectorSource satisfies
// diagnostic.StreamInspectorSource.
var _ diagnostic.StreamInspectorSource = (*StreamInspectorSource)(nil)
