// Package watchfacenlresponse defines the Helix watch-face natural-language response strategy.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a WATCH-SAFE
//     read-only assistant. The narrator ALWAYS calls
//     query_watch_context FIRST so its reply is grounded in the
//     deterministic typed envelope the tool returns (the same
//     vehicle/state fields the existing fixed watch cards
//     surface, plus a small recent-alert history). The narrator
//     keeps replies SHORT (1-2 sentences per turn) and AVOIDS
//     markdown, lists, code blocks, and URLs — a smartwatch
//     screen is 40-45 mm wide; long replies and any rendered
//     markup are unreadable at that size. The narrator NEVER
//     claims to have changed a setting or sent a command —
//     watch-face-nl-response is a READ-only narrator; the
//     deterministic tap-icons on the watch face are the only
//     command path.
//
//   - the one read-only typed tool the LLM is allowed to call:
//
//   - query_watch_context — REQUIRED, called FIRST. Reads
//     the canonical VehicleRepo (primary vehicle), the
//     signal.LiveStateReader (battery, range, charging,
//     locks, climate, sentry), and the NotificationRepo
//     (recent non-critical alert history, max 5 rows,
//     trailing 24 h). Returns a typed envelope
//     {vehicle_name, soc_percent, range_km, range_mi,
//     is_charging, time_to_full_min, is_locked, sentry_mode,
//     inside_temp_c, inside_temp_f, outside_temp_c,
//     outside_temp_f, is_climate_on, recent_alerts[],
//     last_updated} so the LLM has the same class of
//     grounding the fixed watch cards have, with the
//     watch-specific instruction to keep replies short and
//     glanceable. NO database write.
//
//   - the redaction policy (`redact.PolicyChatbot`) which allows
//     NO PII class in cleartext. The envelope intentionally
//     omits GPS coordinates, precise street addresses, charger
//     network labels, VINs, and other location-specific fields —
//     a watch screen has no reason to surface them and a leaked
//     transcript should not contain them. The redaction policy
//     is defence in depth on top of the envelope's narrow
//     projection.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_watch_face_nl_response_handler.go` which
// builds a dispatcher, a stream.Writer (SSE), and runs a one-
// shot generation loop per turn. The non-AI baseline rendered
// by the SPA route /watch — the deterministic fixed cards
// (battery gauge, status icons, tap-commands) — is unchanged.
// Off-mode users never see the AI panel at all (ADR-015 §I3,
// §I5, §I6).
//
// Render contract: NARRATIVE. The narration lands in the SPA
// panel via SSE deltas; there is no "Apply to form" handoff
// because the watch face NL response never proposes a setting
// change or command.
//
// ADR-015 constraints:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic fixed cards rendered on the /watch page.
//     The watch face's battery gauge, status icons, and tap-
//     commands remain the canonical surface regardless of
//     whether AI is on; the AI panel is the opt-in narrator
//     below the watch shell.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("watch-face-nl-response").
//   - I9 redaction:       PolicyChatbot allows zero PII classes;
//     the typed envelope is PII-free by construction (no GPS,
//     no street names, no charger labels). The policy is
//     defence in depth in case a future edit widens the
//     schema.
//   - I12 client/bg:      no client storage keys, no service-
//     worker chunks, no background jobs. PushKinds includes
//     "ai_watch_response" only because the strategy may emit
//     a future push fan-out kind; the kind is registered in
//     the RouteSet so the off-mode dispatcher filter trips
//     on it before delivery.
package watchfacenlresponse

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
const FeatureID = "watch-face-nl-response"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every watch-face-nl-response generation. Kept in a
// single named place so eval goldens
// (internal/ai/strategies/watch-face-nl-response/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// Load-bearing directives (test-pinned in strategy_test.go):
//   - "ALWAYS call query_watch_context FIRST" — grounding.
//   - "keep replies SHORT" + "1 to 2 sentences" — watch budget.
//   - "NEVER use markdown" / "NEVER use lists" / "NEVER use code
//     blocks" — a watch screen renders no rich formatting.
//   - "NEVER claim to have changed a setting" — watch face NL
//     response is a READ-only narrator; the tap-icons on the
//     watch face are the only command path.
//   - "Never quote precise street addresses, GPS coordinates,
//     ..." — defence in depth on top of the redaction policy
//     AND the envelope's narrow projection.
const SystemPrompt = `You are Helix on the TeslaSync watch face, the fleet assistant answering a glance-style question on a 40-45 mm smartwatch screen. ` +
	`Your reply will be rendered in a tiny watch panel; the user is glancing, not reading. ` +
	`ALWAYS call query_watch_context FIRST and ground every claim in the typed envelope it returns (vehicle_name, soc_percent, range_km/range_mi, is_charging, time_to_full_min, is_locked, sentry_mode, inside_temp_c/inside_temp_f, outside_temp_c/outside_temp_f, is_climate_on, recent_alerts as {severity, age_seconds} pairs only, last_updated). ` +
	`Quote ONLY values the typed envelope surfaces; never invent vehicle data, never invent a setting, never claim a value the envelope did not return. ` +
	`Keep replies SHORT — aim for 1 to 2 sentences per turn, never more than 3. A watch screen has room for roughly twenty words; longer replies are unreadable at that size. ` +
	`NEVER use markdown (no asterisks for bold, no underscores for emphasis, no hash signs for headings); NEVER use lists (no bullet points, no numbered items); NEVER use code blocks or backticks; NEVER include URLs — the watch panel renders plain text only. ` +
	`Use plain sentences with normal punctuation only. Numbers should be rendered in the user's preferred display unit when the envelope provides BOTH the SI and the display field (range_km AND range_mi; inside_temp_c AND inside_temp_f); choose whichever matches the user's UnitOfLength / UnitOfTemp hint when one is supplied, otherwise prefer the more concise form. ` +
	`If the user asks a question the envelope cannot answer (e.g. a navigation request, a request to send a vehicle command, a request to change a setting), say so plainly in one sentence and refer them to the watch-face tap icons or the phone app — DO NOT fabricate an answer and DO NOT promise to act. ` +
	`NEVER claim to have changed a setting, NEVER promise to send a vehicle command, NEVER say "I have locked it" or "I have turned on climate" — watch-face-nl-response is a READ-only narrator; the deterministic tap-icons on the watch face are the only command path, and they continue to work regardless of whether this narrator is enabled. ` +
	`Never quote precise street addresses, GPS coordinates, place names, charger network labels, VINs, IPs, emails, phone numbers, or MAC addresses — the redaction policy strips them round-trip, but a leaked transcript should not contain them at all. The envelope intentionally omits these fields, including alert titles and message bodies (recent_alerts entries are the {severity, age_seconds} pair only). ` +
	`If the user's request is ambiguous, ask one short clarifying question (single short sentence) rather than guessing. ` +
	`Be concise and friendly — the user is glancing at a watch — but stay grounded in the envelope.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. The names MUST be registered in the
// process-wide tools.Registry — query_watch_context is
// registered by RegisterWatchFaceNLResponseTools at boot. The
// dispatcher refuses to mount a strategy that references an
// unknown tool.
//
// The whitelist is intentionally narrow: only query_watch_context is registered.
//
// The tool is read-only / pure aggregator: the dispatcher's
// deny-all confirm gate is therefore never reached in practice —
// defence in depth in case a future edit accidentally adds a
// write tool.
var allowedTools = []string{
	"query_watch_context",
}

// Strategy is the concrete strategy.Strategy implementation for
// the watch-face-nl-response surface. Construct via [New]; the
// zero value is intentionally non-functional so a forgotten
// constructor surfaces as a runtime nil dereference rather than
// silently using empty defaults.
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
// PolicyChatbot's Allow=nil +
// Mode=ModeRedactedTags satisfies that contract: every PII class
// is tagged round-trip BEFORE the message reaches the provider
// so a leaked transcript reveals nothing. The typed envelope
// intentionally omits PII (no GPS, no street names, no charger
// labels); the policy is defence in depth in case a future edit
// widens the schema or the user's free-text question contains
// PII the policy will tag round-trip.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyChatbot())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/watch-face-nl-response/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil
// here keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
