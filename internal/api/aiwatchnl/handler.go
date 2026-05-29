package aiwatchnl

// Phase-50 / 0056 — V2 Helix watch face natural-language response.
//
// ai_watch_face_nl_response_handler.go implements the LLM-backed
// handler at POST /api/v1/ai/watch/respond. The flow mirrors
// ai_safety_setting_explainer_handler.go (the closest predecessor
// — body-driven, one-shot read-only narration, no chat-history
// persistence):
//
//	URL  /api/v1/ai/watch/respond
//	  ↓
//	read JSON body (optional field: message string [<=1000 char]) —
//	  the field falls back to a deterministic "what is my watch
//	  face showing?" prompt so the SPA can post {} for the most
//	  common case
//	  ↓
//	resolve provider via *provider.Registry.For("watch-face-nl-response")
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	synthesise the user-message that scopes the question to the
//	  watch-face envelope and instructs the tool sequence
//	  (query_watch_context → narrate)
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("watch-face-nl-response", …) so when ai_mode='off'
// or the per-feature toggle is off the guard returns 404 BEFORE
// this handler ever sees the request (ADR-015 §I6).
//
// No per-request scope binding is needed: the watch face is
// install-scoped (primary vehicle is install-wide). The handler
// still reads the forward-auth subject for audit/rate-limit
// annotations, but the tool reads no per-user data so a
// missing subject does NOT prevent the request from running
// (the strategy + tool surface the install's primary vehicle
// state).
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic /api/v1/watch/summary
//     handler + the existing /watch SPA page are unchanged. This
//     handler is an OPT-IN add-on; off-mode users never see it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("watch-face-nl-response").
//   - I9 redaction:       PolicyChatbot (Allow=nil, Mode=
//     ModeRedactedTags — every PII class round-tripped) is
//     installed by dispatch.Run from the strategy and applied
//     to EVERY message (including the synthesised user message
//     and tool outputs) by the redact decorator at the provider
//     boundary. The typed envelope the tool returns is PII-free
//     by construction (scalar vehicle-state values only, alert
//     entries are the {severity, age_seconds} pair only); this
//     policy is defence-in-depth.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline
//     /api/v1/watch/summary JSON shape is added or modified by
//     this slice.
//   - I12 client/bg:      no client storage keys, no service-
//     worker chunks, no background jobs added by this slice;
//     the registered PushKind 'ai_watch_response' is reserved
//     for the off-mode push-kind filter and is not emitted
//     yet.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	watchfacenlresponse "github.com/ev-dev-labs/teslasync/internal/ai/strategies/watch-face-nl-response"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/nl"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// maxIterations bounds the dispatcher's
// tool-loop. The strategy is exactly query_watch_context →
// answer. A hard ceiling of 6 is generous for a single-tool
// surface; the chat-style narrator handlers use 8 with two
// tools, so 6 leaves ample headroom for retries.
const maxIterations = 6

// maxBodyBytes caps the request body.
// The body has at most one small free-text field; bound it
// cheaply. 16 KiB matches the other body-driven AI handlers.
const maxBodyBytes = 16 * 1024

// maxMessageLen caps the optional message
// free-text field. 1000 chars is the same bound the
// voice-mode handler uses for its message field — half the
// chatbot cap because watch users are typically typing on a
// 40-45 mm screen and a runaway paste is even less likely than
// in the desktop chatbot.
const maxMessageLen = 1000

// recentAlertWindow caps how far back the
// production alert-history adapter looks for the recent-alerts
// projection. 24 hours is the same window the deterministic
// alert dashboard's "today" filter uses; it keeps the LLM's
// recall focused on glance-relevant events rather than long-
// past noise.
const recentAlertWindow = 24 * time.Hour

// alertLookbackRows is the upper bound on
// how many notification_log rows the production adapter pulls
// from the DB. We pull a generous superset because the adapter
// then filters out critical-severity rows AND caps the result
// at tools.maxWatchAlerts (5). 64 rows in 24 h is a comfortable
// margin even for noisy installs without paginating.
const alertLookbackRows = 64

// request is the typed body shape. The
// `message` field is optional; the handler falls back to a
// deterministic "what is my watch face showing?" prompt when
// absent so the SPA can POST {} for the most common case.
type request struct {
	// Message is the user's free-text question about their
	// watch face (e.g. "how much battery do I have left?").
	// Optional; defaults to a generic "summarise the watch
	// face" prompt when absent. Bounded by
	// maxMessageLen.
	Message string `json:"message,omitempty"`
}

