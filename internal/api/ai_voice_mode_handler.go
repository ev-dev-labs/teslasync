package api

// Phase-50 / 0055 — V1 Helix voice mode.
//
// ai_voice_mode_handler.go implements the LLM-backed handler at
// POST /api/v1/ai/voice/chat. The flow is a CHAT-style streaming
// turn (mirroring ai_chatbot_handler.go) — voice-mode is a
// conversation: each user utterance is one turn that takes recent
// history into account.
//
//	URL  /api/v1/ai/voice/chat
//	  ↓
//	read JSON body {message: string (<= aiVoiceModeMaxMessageLen),
//	                session_id: string}
//	  ↓
//	persist user turn via *database.ChatRepo (best-effort)
//	  ↓
//	load recent history via *database.ChatRepo (oldest-first)
//	  ↓
//	resolve provider via *provider.Registry.For("voice-mode")
//	  ↓
//	install per-request voice-mode session scope on ctx
//	  (so stream_chatbot_response refuses cross-session calls)
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	build dispatcher with deny-all confirm (strategy declares
//	  zero mutating tools — defence in depth)
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, recordingWriter)
//	  ↓
//	persist accumulated assistant text via *database.ChatRepo
//
// The recordingWriter wraps the SSE writer so the assistant's
// full reply text (delta-by-delta) is captured for persistence.
// The inner SSE writer streams to the user verbatim — no
// buffering. The browser-side AIVoiceMode component buffers
// deltas at sentence boundaries before handing each sentence to
// the browser's SpeechSynthesis engine.
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("voice-mode", …) so when ai_mode='off' or the
// per-feature toggle is off the guard returns 404 BEFORE this
// handler ever sees the request (ADR-015 §I6).
//
// Per-request scope binding (defence in depth vs prompt
// injection): the handler installs the body's session_id into
// ctx via tools.WithScopedVoiceModeSession. The strategy's only
// allowed tool (stream_chatbot_response) refuses any call whose
// `session_id` argument differs from the bound value — so an
// attacker who tries to coax the LLM into "fetch history for
// session_id=admin-1" cannot exfiltrate another user's
// transcript.
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic text /chatbot
//     handler + its /chatbot/history endpoint are unchanged.
//     This handler is an OPT-IN add-on; off-mode users never
//     see it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("voice-mode").
//   - I9 redaction:       PolicyChatbot (Allow=nil, Mode=
//     ModeRedactedTags — every PII class round-tripped) is
//     installed by dispatch.Run from the strategy and applied
//     to EVERY message (including the user message and tool
//     outputs) by the redact decorator at the provider boundary.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline /chatbot
//     JSON shape is added or modified by this slice.
//   - I12 client/bg:      browser STT/TTS is the only audio
//     path. NO raw audio bytes ever cross this handler — the
//     request body is text-only, just like /chatbot.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	voicemode "github.com/ev-dev-labs/teslasync/internal/ai/strategies/voice-mode"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// aiVoiceModeMaxIterations bounds the dispatcher's tool-loop.
// The strategy is exactly stream_chatbot_response → answer; a
// hard ceiling of 6 matches the chatbot handler and tolerates
// the dispatcher's tool-call retry path without bounding any
// realistic conversation.
const aiVoiceModeMaxIterations = 6

// aiVoiceModeMaxBodyBytes caps the request body. The body has
// at most two small fields (message + session_id); bound it
// cheaply. 16 KiB matches the other body-driven AI handlers.
const aiVoiceModeMaxBodyBytes = 16 * 1024

// aiVoiceModeMaxMessageLen caps the user-message free-text
// field. 2000 chars matches the chatbot handler's bound — a
// voice transcript longer than this is almost certainly a
// stuck-mic runaway and would burn tokens before reaching any
// useful tool calls.
const aiVoiceModeMaxMessageLen = 2000

// aiVoiceModeHistoryLimit is the upper bound on how many prior
// messages the handler hands the LLM as context. Picked to
// balance:
//
//   - Token budget: ~16 messages × ~80 tokens avg ≈ 1.3K input
//     tokens. Comfortably under every supported provider's
//     context.
//   - Conversational continuity: voice questions ("what's my
//     battery now?", "how about yesterday?") fit in the last
//     few turns.
//
// History older than this is silently dropped. The full record
// is always kept in the chatbot_messages table for audit and
// the existing /chatbot/history endpoint.
const aiVoiceModeHistoryLimit = 16

