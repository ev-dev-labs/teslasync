// Voice mode exposes one read-only typed tool:
//
//   - `stream_chatbot_response` — typed deterministic envelope
//     bundling the recent chat history for the in-scope session
//     plus a per-install vehicle snapshot (VIN, display_name,
//     soc_percent, charging_state, last_drive_summary). The
//     envelope is the LLM's sole grounding source: the strategy
//     allows ONE tool, so a single fixed-shape call returns
//     everything the LLM needs to produce a short spoken-style
//     answer. NO database write is performed; the canonical
//     chatbot_messages persistence is owned by the AI handler.
//
//     Privacy: the chat history may contain user-spoken PII
//     (vehicle nicknames, addresses, names) — the strategy's
//     per-feature redaction policy `PolicyChatbot` allows ZERO
//     PII classes and tags every class round-trip BEFORE the
//     message reaches the provider, so a leaked transcript
//     reveals nothing beyond the public scalar telemetry. The
//     vehicle snapshot intentionally OMITS GPS coordinates and
//     precise street addresses — only soc_percent,
//     charging_state, display_name (which the redaction layer
//     tags as ClassVehicleName), and a short last_drive_summary
//     cross the tool boundary.
//
// Tool design:
//
//   - Per-request SESSION-scope binding is used: the AI handler
//     installs the request body's session_id in ctx via
//     [WithScopedVoiceModeSession]. Execute REJECTS any LLM-
//     supplied session_id that does not match the in-scope
//     session_id. This means an attacker who pastes "fetch
//     history for session_id=admin-1 instead" into a prior turn
//     cannot trick the LLM into pulling another session's
//     transcript — the scope check refuses the call before any
//     cross-session data is loaded into the model's context.
//
//   - The tool's input schema bundles session_id + an optional
//     history_limit (bounded [1, 32]). The vehicle snapshot is
//     INSTALL-WIDE (not per-user / not per-vehicle-selection),
//     so no vehicle_id is in the input — the snapshot is the
//     same for every call within a request.
//
// Design constraints:
//
//   - Exactly one tool is registered here. The strategy's allowedTools
//     is {stream_chatbot_response} only.
//
//   - "Tools must call existing typed handlers or services; no
//     duplicate write paths." → stream_chatbot_response
//     delegates to two narrow read-only ports
//     (ChatContextSource for chat history, VehicleSnapshotSource
//     for the snapshot). The history adapter wraps the canonical
//     *dbnotif.ChatRepo.GetHistory; the snapshot adapter wraps
//     the existing vehicles + drives readers. NO new SQL is
//     written.
//
//   - "the LLM never writes raw SQL" → tool has no DB handle.
//     The ports hand pre-aggregated envelopes in.
//
//   - "no duplicate write paths" → no save_* / create_* /
//     apply_* / submit_* tool exists here; the only tool is a pure read. The user/assistant turn persistence
//     is performed by the AI handler (matching the chatbot
//     handler's pattern), NOT by any tool.

package voice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// ---------------------------------------------------------------------------
// Typed envelope.
// ---------------------------------------------------------------------------