// Handler is the HTTP handler for
// POST /api/v1/ai/watch/respond.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired
// once at boot.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewHandler constructs the handler.
// All non-pointer arguments are required; the constructor
// panics on a nil so the wiring bug surfaces at boot, not at
// first request.
//
// registry:   AI provider registry (decorator chain already
//
//	applied).
//
// toolReg:    process-wide tool registry. MUST contain
//
//	query_watch_context (registered by
//	nl.RegisterWatchFaceNLResponseTools in
//	router.go).
//
// strat:      the watch-face-nl-response Strategy (one per
//
//	process).
//
// headerName: forward-auth header name; used for audit
//
//	annotations only — the watch envelope is install-
//	scoped, so a missing subject does NOT prevent
//	the request from running.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aiwatchnl: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aiwatchnl: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aiwatchnl: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// denyAllConfirm is the dispatcher's user-confirm hook. The watch
// narrator declares only read-only tools, so this should never be
// called; if a future edit accidentally adds a mutating tool, fail
// closed instead of mutating fleet state.
func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// parseRequest drains the body. The
// field is optional; the handler falls back to a deterministic
// "what is my watch face showing?" prompt when absent. An empty
// body ({} or even a missing body) is acceptable. Unknown
// fields are rejected so a future schema drift surfaces
// explicitly. Returns (req, true) when the body is acceptable.
func parseRequest(w http.ResponseWriter, r *http.Request) (request, bool) {
	var req request
	if r.Body == nil {
		return req, true
	}
	defer r.Body.Close()
	bodyBytes, readErr := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes))
	if readErr != nil {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("failed to read body: %v", readErr))
		return req, false
	}
	if len(trimASCIIWhitespace(bodyBytes)) == 0 {
		return req, true
	}
	dec := json.NewDecoder(strings.NewReader(string(bodyBytes)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return req, false
	}
	if m := strings.TrimSpace(req.Message); len(m) > maxMessageLen {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf(
			"message length %d exceeds the maximum %d characters",
			len(m), maxMessageLen))
		return req, false
	} else {
		req.Message = m
	}
	return req, true
}

// trimASCIIWhitespace is a defensive ASCII whitespace trimmer used
// only by the body-empty check. Avoids importing bytes for one call.
func trimASCIIWhitespace(b []byte) []byte {
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
// dispatcher's deferred WriteDone. Every error path either
// writes a structured frame onto the SSE stream (when the
// writer has been opened) or a plain JSON 4xx/5xx (before it
// has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the request body.
	req, ok := parseRequest(w, r)
	if !ok {
		return
	}

	// 2) Read the forward-auth subject for audit/rate-limit
	// annotations. The watch envelope is INSTALL-scoped so a
	// missing subject does NOT prevent the request from
	// running — this surface narrates install-wide primary-
	// vehicle state, not per-user state. Empty subject still
	// annotates the audit log as anonymous.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)

	// 3) Resolve provider via the registry. Per-request
	// resolution honours mid-flight settings changes (model
	// swap, mode flip) without restart. A resolve failure
	// must NOT open the SSE stream — emit JSON 502 so the
	// frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), watchfacenlresponse.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai watch-face-nl-response: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 4) Subject + feature-id annotations for audit/rate-
	// limit. No per-request tool-scope binding is needed
	// (the watch envelope is install-scoped).
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, watchfacenlresponse.FeatureID)

	// 5) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(watchfacenlresponse.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai watch-face-nl-response: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 6) Resolve the per-feature provider from the (now-
	// annotated) context.
	prov, err := h.registry.For(ctx, watchfacenlresponse.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai watch-face-nl-response: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 7) Build the dispatcher with the deny-all confirm hook.
	// The strategy's tool whitelist is pure-read so the
	// deny-all hook is never reached in practice — defence
	// in depth.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 8) Synthesise the user message. The narration is NOT
	// conversational — there is no chat history. We hand the
	// LLM a deterministic prompt that scopes to the watch
	// envelope and instructs the tool sequence EXACTLY:
	// query_watch_context first, then narration.
	userMsg := buildUserMessage(req.Message)

	// 9) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Str("subject", subject).
			Int("message_len", len(req.Message)).
			Msg("ai watch-face-nl-response: dispatcher returned error")
	}
}