// aiVoiceModeRequest is the wire shape for POST
// /api/v1/ai/voice/chat. Mirrors the existing /chatbot endpoint
// so the SPA can call either route without DTO drift.
type aiVoiceModeRequest struct {
	// Message is the user's spoken-and-transcribed text. The
	// SPA's STT layer concatenates browser SpeechRecognition
	// final results into this field before posting.
	Message string `json:"message"`

	// SessionID is the in-scope chat session. The SPA
	// generates one per component-mount and reuses it across
	// turns so the LLM sees the conversation context.
	SessionID string `json:"session_id"`
}

// AIVoiceModeHandler is the HTTP handler for POST
// /api/v1/ai/voice/chat.
//
// Construction is in router.go (so the dispatcher's tool
// registry + provider registry are wired once at boot). The
// handler itself is stateless beyond its constructor inputs and
// is safe for concurrent use across requests.
type AIVoiceModeHandler struct {
	chat       *database.ChatRepo
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
	historyN   int
}

// NewAIVoiceModeHandler constructs the handler. All non-pointer
// arguments are required; the constructor panics on a nil so
// the wiring bug surfaces at boot, not at first request.
//
// chat:       persistence for user/assistant turns.
// registry:   AI provider registry (decorator chain already
//
//	applied).
//
// toolReg:    process-wide tool registry. MUST contain
//
//	stream_chatbot_response (registered by
//	tools.RegisterVoiceModeTools in router.go).
//
// strat:      the voice-mode Strategy (one per process).
// headerName: forward-auth header name; used to extract
//
//	subject for audit.
func NewAIVoiceModeHandler(
	chat *database.ChatRepo,
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AIVoiceModeHandler {
	switch {
	case chat == nil:
		panic("api: NewAIVoiceModeHandler: nil ChatRepo")
	case registry == nil:
		panic("api: NewAIVoiceModeHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAIVoiceModeHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAIVoiceModeHandler: nil strategy.Strategy")
	}
	return &AIVoiceModeHandler{
		chat:       chat,
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiVoiceModeMaxIterations,
		historyN:   aiVoiceModeHistoryLimit,
	}
}

// parseVoiceModeRequest drains the body, enforces the size cap
// + the per-field length cap, and rejects unknown fields so a
// future schema drift surfaces explicitly. Returns (req, true)
// when the body is acceptable.
func parseVoiceModeRequest(w http.ResponseWriter, r *http.Request) (aiVoiceModeRequest, bool) {
	var req aiVoiceModeRequest
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "request body is required")
		return req, false
	}
	defer r.Body.Close()
	bodyBytes, readErr := io.ReadAll(io.LimitReader(r.Body, aiVoiceModeMaxBodyBytes))
	if readErr != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("failed to read body: %v", readErr))
		return req, false
	}
	if len(bytesTrim(bodyBytes)) == 0 {
		writeError(w, http.StatusBadRequest, "request body is required")
		return req, false
	}
	dec := json.NewDecoder(strings.NewReader(string(bodyBytes)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return req, false
	}
	req.Message = strings.TrimSpace(req.Message)
	if req.Message == "" {
		writeError(w, http.StatusBadRequest, "message is required")
		return req, false
	}
	if len(req.Message) > aiVoiceModeMaxMessageLen {
		writeError(w, http.StatusBadRequest, fmt.Sprintf(
			"message length %d exceeds the maximum %d characters",
			len(req.Message), aiVoiceModeMaxMessageLen))
		return req, false
	}
	if req.SessionID == "" {
		// Generate a deterministic per-request session ID
		// when the SPA omits one. Voice mode requires a
		// session for the tool's scope binding to work, so
		// we synthesise one rather than refusing the
		// request — matching the chatbot handler's
		// behaviour.
		req.SessionID = fmt.Sprintf("voice_%d", time.Now().UnixNano())
	}
	return req, true
}

