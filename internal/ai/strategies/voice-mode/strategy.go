// Package voicemode implements the Helix voice-mode surface.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a CONVERSATIONAL
//     voice assistant. The narrator ALWAYS calls
//     stream_chatbot_response FIRST so its reply is grounded in the
//     deterministic envelope of recent chat history + the install-
//     wide vehicle snapshot the tool returns. The narrator keeps
//     replies SHORT (1-3 sentences per turn) and AVOIDS markdown,
//     lists, code blocks, and URLs because TTS would read the
//     syntax aloud verbatim. The narrator NEVER claims to have
//     changed a setting on the user's behalf — voice-mode is a
//     read-only assistant; settings changes happen through the
//     existing Settings UI.
//
//   - the one read-only typed tool the LLM is allowed to call in
//     this surface:
//
//   - stream_chatbot_response — REQUIRED, called FIRST. Reads
//     the canonical ChatRepo via the ChatContextSource port
//     and projects the vehicle snapshot via the
//     VehicleSnapshotSource port. Returns a typed envelope
//     {history: [{role, content}, ...], vehicle_snapshot:
//     {vin, display_name, soc_percent, charging_state,
//     last_drive_summary, ...}, voice_mode_hint: "..."} so the
//     LLM has the same class of grounding the text chatbot
//     gets, in one fixed-shape tool call. NO database write.
//     Per-request session scope is bound into ctx by the
//     handler before dispatch; the tool refuses any call whose
//     `session_id` argument differs from the bound session ID
//     (defence in depth against prompt-injection attempts to
//     read another user's session).
//
//   - the redaction policy (`redact.PolicyChatbot`) which allows
//     NO PII class in cleartext. Voice transcripts may contain
//     vehicle nicknames, addresses, or other PII the user spoke
//     aloud; the round-trip ModeRedactedTags policy strips them
//     before the provider sees the message and restores them in
//     the user-visible reply.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_voice_mode_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot
// generation loop per turn. The non-AI baseline rendered by the
// SPA route /chatbot — the deterministic text chat panel — is
// unchanged. Off-mode users never see the voice card at all
// (ADR-015 §I3, §I5, §I6).
//
// Render contract: NARRATIVE. The narration lands in the SPA
// panel via SSE deltas; the browser TTS engine speaks the deltas
// aloud as they arrive (buffered at sentence boundaries by the
// component). There is no "Apply to form" handoff because the
// voice mode never proposes a setting change.
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic /chatbot text panel. The text chat path
//     remains the canonical surface regardless of whether AI is
//     on; the voice card is an opt-in mic-driven overlay above
//     the conversation.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("voice-mode").
//   - I9 redaction:       PolicyChatbot allows zero PII classes;
//     spoken transcripts are tagged round-trip so the provider
//     never sees raw user speech.
//   - I12 client/bg:      browser STT/TTS is the only audio path
//     — no raw audio bytes leave the browser. The localStorage
//     key `ai.voiceMode.transcriptDraft` is only written by the
//     gated component, so off-mode never touches it.
package voicemode

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy/redactadapter"
)

