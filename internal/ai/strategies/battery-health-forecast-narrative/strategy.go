// Package batteryhealthforecastnarrative defines the LLM-narrated battery health forecast strategy.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a deterministic
//     forecast-driver explainer: narrate WHY the forecast is what it
//     is using ONLY the values returned by the tool reply, never
//     change the forecast itself, never fabricate degradation
//     numbers, and refuse cross-vehicle requests;
//
//   - the single read-only tool the LLM is allowed to call —
//     `query_battery_health_forecast` — which composes the existing
//     *signaldb.SignalLogReader.SignalTrace +
//     ChargeSource.GetByVehicle surfaces through a narrow
//     [BatteryHealthForecaster] port and reuses the package-level
//     helpers (synthesizeBatterySnapshots, predictDegradation,
//     computeRiskFactors) so the AI narration is grounded in the
//     SAME deterministic forecast model the chart uses. The tool is
//     pure-functional: it does NOT mutate fleet state and adds NO
//     new SQL — every read goes through methods that already back
//     the deterministic /analytics/battery-health and
//     /analytics/battery-degradation handlers;
//
//   - the redaction policy (`PolicyBatteryHealthForecastNarrative`)
//     which allows ClassVehicleName only; VIN, lat/long, addresses,
//     and place names remain tagged via round-trip markers so a
//     leaked transcript does not reveal the user's location or
//     identifiers in plain text.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_battery_health_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot generation
// loop. The non-AI baseline rendered by the SPA route /battery
// (BatteryHealthPage) — hero metric cards, "Capacity Trend &
// Prediction" chart, range trend chart, charge level distribution,
// insights panel, recommendations panel — is unchanged. The
// deterministic forecast model remains the canonical baseline;
// off-mode users never see the AI surface at all (ADR-015 §I3, §I5,
// §I6).
//
// ADR-015 constraints:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic Capacity Trend & Prediction chart, hero metric
//     cards, or recommendations panel; it adds an opt-in narrative
//     section alongside.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("battery-health-forecast-narrative").
//   - I9 redaction:       PolicyBatteryHealthForecastNarrative
//     restricts cleartext to vehicle name only; lat/long, addresses,
//     place names, and charging-location identifiers stay tagged so
//     a leaked transcript does not reveal where the user lives,
//     works, or charges.
package batteryhealthforecastnarrative

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy/redactadapter"
)

// FeatureID is the canonical registry key for this strategy.
// Exported so wiring code (router.go, tests) can reference the same
// constant the strategy registers itself with — typo-proof via
// compile error.
const FeatureID = "battery-health-forecast-narrative"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every battery-health-forecast-narrative generation.
// Kept in a single named place so eval goldens
// (internal/ai/strategies/battery-health-forecast-narrative/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     query_battery_health_forecast before narrating so the
//     narration is grounded in the canonical forecast numbers.
//   - Forbids changing the forecast: this is an EXPLAINER, not a
//     forecaster. The LLM may quote current_health_pct,
//     degradation_rate_pct_per_year, years_to_80_pct,
//     projected_80_pct_date, stress_level, and the
//     charging_habits / risk_factors entries from the tool reply;
//     it MUST NOT invent alternate slopes, alternate projected
//     dates, or alternate stress-level classifications.
//   - Refuses cross-vehicle requests: the AI handler always scopes
//     to the caller-supplied vehicle_id from the body; any other
//     vehicle ID in the user message is by definition out of scope.
//   - Asks for short, focused output (2-3 sentences narrating the
//     forecast drivers) so the surface fits inside the existing
//     BatteryHealthPage layout without a scroll bomb.
//   - Bans quoting precise street addresses or location coordinates
//     in the narration: the redaction policy already strips them,
//     but the prompt-level ban is defence-in-depth.
const SystemPrompt = `You are the TeslaSync battery-health forecast narrator. ` +
	`Your job is to EXPLAIN the drivers of the deterministic battery-health forecast for ONE vehicle in scope; you NEVER change the forecast or invent numbers. ` +
	`ALWAYS call query_battery_health_forecast FIRST with the caller-supplied vehicle_id and narrate the result. ` +
	`Do NOT recompute, override, or contradict the forecast: the narration may quote current_health_pct, degradation_rate_pct_per_year, years_to_80_pct, projected_80_pct_date, stress_level, fast_charge_ratio_pct, deep_discharge_count, high_soc_count, and the risk_factors entries returned by the tool, but never invent alternate slopes, never fabricate a projected date the tool did not return, and never reclassify the stress level. ` +
	`Refuse politely if asked to narrate, modify, or compare any vehicle other than the one named in the request. ` +
	`Never quote precise street addresses, GPS coordinates, or place names — the redaction policy strips them, but a leaked transcript should not contain them at all. ` +
	`Be concise: 2-3 sentences explaining which charging habits and risk factors drive the forecast (e.g. "Roadie's fast-charge ratio is X%, deep-discharge count is Y, and the regression slope of Z%/year projects 80% capacity by 2030"), grounded strictly in the tool reply.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. The name MUST be registered in the
// process-wide tools.Registry — `query_battery_health_forecast` is
// registered by RegisterBatteryHealthForecastNarrativeTools at
// boot. The dispatcher refuses to mount a strategy that references
// an unknown tool.
//
// The tool is READ / pure-functional: it does NOT touch the
// database write path (the existing /analytics/battery-* handlers
// it composes are reads), and the dispatcher's deny-all confirm
// gate is therefore never reached in practice — defence in depth
// in case a future edit accidentally adds a write tool.
var allowedTools = []string{
	"query_battery_health_forecast",
}

// Strategy is the concrete strategy.Strategy implementation for the
// battery-health-forecast-narrative surface. Construct via [New];
// the zero value is intentionally non-functional so a forgotten
// constructor surfaces as a runtime nil dereference rather than
// silently using empty defaults.
type Strategy struct{}

// New constructs the strategy. There are no per-instance knobs —
// the strategy is a pure value with no internal state — so this is
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
// allowlist.
func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

// Context implements [strategy.Strategy]. The dispatcher seeds the
// conversation from StrategyInput.LastMessage / History, and the AI
// handler builds the synthesised "narrate vehicle N's forecast"
// prompt before the call, so the strategy itself contributes no
// extra prefix messages. Returning nil is correct.
//
// Future work: this is where a per-vehicle forecast horizon preference can be injected.
// Today Context stays empty so dispatcher behavior is determined by [System] and History.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyBatteryHealthForecastNarrative wrapped through the redaction adapter so the dispatcher's per-request ctx-installation step
// (dispatch.Run installs the policy via redact.WithPolicy) sees the
// concrete policy.
//
// PolicyBatteryHealthForecastNarrative is the per-feature
// constructor with the same allow-list as PolicyDigest /
// PolicyTripPlannerLLMAgent — kept as a distinct identifier so a
// future per-feature change to battery-health-forecast-narrative's
// allow-list does not bleed across the other read-only narrators.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyBatteryHealthForecastNarrative())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness loads
// goldens from
// `internal/ai/strategies/battery-health-forecast-narrative/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil here
// keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