// ServeHTTP implements [http.Handler]. The body is parsed, the
// dispatcher is invoked, and the assistant's full reply is
// persisted after the SSE stream closes. Every error path either
// writes a structured frame onto the SSE stream (when the writer
// has been opened) or a plain JSON 4xx/5xx (before it has).
func (h *AIVoiceModeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Decode + validate request body.
	req, ok := parseVoiceModeRequest(w, r)
	if !ok {
		return
	}

	// 2) Persist the user turn BEFORE calling the LLM. If
	// the LLM fails midway, the user's message is preserved
	// in history so they can see what they asked. Best-
	// effort — a save failure is logged but does not abort
	// the response (matches the existing /chatbot baseline's
	// behaviour).
	userMsg := &models.ChatMessage{
		SessionID: req.SessionID,
		Role:      "user",
		Content:   req.Message,
	}
	if err := h.chat.SaveMessage(r.Context(), userMsg); err != nil {
		log.Warn().Err(err).Str("session_id", req.SessionID).Msg("ai voice-mode: failed to persist user message")
	}

	// 3) Load conversation history (oldest-first). The
	// current ChatRepo.GetHistory returns ASC order, which
	// is what the dispatcher's StrategyInput.History expects
	// (NEWEST LAST). We cap at historyN so the LLM context
	// budget stays bounded.
	rawHistory, err := h.chat.GetHistory(r.Context(), req.SessionID, h.historyN)
	if err != nil {
		log.Warn().Err(err).Str("session_id", req.SessionID).Msg("ai voice-mode: failed to load history; continuing with empty context")
		rawHistory = nil
	}
	history := historyToProviderMessages(rawHistory, req.Message)

	// 4) Resolve provider via the registry. Per-request
	// resolution honours mid-flight settings changes (model
	// swap, mode flip) without restart. A resolve failure
	// must NOT open the SSE stream — emit JSON 502 so the
	// frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), voicemode.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai voice-mode: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 5) Subject + feature-id annotations for audit/rate-
	// limit. SubjectFromRequest returns "" if the header is
	// absent; that's the open-mode value the audit log
	// treats as "anonymous".
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, voicemode.FeatureID)

	// 6) Install the per-request voice-mode session scope
	// BEFORE the dispatcher loop begins. The
	// stream_chatbot_response tool refuses any call whose
	// `session_id` argument differs from the bound value —
	// defence in depth vs prompt injection.
	ctx = tools.WithScopedVoiceModeSession(ctx, tools.ScopedVoiceModeSession{
		SessionID:    req.SessionID,
		HistoryLimit: h.historyN / 2,
	})

	// 7) Open the SSE writer. Stream.New writes the SSE
	// response headers, starts the consumer goroutine, and
	// returns a child ctx that cancels on stall — we pass
	// that ctx to the dispatcher so a stalled consumer kills
	// the upstream call.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(voicemode.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai voice-mode: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 8) Resolve the per-feature provider from the (now-
	// annotated) context. The decorator chain reads the
	// subject + feature-id off the ctx for audit + rate
	// limit accounting.
	prov, err := h.registry.For(ctx, voicemode.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai voice-mode: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 9) Build the dispatcher with a deny-all confirm hook.
	// The voice-mode strategy declares only read-only tools,
	// so the confirm hook never fires — but defence in
	// depth: if a future strategy edit adds a mutating tool
	// by mistake, the dispatcher will REJECT it instead of
	// silently mutating.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 10) Capture deltas while streaming so we can persist
	// the assistant's full reply after the dispatcher
	// returns.
	rec := &recordingStreamWriter{inner: sseW}

	// 11) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: req.Message,
		History:     history,
	}
	if err := d.Run(ctx, h.strategy, in, rec); err != nil {
		log.Error().Err(err).
			Str("subject", subject).
			Str("session_id", req.SessionID).
			Msg("ai voice-mode: dispatcher returned error")
	}

	// 12) Persist the assistant turn (best-effort, like the
	// user turn). An empty string is allowed: it surfaces in
	// /chatbot/history as evidence that a turn happened but
	// produced no text.
	assistantText := strings.TrimSpace(rec.text())
	if assistantText != "" {
		assistantMsg := &models.ChatMessage{
			SessionID: req.SessionID,
			Role:      "assistant",
			Content:   assistantText,
		}
		if perr := h.chat.SaveMessage(context.Background(), assistantMsg); perr != nil {
			log.Warn().Err(perr).Str("session_id", req.SessionID).Msg("ai voice-mode: failed to persist assistant message")
		}
	}
}

// ---------------------------------------------------------------------------
// Production source adapter: AIVoiceModeChatContextSource
// ---------------------------------------------------------------------------

// AIVoiceModeChatContextSource is the production adapter
// satisfying tools.ChatContextSource. It wraps the canonical
// *database.ChatRepo so the AI tool reads from the SAME data
// source the deterministic Settings UI's chat history endpoint
// already does — no new SQL, no duplicate read paths.
//
// The adapter performs ONE call against ChatRepo.GetHistory per
// tool invocation. The read is cheap: the canonical table is
// indexed on (session_id, created_at).
type AIVoiceModeChatContextSource struct {
	chat *database.ChatRepo
}

// NewAIVoiceModeChatContextSource constructs the production
// adapter. The repo is required; the constructor panics on a
// nil so the wiring bug surfaces at boot, not at first request.
func NewAIVoiceModeChatContextSource(c *database.ChatRepo) *AIVoiceModeChatContextSource {
	if c == nil {
		panic("api: NewAIVoiceModeChatContextSource: nil chat *database.ChatRepo")
	}
	return &AIVoiceModeChatContextSource{chat: c}
}