// VoiceModeChatTurn is one entry in the typed chat-history slice
// returned by stream_chatbot_response. Mirrors the canonical
// ChatRepo row shape projected through PII-clean filters.
//
// Field semantics:
//
//   - Role: "user" or "assistant". The history NEVER includes
//     "system" turns; the strategy's deterministic SystemPrompt
//     is the only system message the LLM sees.
//   - Content: the redacted-text content of the turn. Voice
//     transcripts may contain PII (vehicle nicknames, addresses,
//     names the user spoke aloud); the redaction layer at the
//     provider boundary tags every PII class round-trip so the
//     provider sees redacted tags only.
type VoiceModeChatTurn struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// VoiceModeVehicleSnapshot is the install-wide vehicle snapshot
// returned by stream_chatbot_response. Intentionally NARROW: only
// the fields the LLM needs to ground a 1-3 sentence spoken-style
// answer cross the tool boundary. GPS coordinates, precise street
// addresses, charger network labels, and other location-specific
// fields are DELIBERATELY ABSENT — voice mode is hands-free, so
// the LLM has no reason to surface them and a leaked transcript
// should not contain them.
//
// All fields are optional (pointer types or empty-string sentinel)
// so an install with no vehicles or a vehicle with stale state
// degrades to "I don't have current vehicle data right now" rather
// than crashing the dispatcher with a nil-deref.
type VoiceModeVehicleSnapshot struct {
	// VIN is the vehicle identification number. Empty when no
	// vehicle has been hydrated yet (fresh install). The
	// redaction policy tags VINs round-trip so the provider
	// sees a redacted tag.
	VIN string `json:"vin,omitempty"`

	// DisplayName is the user's nickname for the vehicle
	// (e.g. "Bumblebee", "Family car"). The redaction layer
	// tags this as ClassVehicleName round-trip so the
	// provider sees a redacted tag.
	DisplayName string `json:"display_name,omitempty"`

	// SOCPercent is the most recent state-of-charge reading
	// in percent (0..100). Nil when no telemetry has arrived
	// yet. The LLM is instructed by the system prompt to
	// render this in the TTS-friendly "82 percent" form, not
	// "82%".
	SOCPercent *int `json:"soc_percent,omitempty"`

	// ChargingState is the canonical charging state string
	// ("Charging", "Disconnected", "Stopped", "Complete",
	// etc.). Empty when no telemetry has arrived yet.
	ChargingState string `json:"charging_state,omitempty"`

	// LastDriveSummary is a one-line plain-English summary of
	// the most recent completed drive (e.g. "12 miles
	// yesterday afternoon"). Empty when no drives exist or
	// when the snapshot source could not compute one. NEVER
	// includes GPS coordinates or street names.
	LastDriveSummary string `json:"last_drive_summary,omitempty"`
}

// VoiceModeEnvelope is the typed envelope stream_chatbot_response
// returns. Always non-nil with non-nil sub-fields so the LLM can
// safely range over History and dereference VehicleSnapshot in its
// follow-up reply.
type VoiceModeEnvelope struct {
	// History is the recent chat-history projection for the
	// in-scope session. Sorted oldest-first (matching
	// ChatRepo.GetHistory's ASC order). May be empty for a
	// brand-new session.
	History []VoiceModeChatTurn `json:"history"`

	// VehicleSnapshot is the install-wide vehicle snapshot.
	// Never nil — the zero value (empty VIN, nil SOCPercent,
	// empty ChargingState, empty LastDriveSummary) is the
	// honest "no current vehicle data" answer.
	VehicleSnapshot VoiceModeVehicleSnapshot `json:"vehicle_snapshot"`

	// VoiceModeHint is a deterministic instruction the
	// strategy's system prompt already pinned ("Response will
	// be spoken aloud — keep it short, no markdown, no lists,
	// no URLs"). Restated in the tool reply as a per-turn
	// reminder the LLM cannot lose track of mid-conversation.
	VoiceModeHint string `json:"voice_mode_hint"`

	// Source is the dispatcher-visible breadcrumb so the
	// LLM's follow-up prose can attribute the values to the
	// canonical readers rather than its own reasoning.
	Source string `json:"source"`
}

// ---------------------------------------------------------------------------
// Narrow ports.
// ---------------------------------------------------------------------------

// ChatContextSource is the narrow port the
// stream_chatbot_response tool delegates to for chat history. In
// production it is satisfied by *api.AIVoiceModeChatContextSource
// (which wraps the canonical *dbnotif.ChatRepo); in tests we
// substitute deterministic fakes so the tool unit tests stay
// hermetic.
//
// The interface must stay read-only; adding Save or Update would defeat
// the read-only contract in ADR-015 §I3.
type ChatContextSource interface {
	// LoadRecentTurns returns the most-recent `limit` chat
	// turns for `sessionID`, sorted oldest-first (ASC). An
	// empty slice (not nil) is returned for a brand-new
	// session. The adapter is responsible for capping `limit`
	// to a defensive maximum so a runaway LLM request cannot
	// blow the token budget.
	LoadRecentTurns(ctx context.Context, sessionID string, limit int) ([]VoiceModeChatTurn, error)
}