// buildUserMessage synthesises the user
// message the LLM sees. The format is deterministic so canned
// goldens and provider prompt-hash caches stay stable across
// boots.
//
// When the body's message is empty, the synthesised message
// is a generic "summarise the watch face" prompt; when the
// body's message is set, it is forwarded verbatim AFTER the
// tool-sequence preamble so the LLM still respects the
// query_watch_context-first directive.
func buildUserMessage(message string) string {
	message = strings.TrimSpace(message)
	if message == "" {
		message = "Give me a glance summary of my watch face right now — the most relevant one or two of: battery, range, charging status, locks, and climate."
	}
	return fmt.Sprintf(
		"The user has asked from their watch face: %q. "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call query_watch_context with no arguments to fetch the deterministic typed envelope of the primary vehicle's state "+
			"(vehicle_name, soc_percent, range_km AND range_mi, is_charging, time_to_full_min, is_locked, sentry_mode, inside_temp_c AND inside_temp_f, outside_temp_c AND outside_temp_f, is_climate_on, recent_alerts as {severity, age_seconds} pairs, last_updated). "+
			"(2) Produce a SHORT 1-2 sentence reply (never more than 3) grounded strictly in the typed envelope. "+
			"Quote ONLY values the envelope surfaced; choose km vs mi and °C vs °F based on the user's UnitOfLength / UnitOfTemp hint when supplied. "+
			"NEVER use markdown, lists, code blocks, or URLs — the watch panel renders plain text only and is roughly 40-45 mm wide. "+
			"NEVER claim to have changed a setting, NEVER promise to send a vehicle command, NEVER say 'I have locked it' — refer the user to the watch-face tap icons or the phone app instead. "+
			"If the envelope cannot answer the question (e.g. a navigation request, a request that needs a setting change), say so plainly in one sentence and direct the user to the tap icon or the phone app. "+
			"If the user's request is ambiguous, ask ONE short clarifying question (single short sentence) rather than guessing.",
		message,
	)
}

// ---------------------------------------------------------------------------
// Production source adapters
// ---------------------------------------------------------------------------

// ContextSource is the production adapter
// satisfying nl.WatchContextSource. It wraps the canonical
// *vehicledb.VehicleRepo + *signal.RedisSignalCache so the AI
// tool reads from the SAME data sources the deterministic
// /watch/summary handler already does — no new SQL, no
// duplicate live-state reads.
//
// The adapter performs ONE VehicleRepo.GetAll + ONE
// RedisSignalCache.GetAll per request. Both reads are cheap;
// the canonical /watch/summary handler runs the same two calls
// per refresh tick.
type ContextSource struct {
	vehicles   *vehicledb.VehicleRepo
	redisCache *signal.RedisSignalCache
}

// NewContextSource constructs the production
// adapter. The vehicle repo is required; the constructor
// panics on a nil so the wiring bug surfaces at boot, not at
// first request. The redis cache is OPTIONAL — when nil, the
// adapter still emits a usable envelope from the VehicleRepo
// alone (vehicle_name only; every live-state field serializes
// as null), mirroring the deterministic /watch/summary
// handler's degraded-mode fallback.
func NewContextSource(v *vehicledb.VehicleRepo, cache *signal.RedisSignalCache) *ContextSource {
	if v == nil {
		panic("aiwatchnl: NewContextSource: nil *vehicledb.VehicleRepo")
	}
	return &ContextSource{vehicles: v, redisCache: cache}
}

// LoadWatchContext implements nl.WatchContextSource. Reads
// the canonical vehicle list + the live signal snapshot for
// the install's primary (first) vehicle. NO new SQL is
// written — the existing GetAll + redis GetAll calls are the
// canonical readers.
//
// Every absent reading serializes as JSON null (typed-nil
// `any`) so the LLM's system prompt can honestly hedge on
// missing data rather than fabricating a value.
func (a *ContextSource) LoadWatchContext(ctx context.Context) (*nl.WatchContextEnvelope, error) {
	vehicles, err := a.vehicles.GetAll(ctx)
	if err != nil {
		return nil, fmt.Errorf("ai watch-face-nl-response: list vehicles: %w", err)
	}
	if len(vehicles) == 0 {
		// Empty install — return an envelope with everything
		// null so the LLM can honestly say "no vehicle
		// configured". RecentAlerts is left nil; the tool
		// promotes it to an empty slice before returning.
		return &nl.WatchContextEnvelope{
			LastUpdated: time.Now().UTC().Format(time.RFC3339),
			Source:      "reader: internal/database/vehicle_repo.go VehicleRepo.GetAll (empty install)",
		}, nil
	}
	primary := vehicles[0]
	env := &nl.WatchContextEnvelope{
		VehicleName: primary.DisplayName,
		LastUpdated: time.Now().UTC().Format(time.RFC3339),
		Source:      "reader: internal/database/vehicle_repo.go VehicleRepo.GetAll + internal/signal/redis_signal_cache.go RedisSignalCache.GetAll (canonical /watch/summary read path)",
	}
	if a.redisCache == nil {
		// No live signal source — return the vehicle-only
		// envelope. Every live-state field serializes as
		// null, which is the honest behaviour.
		return env, nil
	}
	signals, sigErr := a.redisCache.GetAll(ctx, primary.ID)
	if sigErr != nil || signals == nil {
		// Live-state read failed — same honest degraded-mode
		// behaviour. The /watch/summary handler logs and
		// continues with vehicle-only info; we do the same
		// here so the LLM can hedge ("I don't have a live
		// reading right now").
		log.Warn().Err(sigErr).Int64("vehicle_id", primary.ID).Msg("ai watch-face-nl-response: live signal snapshot unavailable")
		return env, nil
	}
	projectSignals(env, signals)
	return env, nil
}