// LoadRecentTurns implements tools.ChatContextSource. Reads the
// canonical chatbot_messages rows via ChatRepo.GetHistory and
// projects them into the typed VoiceModeChatTurn shape the LLM
// consumes. NO new SQL is written — GetHistory is the canonical
// chat-history reader.
//
// Filters out non-{user,assistant} roles defensively — the
// existing chatbot_messages schema only writes those two roles
// today, but a future addition of a "system" sentinel row
// should NOT leak into the LLM's context (the strategy's
// deterministic SystemPrompt is the only system message the
// dispatcher injects).
func (a *AIVoiceModeChatContextSource) LoadRecentTurns(ctx context.Context, sessionID string, limit int) ([]tools.VoiceModeChatTurn, error) {
	rows, err := a.chat.GetHistory(ctx, sessionID, limit)
	if err != nil {
		return nil, fmt.Errorf("ai voice-mode: load chat history: %w", err)
	}
	out := make([]tools.VoiceModeChatTurn, 0, len(rows))
	for _, m := range rows {
		if m == nil {
			continue
		}
		if m.Role != "user" && m.Role != "assistant" {
			continue
		}
		out = append(out, tools.VoiceModeChatTurn{
			Role:    m.Role,
			Content: m.Content,
		})
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Production source adapter: AIVoiceModeVehicleSnapshotSource
// ---------------------------------------------------------------------------

// AIVoiceModeVehicleSnapshotSource is the production adapter
// satisfying tools.VehicleSnapshotSource. It wraps the canonical
// *database.VehicleRepo + *database.DriveRepo +
// signal.LiveStateReader so the AI tool reads from the SAME
// data sources the rest of the API surface already does — no
// new SQL, no duplicate read paths.
//
// The adapter is intentionally NARROW: only the install's
// PRIMARY (first-enrolled, non-archived) vehicle is projected.
// V1 voice mode is single-vehicle; a future per-vehicle
// selection slice would add a vehicle_id binding via the
// ScopedVoiceModeSession scope and the adapter would project
// the bound vehicle instead. For now the install-wide snapshot
// keeps the SPA wiring trivial.
//
// GPS coordinates, precise street addresses, charger network
// labels, and other location-specific fields are DELIBERATELY
// ABSENT from the projection — voice mode is hands-free, the
// LLM has no reason to surface them, and a leaked transcript
// should not contain them.
type AIVoiceModeVehicleSnapshotSource struct {
	vehicles  *database.VehicleRepo
	drives    *database.DriveRepo
	liveState signal.LiveStateReader
}

// NewAIVoiceModeVehicleSnapshotSource constructs the production
// adapter. The repos are required; the constructor panics on a
// nil so the wiring bug surfaces at boot, not at first request.
// liveState may be nil in test builds — when absent, the
// snapshot's soc_percent + charging_state fields render empty
// and the system prompt's "no current data" branch handles it
// gracefully.
func NewAIVoiceModeVehicleSnapshotSource(
	v *database.VehicleRepo,
	d *database.DriveRepo,
	live signal.LiveStateReader,
) *AIVoiceModeVehicleSnapshotSource {
	switch {
	case v == nil:
		panic("api: NewAIVoiceModeVehicleSnapshotSource: nil vehicles *database.VehicleRepo")
	case d == nil:
		panic("api: NewAIVoiceModeVehicleSnapshotSource: nil drives *database.DriveRepo")
	}
	return &AIVoiceModeVehicleSnapshotSource{
		vehicles:  v,
		drives:    d,
		liveState: live,
	}
}

// LoadVehicleSnapshot implements tools.VehicleSnapshotSource.
// Performs THREE narrow read-only fetches:
//
//  1. VehicleRepo.GetAll → pick the first non-archived row
//     (oldest enrollment ID). Empty install ⇒ zero envelope.
//  2. LiveStateReader.LiveState(vehicle.ID) → project
//     battery_level (soc_percent) + charging_state. Missing
//     state ⇒ leave those fields empty so the LLM honestly
//     says "I don't have current vehicle data right now"
//     rather than fabricating one.
//  3. DriveRepo.GetByVehicle(vehicleID, 1, 0, zero-times) →
//     most recent drive; project its distance + start-time
//     into a one-line spoken-style summary. No drive ⇒ leave
//     last_drive_summary empty.
//
// Never returns an error — every fetch failure falls back to
// the partial snapshot so the LLM can still answer with what
// IS available. The strategy's system prompt explicitly handles
// the "I don't have that data" case.
func (a *AIVoiceModeVehicleSnapshotSource) LoadVehicleSnapshot(ctx context.Context) (tools.VoiceModeVehicleSnapshot, error) {
	out := tools.VoiceModeVehicleSnapshot{}

	vehicles, err := a.vehicles.GetAll(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("ai voice-mode: load vehicles failed; snapshot will be empty")
		return out, nil
	}
	var primary *models.Vehicle
	for _, v := range vehicles {
		if v == nil || !v.IsActive() {
			continue
		}
		primary = v
		break
	}
	if primary == nil {
		return out, nil
	}
	out.VIN = primary.VIN
	out.DisplayName = primary.DisplayName

	if a.liveState != nil {
		live, lerr := a.liveState.LiveState(ctx, primary.ID)
		if lerr != nil {
			log.Warn().Err(lerr).Int64("vehicle_id", primary.ID).Msg("ai voice-mode: live state read failed; soc + charging_state will be empty")
		} else {
			if raw, ok := live["battery_level"]; ok {
				if pct, ok := coerceVoiceModeIntPercent(raw); ok {
					out.SOCPercent = &pct
				}
			}
			if raw, ok := live["charging_state"]; ok {
				if s, ok := raw.(string); ok && strings.TrimSpace(s) != "" {
					out.ChargingState = s
				}
			}
		}
	}

	zero := time.Time{}
	drives, derr := a.drives.GetByVehicle(ctx, primary.ID, 1, 0, zero, zero)
	if derr != nil {
		log.Warn().Err(derr).Int64("vehicle_id", primary.ID).Msg("ai voice-mode: last drive read failed; last_drive_summary will be empty")
	} else if len(drives) > 0 && drives[0] != nil {
		out.LastDriveSummary = formatVoiceModeLastDriveSummary(drives[0])
	}

	return out, nil
}

// coerceVoiceModeIntPercent normalises the battery_level signal
// value into an integer percent in [0, 100]. The signal store
// historically wrote floats AND ints (the canonical SI cutover
// stores percent as a float; older rows may still surface as
// int). Returns (0, false) for any value outside [0, 100] so a
// runaway sensor reading does NOT leak into the LLM's context.
func coerceVoiceModeIntPercent(raw any) (int, bool) {
	var pct float64
	switch v := raw.(type) {
	case float64:
		pct = v
	case float32:
		pct = float64(v)
	case int:
		pct = float64(v)
	case int32:
		pct = float64(v)
	case int64:
		pct = float64(v)
	default:
		return 0, false
	}
	if pct < 0 || pct > 100 {
		return 0, false
	}
	return int(math.Round(pct)), true
}

// formatVoiceModeLastDriveSummary projects a *models.Drive into
// a one-line spoken-style summary the strategy can quote
// verbatim. Pulled out for hermetic unit testing.
//
// Format: "<distance_miles> miles on <relative_day>" where
// relative_day is "today", "yesterday", or the date in "Jan 2"
// form. Distance is rounded to the nearest whole mile because
// voice mode renders in the user's display units AND TTS
// reads fractional miles awkwardly. NEVER includes street
// names, GPS coordinates, or destination labels.
//
// SI canonicalisation note: Phase-48 stored distance in meters
// (DistanceM). The voice-mode tool envelope's
// last_drive_summary is the ONE place the backend renders a
// display-unit value before the LLM consumes it — this matches
// the `cToFPtr` precedent in drive_coaching.go that emits both
// SI + display fields when the LLM cannot be trusted to do
// arithmetic on negative or fractional values.
func formatVoiceModeLastDriveSummary(d *models.Drive) string {
	if d == nil || d.DistanceM <= 0 {
		return ""
	}
	miles := d.DistanceM / 1609.344
	if miles < 0.5 {
		// A sub-half-mile drive is almost certainly a
		// telemetry artefact (parking lot maneuver) — skip
		// it rather than letting the LLM open with "you
		// drove 0 miles".
		return ""
	}
	rounded := int(math.Round(miles))

	when := "recently"
	if !d.StartTs.IsZero() {
		now := time.Now()
		today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
		yesterday := today.AddDate(0, 0, -1)
		startDay := time.Date(d.StartTs.Year(), d.StartTs.Month(), d.StartTs.Day(), 0, 0, 0, 0, d.StartTs.Location())
		switch {
		case startDay.Equal(today):
			when = "today"
		case startDay.Equal(yesterday):
			when = "yesterday"
		default:
			when = d.StartTs.Format("January 2")
		}
	}

	noun := "miles"
	if rounded == 1 {
		noun = "mile"
	}
	return fmt.Sprintf("%d %s %s", rounded, noun, when)
}