// VehicleSnapshotSource is the narrow port the
// stream_chatbot_response tool delegates to for the install-wide
// vehicle snapshot. In production it is satisfied by
// *api.AIVoiceModeVehicleSnapshotSource; in tests we substitute
// deterministic fakes.
//
// The interface MUST stay read-only — adding a Save / Update
// method here would defeat the read-only contract.
type VehicleSnapshotSource interface {
	// LoadVehicleSnapshot returns the install-wide snapshot.
	// The adapter is responsible for projecting the canonical
	// vehicles + state + drives readers into the narrow
	// VoiceModeVehicleSnapshot shape and EXCLUDING GPS / street-
	// name fields. Returns a zero-valued snapshot (not an
	// error) when the install has no vehicles or no recent
	// telemetry — the strategy's system prompt handles the
	// "no data" branch.
	LoadVehicleSnapshot(ctx context.Context) (VoiceModeVehicleSnapshot, error)
}

// ---------------------------------------------------------------------------
// Per-request voice-mode session scope binding.
// ---------------------------------------------------------------------------

// scopedVoiceModeSessionKey is the unexported context-key type
// used to carry the body-supplied session_id through the
// dispatcher to the tool. A per-package unexported type prevents
// accidental key collisions with any other context value in the
// request lifetime.
type scopedVoiceModeSessionKey struct{}

// ScopedVoiceModeSession is the in-scope session installed by
// the AI handler. The voice-mode surface is one chat session per
// request; the scope contains the in-scope session_id (so the
// dispatcher can refuse cross-session calls) and a default
// history limit.
type ScopedVoiceModeSession struct {
	// SessionID is the in-scope chat session. The AI handler
	// reads the request body's session_id and installs it
	// here BEFORE invoking the dispatcher.
	SessionID string

	// HistoryLimit is the default upper bound on how many
	// chat turns the tool returns when the LLM omits the
	// history_limit argument. Defaulted by the AI handler
	// (typically 8 turns); bounded [1, 32] by the tool's
	// own validate path so an LLM-supplied larger value
	// cannot blow the token budget.
	HistoryLimit int
}

// WithScopedVoiceModeSession returns ctx with s installed as the
// in-scope session for this request. Called by the AI HTTP
// handler AFTER body validation and BEFORE the dispatcher.Run
// loop is started. The dispatcher then propagates ctx unchanged
// through every Tool.Execute call.
//
// Exported so internal/api can install the scope without
// depending on tool-internal types.
func WithScopedVoiceModeSession(ctx context.Context, s ScopedVoiceModeSession) context.Context {
	return context.WithValue(ctx, scopedVoiceModeSessionKey{}, s)
}

// ScopedVoiceModeSessionFromContext returns the in-scope tuple
// and true when one is present, or the zero value / false when
// no scope is installed. The stream_chatbot_response tool is
// scope-bound, so the missing-scope case is a hard failure — the
// AI handler ALWAYS installs the scope, so an absent scope means
// the dispatcher was invoked from an unintended path and the
// call must be refused.
//
// Exported for symmetry with WithScopedVoiceModeSession and so
// unit tests in other packages can inspect what the AI handler
// installed.
func ScopedVoiceModeSessionFromContext(ctx context.Context) (ScopedVoiceModeSession, bool) {
	v, ok := ctx.Value(scopedVoiceModeSessionKey{}).(ScopedVoiceModeSession)
	return v, ok
}

// ---------------------------------------------------------------------------
// stream_chatbot_response
// ---------------------------------------------------------------------------

// voiceModeMaxHistoryLimit caps how many chat turns the tool
// returns in a single call. Picked so an LLM-supplied runaway
// `history_limit` (or a future system-prompt edit that asks for
// more) cannot blow the token budget. 32 turns ≈ 16
// user/assistant pairs ≈ ~2k tokens at typical voice-mode
// transcript lengths — comfortably under every supported
// provider's context.
const voiceModeMaxHistoryLimit = 32

// streamChatbotResponseInput is the typed input shape the
// dispatcher decodes the LLM's tool-call arguments JSON into.
// Validation failures bounce as Tool.Validate errors before any
// port method runs.
type streamChatbotResponseInput struct {
	// SessionID is the in-scope chat session. Required; MUST
	// match the in-scope session_id installed by the AI
	// handler. The scope check refuses any cross-session
	// request before either port is touched.
	SessionID string `json:"session_id" validate:"required" desc:"The in-scope chat session the history is loaded for. MUST match the in-scope session_id installed by the AI handler; cross-session requests are refused at the tool boundary."`

	// HistoryLimit is the upper bound on how many chat turns
	// to return. Optional; defaults to the in-scope handler's
	// default when 0. Bounded [1, 32] — values outside the
	// range bounce as a Validate error.
	HistoryLimit int `json:"history_limit,omitempty" desc:"Upper bound on returned chat turns (oldest-first). Optional; defaults to the handler's per-request default when 0 or absent. Bounded [1, 32]."`
}