// projectSignals mutates env in place, copying the
// live-signal values into the typed envelope. Pulled out for
// hermetic unit testing — the test feeds a known signals map
// and asserts every supported field is projected with the
// expected SI/display dual-unit pair where applicable.
//
// Mirrors internal/api/watch_handler.go's queryWatchSummary
// projection so the AI tool sees the same shape the
// deterministic /watch/summary handler does:
//
//   - BatteryLevel → SOCPercent (int %)
//   - RatedRange   → RangeMi (verbatim, miles canonical wire
//     format) AND RangeKm (×1.60934)
//   - InsideTemp   → InsideTempC (°C SI) AND InsideTempF
//     (cToFPtr-style precomputed °F)
//   - OutsideTemp  → OutsideTempC + OutsideTempF
//   - ChargeState  → IsCharging bool
//   - TimeToFullCharge → TimeToFullMin (×60 for minutes)
//   - Locked       → IsLocked (bool/string/float fallback)
//   - SentryMode   → SentryMode (bool/string/float fallback)
//   - HvacPower    → IsClimateOn (bool/string/float fallback)
func projectSignals(env *nl.WatchContextEnvelope, signals map[string]interface{}) {
	if env == nil || signals == nil {
		return
	}
	if v, ok := signalInt(signals, "BatteryLevel"); ok {
		env.SOCPercent = v
	}
	if v, ok := signalFloat(signals, "RatedRange"); ok {
		env.RangeMi = v
		env.RangeKm = v * 1.60934
	}
	if v, ok := signalFloat(signals, "InsideTemp"); ok {
		env.InsideTempC = v
		env.InsideTempF = v*9.0/5.0 + 32.0
	}
	if v, ok := signalFloat(signals, "OutsideTemp"); ok {
		env.OutsideTempC = v
		env.OutsideTempF = v*9.0/5.0 + 32.0
	}
	if v, ok := signalFloat(signals, "TimeToFullCharge"); ok {
		env.TimeToFullMin = v * 60.0
	}
	if v, ok := signalStr(signals, "ChargeState"); ok {
		env.IsCharging = v == enums.ChargeStateCharging || v == "charging" || v == "Charging"
	}
	if v, ok := signals["Locked"]; ok && v != nil {
		switch b := v.(type) {
		case bool:
			env.IsLocked = b
		case string:
			env.IsLocked = b == "true"
		case float64:
			env.IsLocked = b > 0
		}
	}
	if v, ok := signals["SentryMode"]; ok && v != nil {
		switch b := v.(type) {
		case bool:
			env.SentryMode = b
		case string:
			env.SentryMode = b == "true" || b == "On"
		case float64:
			env.SentryMode = b > 0
		}
	}
	if v, ok := signals["HvacPower"]; ok && v != nil {
		switch hv := v.(type) {
		case bool:
			env.IsClimateOn = hv
		case string:
			env.IsClimateOn = enums.ParseHvacPower(hv)
		case float64:
			env.IsClimateOn = hv > 0
		}
	}
}

func signalFloat(signals map[string]interface{}, keys ...string) (float64, bool) {
	for _, key := range keys {
		if v, ok := signals[key]; ok {
			return signal.Float64(v)
		}
	}
	return 0, false
}

func signalInt(signals map[string]interface{}, keys ...string) (int, bool) {
	for _, key := range keys {
		if v, ok := signals[key]; ok {
			if f, ok := signal.Float64(v); ok {
				return int(f), true
			}
		}
	}
	return 0, false
}