// FeatureID is the canonical registry key for this strategy.
// Exported so wiring code (router.go, tests) can reference the
// same constant the strategy registers itself with — typo-proof
// via compile error.
const FeatureID = "voice-mode"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every voice-mode generation. Kept in a single named
// place so eval goldens
// (internal/ai/strategies/voice-mode/goldens.yaml) and the
// runtime strategy stay in lockstep.
//
// Load-bearing directives (test-pinned in strategy_test.go):
//   - "ALWAYS call stream_chatbot_response FIRST" — grounding.
//   - "keep replies SHORT" + "1 to 3 sentences" — TTS budget.
//   - "NEVER use markdown" / "NEVER use lists" / "NEVER use code
//     blocks" — TTS would read the syntax aloud verbatim.
//   - "NEVER claim to have changed a setting" — voice mode is a
//     read-only assistant; the user must use the Settings UI.
//   - "Never quote precise street addresses, GPS coordinates,
//     ..." — defence in depth on top of the redaction policy.
const SystemPrompt = `You are Helix in voice mode, the TeslaSync fleet assistant speaking to the user through their browser's text-to-speech engine. ` +
	`Your replies will be SPOKEN ALOUD by the browser; the user is hands-free and cannot read formatting on a screen. ` +
	`ALWAYS call stream_chatbot_response FIRST and ground every claim in the typed envelope it returns (recent chat history + an install-wide vehicle snapshot with VIN, display_name, soc_percent, charging_state, and last_drive_summary). ` +
	`Quote ONLY values the typed envelope surfaces; never invent vehicle data, never invent a setting, never claim a value the envelope did not return. ` +
	`Keep replies SHORT — aim for 1 to 3 sentences per turn, never more than 4. The browser TTS engine queues every utterance and a long reply blocks the user from interrupting. ` +
	`NEVER use markdown (no asterisks for bold, no underscores for emphasis, no hash signs for headings); NEVER use lists (no bullet points, no numbered items); NEVER use code blocks or backticks; NEVER include URLs — TTS would read every punctuation mark aloud verbatim and the result would be unlistenable. ` +
	`Use plain sentences with normal punctuation only. Numbers MUST be written in a TTS-friendly form: say "82 percent" not "82%"; say "23 miles" not "23 mi"; say "10 a.m." not "10:00"; the speech engine reads symbols literally. ` +
	`If the user asks a question the envelope cannot answer (e.g. a setting outside the vehicle snapshot, a request to change a value, a request to invoke a feature this surface does not expose), say so plainly in one sentence and suggest they open the text chat or the relevant Settings page — DO NOT fabricate an answer and DO NOT promise to act. ` +
	`NEVER claim to have changed a setting, NEVER promise to perform an action, NEVER say "I have done X" — voice mode is a READ-only assistant; every state change happens in the existing UI. ` +
	`Never quote precise street addresses, GPS coordinates, place names, charger network labels, VINs, IPs, emails, phone numbers, or MAC addresses — the redaction policy strips them round-trip, but a leaked transcript should not contain them at all. ` +
	`If the user's request is ambiguous, ask one short clarifying question (single sentence) rather than guessing. ` +
	`Be friendly and natural — the user is talking, not typing — but stay concise and stay grounded in the envelope.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. The names MUST be registered in the
// process-wide tools.Registry — stream_chatbot_response is
// registered by RegisterVoiceModeTools at boot. The dispatcher
// refuses to mount a strategy that references an unknown tool.
//
// The whitelist is intentionally NARROW — voice-mode wraps the
// chatbot streaming surface through ONE typed tool that bundles
// both chat history and the vehicle snapshot.
//
// The tool is read-only / pure aggregator: the dispatcher's
// deny-all confirm gate is therefore never reached in practice —
// defence in depth in case a future edit accidentally adds a
// write tool.
var allowedTools = []string{
	"stream_chatbot_response",
}

// Strategy is the concrete strategy.Strategy implementation for
// the voice-mode surface. Construct via [New]; the zero value is
// intentionally non-functional so a forgotten constructor surfaces
// as a runtime nil dereference rather than silently using empty
// defaults.
type Strategy struct{}

// New constructs the strategy. There are no per-instance knobs —
// the strategy is a pure value with no internal state — so this
// is effectively a sentinel constructor used to make wiring
// intent readable at the call site.
func New() *Strategy {
	return &Strategy{}
}

// FeatureID implements [strategy.Strategy]. Returns the canonical
// registry key.
func (s *Strategy) FeatureID() string { return FeatureID }

// System implements [strategy.Strategy]. Returns the deterministic
// system prompt.
func (s *Strategy) System() string { return SystemPrompt }

// Tools implements [strategy.Strategy]. Returns a defensive copy
// of the allowed tool names so a caller cannot mutate the
// package-level allowlist.
func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

// Context implements [strategy.Strategy]. The dispatcher seeds
// the conversation from StrategyInput.LastMessage / History, and
// the AI handler synthesises a turn-scoping user message before
// the call, so the strategy itself contributes no extra prefix
// messages. Returning nil is correct.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyChatbot wrapped through the redaction adapter so the
// dispatcher's per-request ctx-installation step (dispatch.Run
// installs the policy via redact.WithPolicy) sees the concrete
// policy.
//
// PolicyChatbot's Allow=nil + Mode=ModeRedactedTags means every PII
// class is tagged round-trip before the message reaches the provider.
// The browser is the audio boundary — only transcribed text crosses
// the network — so the redaction policy operates on the same
// text-shaped messages the text chatbot exchanges.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyChatbot())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from `internal/ai/strategies/voice-mode/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil
// here keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