// streamChatbotResponse is the read-only tool that returns the
// voice-mode envelope (chat history + vehicle snapshot + hint).
// Construct via RegisterVoiceModeTools so both ports are wired
// before the tool reaches the registry.
type streamChatbotResponse struct {
	chat    ChatContextSource
	vehicle VehicleSnapshotSource
}

// Name implements [Tool].
func (t *streamChatbotResponse) Name() string { return "stream_chatbot_response" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused.
func (t *streamChatbotResponse) Description() string {
	return "Return the deterministic typed envelope grounding a voice-mode chatbot turn. " +
		"Reports {history (oldest-first chat turns for the in-scope session, each {role, content}), vehicle_snapshot (install-wide {vin, display_name, soc_percent, charging_state, last_drive_summary} — NO GPS, NO street names), voice_mode_hint (per-turn reminder to keep the reply short and TTS-friendly), source}. " +
		"The chat history contains user-spoken text that may include vehicle nicknames or other PII — the per-feature redaction policy tags every PII class round-trip before the provider sees it. " +
		"READ-only — no record is created, mutated, or deleted; NO database write. " +
		"Call this FIRST; the envelope is the ground truth for the answer you produce — DO NOT recompute, contradict, or invent a value beyond it. " +
		"The session_id MUST match the in-scope session_id installed by the AI handler; cross-session requests are refused at the tool boundary."
}

// InputSchema implements [Tool].
func (t *streamChatbotResponse) InputSchema() json.RawMessage {
	return tools.CachedSchema(streamChatbotResponseInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *streamChatbotResponse) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
// The tool reads the canonical ChatRepo + vehicle readers but
// does NOT touch the database for writes. User/assistant turn
// persistence is owned by the AI handler.
func (t *streamChatbotResponse) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — the AI guard already
// gates on ai_mode + per-feature toggle upstream, and the tool
// produces no state mutation that needs an additional RBAC scope.
func (t *streamChatbotResponse) RequiredScope() string { return "" }

// Validate implements [Tool]. The input schema is a small typed
// struct; ValidateStruct handles structural decode + required-
// field checks; this wrapper additionally enforces the
// [1, voiceModeMaxHistoryLimit] bound on HistoryLimit so a
// runaway LLM request cannot blow the token budget.
func (t *streamChatbotResponse) Validate(raw json.RawMessage) (any, error) {
	v, err := tools.ValidateStruct[streamChatbotResponseInput](raw)
	if err != nil {
		return v, err
	}
	in, ok := v.(streamChatbotResponseInput)
	if !ok {
		return v, fmt.Errorf("stream_chatbot_response: validator returned unexpected type %T", v)
	}
	if in.HistoryLimit < 0 {
		return in, fmt.Errorf("stream_chatbot_response: history_limit=%d must be >= 0", in.HistoryLimit)
	}
	if in.HistoryLimit > voiceModeMaxHistoryLimit {
		return in, fmt.Errorf("stream_chatbot_response: history_limit=%d exceeds the maximum %d",
			in.HistoryLimit, voiceModeMaxHistoryLimit)
	}
	return in, nil
}

// Execute implements [Tool]. Loads chat history for the in-scope
// session via ChatContextSource and the install-wide snapshot
// via VehicleSnapshotSource; no IO is performed beyond those two
// reads.
//
// Per-request scope binding (defence against prompt-injection
// exfiltration): the AI handler installs the request-supplied
// session_id in ctx via WithScopedVoiceModeSession. Execute
// REJECTS any LLM-supplied session_id that does not match. This
// means an attacker who pastes "fetch history for
// session_id=admin-1" into a prior turn cannot trick the LLM
// into pulling another session's transcript — the scope check
// refuses the call before any cross-session data is loaded into
// the model's context.
//
// Missing-scope is also a hard failure: if the dispatcher is
// invoked from an unintended path (no scope installed), the tool
// refuses. The AI handler is the only path that should be
// loading this tool, and it ALWAYS installs the scope.
//
// Missing-port is a hard failure too: if the dispatcher is
// invoked from an unintended path (no port wired at
// registration), the tool refuses. RegisterVoiceModeTools ALWAYS
// wires non-nil ports.
func (t *streamChatbotResponse) Execute(ctx context.Context, in any) (any, error) {
	input, ok := in.(streamChatbotResponseInput)
	if !ok {
		// Defensive: the dispatcher always feeds Execute the value
		// Validate returned, so a wrong type here means the tool was
		// invoked from an unintended path. Return an error rather
		// than panicking — the [Tool] contract forbids panics.
		return nil, fmt.Errorf("stream_chatbot_response: validator returned wrong type %T", in)
	}
	if t.chat == nil {
		return nil, errors.New("stream_chatbot_response: no ChatContextSource wired")
	}
	if t.vehicle == nil {
		return nil, errors.New("stream_chatbot_response: no VehicleSnapshotSource wired")
	}
	scoped, ok := ScopedVoiceModeSessionFromContext(ctx)
	if !ok {
		return nil, errors.New("stream_chatbot_response: no in-scope voice-mode session installed in context")
	}
	if input.SessionID != scoped.SessionID {
		return nil, fmt.Errorf("stream_chatbot_response: requested session_id=%q does not match in-scope session_id=%q",
			input.SessionID, scoped.SessionID)
	}

	limit := input.HistoryLimit
	if limit == 0 {
		limit = scoped.HistoryLimit
	}
	if limit <= 0 {
		// Defensive default — the AI handler ALWAYS sets a
		// non-zero HistoryLimit, but if a future edit forgets
		// to, fall back to a sensible value rather than
		// returning zero history (which would break the
		// "ground every claim in the envelope" directive).
		limit = 8
	}
	if limit > voiceModeMaxHistoryLimit {
		limit = voiceModeMaxHistoryLimit
	}

	history, err := t.chat.LoadRecentTurns(ctx, scoped.SessionID, limit)
	if err != nil {
		return nil, fmt.Errorf("stream_chatbot_response: load chat history: %w", err)
	}
	if history == nil {
		// Defensive: the strategy's "ground every claim in
		// the envelope" directive depends on the LLM being
		// able to range over History. A nil slice would
		// surface as `null` in the JSON envelope and an
		// adversarial LLM could claim any turn was present;
		// force an empty slice so the absence is honest.
		history = []VoiceModeChatTurn{}
	}

	snapshot, err := t.vehicle.LoadVehicleSnapshot(ctx)
	if err != nil {
		return nil, fmt.Errorf("stream_chatbot_response: load vehicle snapshot: %w", err)
	}

	env := &VoiceModeEnvelope{
		History:         history,
		VehicleSnapshot: snapshot,
		VoiceModeHint:   "Reply will be spoken aloud by the browser TTS engine — keep it to 1-3 sentences, use plain sentences (no markdown, no lists, no code blocks, no URLs), and render numbers in TTS-friendly form (\"82 percent\" not \"82%\").",
		Source:          "readers: internal/database/notification_repo.go ChatRepo.GetHistory (chat history) + internal/database vehicles+state+drives (snapshot)",
	}
	return env, nil
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// VoiceModeSources bundles the narrow ports
// RegisterVoiceModeTools needs. Mirrors
// [SafetySettingExplainerSources].
//
// Production wiring (router.go) instantiates the production
// adapters (*api.AIVoiceModeChatContextSource +
// *api.AIVoiceModeVehicleSnapshotSource); tests substitute
// deterministic fakes.
type VoiceModeSources struct {
	Chat    ChatContextSource
	Vehicle VehicleSnapshotSource
}

// RegisterVoiceModeTools installs the voice-mode tools on r. Router
// wiring keeps registration order deterministic so builtin-name pin
// tests remain stable.
//
// Panics on duplicate registration (Registry.Register panics) —
// a second call is a wiring bug detected at boot, not at first
// request.
func RegisterVoiceModeTools(r *tools.Registry, s VoiceModeSources) {
	r.Register(&streamChatbotResponse{
		chat:    s.Chat,
		vehicle: s.Vehicle,
	})
}