func signalStr(signals map[string]interface{}, keys ...string) (string, bool) {
	for _, key := range keys {
		if v, ok := signals[key]; ok {
			if s, ok := v.(string); ok && s != "" {
				return s, true
			}
		}
	}
	return "", false
}

// AlertHistorySource is the production adapter
// satisfying nl.AlertHistorySource. It wraps the canonical
// *dbnotif.NotificationRepo so the AI tool reads from the
// SAME data source the deterministic notifications list page
// already does — no new SQL, no duplicate read paths.
//
// The adapter performs ONE NotificationRepo.GetLogs per
// request and then applies the projection invariants in Go:
// exclude critical severities, exclude rows older than the
// recent-alert window, cap at `max`, sort most-recent first,
// project away every PII-bearing free-text field.
type AlertHistorySource struct {
	notifications *dbnotif.NotificationRepo
}

// NewAlertHistorySource constructs the production
// adapter. The repo is required; the constructor panics on a
// nil so the wiring bug surfaces at boot, not at first request.
func NewAlertHistorySource(n *dbnotif.NotificationRepo) *AlertHistorySource {
	if n == nil {
		panic("aiwatchnl: NewAlertHistorySource: nil *dbnotif.NotificationRepo")
	}
	return &AlertHistorySource{notifications: n}
}

// LoadRecentAlerts implements nl.AlertHistorySource. Reads
// the canonical NotificationLog rows ordered by created_at
// DESC and projects {severity, age_seconds} only. The
// projection invariants enforce the privacy + UX contract:
//
//   - exclude critical-severity rows (those are surfaced by
//     the dedicated /alerts route and the deterministic push
//     channel; a watch-face NL narrator is the wrong surface),
//   - exclude rows older than recentAlertWindow
//     (24 h — keeps the LLM focused on glance-relevant events),
//   - cap at max entries (the tool passes 5),
//   - sort most-recent first (NotificationRepo.GetLogs
//     already returns DESC created_at, so we preserve order),
//   - project away every PII-bearing free-text field
//     (Title and Message bodies may contain custom rule names
//     / vehicle names / place names; AlertID, ChannelID,
//     LatencyMs are irrelevant operational data).
func (a *AlertHistorySource) LoadRecentAlerts(ctx context.Context, max int) ([]nl.WatchAlertEntry, error) {
	if max <= 0 {
		return []nl.WatchAlertEntry{}, nil
	}
	rows, err := a.notifications.GetLogs(ctx, alertLookbackRows, 0)
	if err != nil {
		return nil, fmt.Errorf("ai watch-face-nl-response: load notification logs: %w", err)
	}
	return projectAlertEntries(rows, max, time.Now()), nil
}

// projectAlertEntries projects the canonical
// *notificationmodel.NotificationLog rows into the narrow
// nl.WatchAlertEntry slice. Pulled out for hermetic unit
// testing — the test feeds a known row list and asserts the
// projection invariants (critical exclusion, window
// exclusion, cap, severity preservation, age_seconds
// computation) hold.
//
// `now` is injected so the tests can pin the computed
// age_seconds to a deterministic value rather than calling
// time.Now() inside the projection.
func projectAlertEntries(rows []*notificationmodel.NotificationLog, max int, now time.Time) []nl.WatchAlertEntry {
	if max <= 0 {
		// Defensive early-return BEFORE the make below: a
		// negative cap on make([]…, 0, max) panics, and a
		// max=0 cap means the slice cannot hold any entries
		// anyway.
		return []nl.WatchAlertEntry{}
	}
	out := make([]nl.WatchAlertEntry, 0, max)
	for _, row := range rows {
		if row == nil {
			continue
		}
		sev := strings.ToLower(strings.TrimSpace(row.Severity))
		// Critical alerts are excluded; the watch-face NL
		// narrator is the wrong surface for life-safety
		// events. The dedicated /alerts route + push
		// channel cover those.
		if sev == "critical" {
			continue
		}
		// Window exclusion: only the trailing 24 h is
		// relevant for a glance-style narrator.
		age := now.Sub(row.CreatedAt)
		if age < 0 || age > recentAlertWindow {
			continue
		}
		out = append(out, nl.WatchAlertEntry{
			Severity:   sev,
			AgeSeconds: int64(age.Seconds()),
		})
		if len(out) >= max {
			break
		}
	}
	return out
}

// Compile-time assertions: Handler
// satisfies http.Handler and the production source adapters
// satisfy their respective tool ports.
var (
	_ http.Handler          = (*Handler)(nil)
	_ nl.WatchContextSource = (*ContextSource)(nil)
	_ nl.AlertHistorySource = (*AlertHistorySource)(nil)
)
