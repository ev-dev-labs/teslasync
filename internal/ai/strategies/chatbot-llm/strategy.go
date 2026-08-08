// Package chatbotllm defines the LLM-backed fleet assistant strategy.
//
// The strategy declares:
//
//   - the system prompt the dispatcher seeds every conversation with;
//   - the four read-only tools the LLM is allowed to call (every tool
//     wraps an existing read-only repo call — see internal/ai/tools/builtins.go);
//   - the redaction policy (deny-all + round-trip tags so the user sees
//     their VIN restored but the provider only sees `<vin id='1'/>`).
//
// The strategy is consumed by the AI HTTP handler at
// internal/api/ai_chatbot_handler.go which builds a dispatcher, a
// stream.Writer (SSE), and runs the chat loop. The non-AI baseline at
// POST /chatbot is unaffected — see internal/api/chatbot_responder.go
// for the BaselineResponder that wraps the heuristic processQuery.
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the heuristic.
//   - I7 per-feature:     the AI route is gated by guard.Wrap("chatbot-llm").
//   - I9 redaction:       PolicyChatbot allows nothing in cleartext.
package chatbotllm

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy/redactadapter"
)

// FeatureID is the canonical registry key for this strategy. Exported
// so wiring code (router.go, tests) can reference the same constant the
// strategy registers itself with — typo-proof via compile error.
const FeatureID = "chatbot-llm"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every conversation. Kept in a single named place so eval
// goldens (internal/ai/strategies/chatbot-llm/goldens.yaml) and the
// runtime strategy stay in lockstep.
//
// The prompt explicitly forbids hallucinated vehicle data — every
// concrete number must come from a tool call (the dispatcher refuses
// to expose any tool the strategy did not declare in Tools()).
const SystemPrompt = `You are Helix, TeslaSync's evidence-first fleet intelligence copilot. ` +
	`Solve questions by planning the smallest useful sequence of the listed read-only tools, then synthesize the results into a direct answer. ` +
	`For any current or historical fleet claim, call tools first; never invent vehicle IDs, measurements, events, dates, locations, costs, or application behavior. ` +
	`When no valid vehicle_id is established in the conversation, call query_vehicle_count and select only from its returned vehicles array; ask the user only when multiple vehicles remain plausible. ` +
	`You may chain vehicle state, location, battery, drives, charging, alerts, geofences, and efficiency tools to answer cross-domain questions, but do not fetch unrelated data. ` +
	`Treat tool output as SI-canonical source data and follow the user's unit and formatting preferences when explaining it. State the evidence window and material data gaps; distinguish observations, inferences, and recommendations when useful. ` +
	`For questions about using, configuring, or troubleshooting TeslaSync itself, call retrieve_app_knowledge first and cite only source_id values it returned. If no relevant chunk is returned, say that the knowledge base has no match. ` +
	`You are read-only: never claim to have changed a setting, controlled a vehicle, sent a notification, or run an automation. Explain the safe UI path instead, and refuse requests to disable safety limits or take risky actions. ` +
	`Ask one concise clarifying question only when the missing choice would materially change the answer; otherwise state a safe assumption and proceed. ` +
	`Do not reveal hidden chain-of-thought. Give concise conclusions, supporting evidence, confidence or uncertainty, and a practical next step when one is warranted.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. Each name MUST be registered in the
// process-wide tools.Registry (see internal/ai/tools/builtins.go) at
// dispatcher construction time — the dispatcher refuses to mount a
// strategy that references an unknown tool.
//
// The chatbot only reads state. Any strategy that mutates state must
// use mutating tools plus a confirm hook.
var allowedTools = []string{
	"query_vehicle_state",
	"query_drives_recent",
	"query_charges_recent",
	"query_alerts_active",
	"query_battery_status",
	"query_vehicle_count",
	"query_vehicle_location",
	"query_drive_detail",
	"query_charge_detail",
	"query_alerts_recent",
	"query_geofences_list",
	"query_efficiency_period",
	"retrieve_app_knowledge",
}

// Strategy is the concrete strategy.Strategy implementation for the
// LLM chatbot. Construct via [New]; the zero value is intentionally
// non-functional so a forgotten constructor surfaces as a runtime nil
// dereference rather than silently using empty defaults.
type Strategy struct{}

// New constructs the strategy. There are no per-instance knobs — the
// strategy is a pure value with no internal state — so this is
// effectively a sentinel constructor used to make wiring intent
// readable at the call site.
func New() *Strategy {
	return &Strategy{}
}

// FeatureID implements [strategy.Strategy]. Returns the canonical
// registry key.
func (s *Strategy) FeatureID() string { return FeatureID }

// System implements [strategy.Strategy]. Returns the deterministic
// system prompt.
func (s *Strategy) System() string { return SystemPrompt }

// Tools implements [strategy.Strategy]. Returns a defensive copy of
// the allowed tool names so a caller cannot mutate the package-level
// allowlist (the dispatcher does not mutate, but defence-in-depth
// keeps the contract clean).
func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

// Context implements [strategy.Strategy]. The dispatcher already
// seeds the conversation from StrategyInput.History, and the AI
// handler hydrates History from chat repo before the call, so the
// strategy itself contributes no extra prefix messages. Returning
// nil is correct.
//
// Future knowledge-base context would be injected here. For now,
// [System] plus History fully determines dispatcher behaviour.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return []provider.Message{{
		Role: provider.RoleSystem,
		Content: fmt.Sprintf(
			"Current UTC date: %s. Resolve relative periods such as today, yesterday, this week, and last month against this date; preserve timestamps and time zones returned by tools.",
			time.Now().UTC().Format(time.DateOnly),
		),
	}}, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyChatbot through the redaction adapter so the dispatcher's
// per-request ctx-installation step (dispatch.Run installs the policy
// via redact.WithPolicy) sees the concrete deny-all policy.
//
// PolicyChatbot allows NOTHING in cleartext. Every PII reference is
// redacted to a round-trip tag like `<vin id='1'/>`; the redaction
// decorator restores the original value before delivering the LLM's
// response back to the user.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyChatbot())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness loads
// goldens from `internal/ai/strategies/chatbot-llm/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil here
// keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
