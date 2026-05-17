// Phase-50 / 0065 W1 — SPA AI feature wiring contract.
//
// Every guarded AI surface listed in the registry above with a
// non-empty UITestIDs and a public-facing ID (not the internal-only
// __usage__ / __redaction_bypass__ / ai-provider-health entries) MUST
// be represented in SPAWiringTable below. The table is the single
// source of truth that pairs a feature ID with:
//
//   1. The SPA component file (under web/src/) whose top-level
//      JSX renders the feature's AI surface and consumes
//      useAiStream against the registered backend route.
//   2. The canonical backend endpoint string (taken verbatim from
//      Registry[id].Routes.Backend[0]) so the W1-B aivet rule can
//      assert the component references the right URL.
//   3. The render contract (Narrative / Proposal / Suggestion) that
//      classifies how the streamed SSE events are surfaced inside
//      the AI panel. The current shipping pattern across every wired
//      feature is RenderNarrative (delta-accumulator → AiOutputPanel).
//
// Why is this contract NOT part of the runtime Registry?
//
//   - Registry is consumed at runtime by the Settings UI generator,
//     the off-mode walker, and the per-handler guard.Wrap dispatch.
//     None of those need SPA component paths or render contracts.
//   - SPA wiring is enforced at BUILD time only — by aivet (W1-A /
//     W1-B) and by SPAWiringSelfCheck in spa_wiring_test.go — and is
//     mirrored to TS by aigen --spa-wiring for component imports.
//
// Why a static table instead of "auto-discovery from the registry"?
//
//   - The mapping from feature ID to SPA file path is repository
//     convention, not a derivable function (e.g. chatbot-llm's wiring
//     lives in ChatbotPage.tsx, not in AIChatbotIndicator.tsx). The
//     table makes the convention explicit and unguessable.
//   - SPAWiringSelfCheck verifies that EVERY public registry entry
//     appears here exactly once, so drift between the registry and
//     the wiring table is a CI failure.
package features

import "fmt"

// RenderContract classifies how an AI feature's SSE stream is
// rendered on the SPA side. Every wireable feature streams (the
// registry's NeedsStream is true for all of them); features differ
// in what the stream emits and which surface consumes it.
type RenderContract string

const (
	// RenderNarrative — the stream emits delta text events that the
	// component accumulates into a single prose block via the
	// useAiStream hook's `text` accumulator. The component renders
	// the accumulator inside AiOutputPanel.
	//
	// This is the dominant shipping pattern in TeslaSync (54 of 54
	// wireable features as of W1). New features SHOULD default to
	// this contract unless they have a clear proposal/suggestion
	// hand-off requirement that is also implemented end-to-end on
	// the SPA side.
	RenderNarrative RenderContract = "narrative"

	// RenderProposal — the stream emits one or more `tool_result`
	// events carrying a typed draft (AlertRule, Automation, TripPlan,
	// ChargeSchedule, search-result-list, etc.). The component is
	// expected to render the proposal INSIDE the AI panel with an
	// "Apply to form" / "Use this draft" action that copies the draft
	// into an existing baseline form's state via a documented hand-off
	// prop. The AI panel NEVER calls a write path; the user clicks
	// the baseline form's existing Save button to persist (ADR-015
	// §I3 + §I8).
	//
	// Reserved for future slices that implement the hand-off mechanic
	// end-to-end. No 0065/W1 entry uses this contract — the current
	// implementations all surface the proposal as narrative prose
	// inside AiOutputPanel (RenderNarrative).
	RenderProposal RenderContract = "proposal"

	// RenderSuggestion — the stream emits a single suggestion event
	// (one tool_result or a final delta) that prefills a single input
	// alongside an existing manual rename/edit affordance. User clicks
	// the existing Save/Apply button to persist.
	//
	// Reserved for future slices. As with RenderProposal, no W1 entry
	// uses this contract today.
	RenderSuggestion RenderContract = "suggestion"
)

// SPAWiring is one row of the per-feature SPA wiring contract.
type SPAWiring struct {
	// FeatureID is the kebab-case registry ID, e.g. "chatbot-llm".
	FeatureID string

	// Component is the path under web/src/ (no leading slash) of the
	// SPA file whose top-level component renders the feature's AI
	// surface. For most features this is
	// "components/ai/AI<Feature>.tsx"; for the chatbot-llm feature
	// the actual wiring lives in
	// "features/system/pages/ChatbotPage.tsx" (the indicator
	// component AIChatbotIndicator.tsx is allowlisted via
	// SPAWiringIndicatorOnly below).
	Component string

	// Endpoint is the canonical backend route string, taken verbatim
	// from Registry[FeatureID].Routes.Backend[0], e.g.
	// "POST /api/v1/ai/chatbot". SPAWiringSelfCheck asserts an exact
	// match against the live registry.
	Endpoint string

	// Render is the SSE render contract classification — see
	// RenderContract above.
	Render RenderContract

	// BaselineFormHandoff is the SPA route path of the baseline form
	// that consumes a proposal / suggestion draft. Required (non-
	// empty) for RenderProposal and RenderSuggestion entries; empty
	// for RenderNarrative entries. When non-empty it MUST match one
	// of Registry[FeatureID].Routes.Frontend.
	BaselineFormHandoff string
}

// SPAWiringIndicatorOnly lists AI component files that are EXEMPT
// from the W1-B "must import useAiStream + reference endpoint" rule
// because their corresponding SPAWiringTable entry already points at
// a page-level wiring file that owns the call path. Files listed
// here REMAIN subject to W1-A (no placeholder strings / no permanent
// disabled buttons).
//
// Today this allowlist contains exactly one entry: the chatbot
// indicator badge that sits in the page header next to the actual
// wired ChatbotPage. The badge is intentionally a tiny visible AI
// marker — it does not (and should not) open its own SSE stream.
var SPAWiringIndicatorOnly = []string{
	"components/ai/AIChatbotIndicator.tsx",
}

// SPAWiringTable is the authoritative per-feature SPA wiring snapshot.
//
// Entries are listed in lexicographic feature-ID order. Adding a new
// feature requires extending this table; SPAWiringSelfCheck catches
// any drift between the live Registry and this table.
//
// Every entry's Endpoint value is the EXACT string stored in
// Registry[id].Routes.Backend[0]. Keep them byte-identical so the
// aigen --spa-wiring generator and the W1-B endpoint-reference check
// can split the canonical path off the method prefix consistently.
//
// All current entries use RenderNarrative because that is the only
// render contract implemented end-to-end on the SPA side today.
// Future slices that introduce RenderProposal / RenderSuggestion
// hand-offs MUST populate BaselineFormHandoff with a Frontend route
// from the registry, and SPAWiringSelfCheck will enforce both
// constraints automatically.
var SPAWiringTable = []SPAWiring{
	{
		FeatureID: "alert-tuning-suggestions",
		Component: "components/ai/AIAlertTuningSuggestions.tsx",
		Endpoint:  "POST /api/v1/ai/alerts/rules/{ruleID}/tune/draft",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "anomaly-explanations",
		Component: "components/ai/AIAnomalyExplanations.tsx",
		Endpoint:  "POST /api/v1/ai/anomalies/explain",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "auto-name-unnamed-locations",
		Component: "components/ai/AIAutoNameUnnamedLocations.tsx",
		Endpoint:  "POST /api/v1/ai/locations/{locationID}/name/draft",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "auto-trip-naming",
		Component: "components/ai/AIAutoTripNameSuggestion.tsx",
		Endpoint:  "POST /api/v1/ai/trips/{tripID}/name/draft",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "battery-health-forecast-narrative",
		Component: "components/ai/AIBatteryHealthForecastNarrative.tsx",
		Endpoint:  "POST /api/v1/ai/battery/health/narrate",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "cabin-temperature-impact-narrative",
		Component: "components/ai/AICabinTemperatureImpactNarrative.tsx",
		Endpoint:  "POST /api/v1/ai/climate/temperature-impact/narrate",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "charging-curve-fingerprint-clustering",
		Component: "components/ai/AIChargingCurveFingerprintClustering.tsx",
		Endpoint:  "POST /api/v1/ai/charging/curves/clusters/explain",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "charging-diagnosis",
		Component: "components/ai/AIChargingDiagnosis.tsx",
		Endpoint:  "POST /api/v1/ai/charging/{sessionID}/diagnose",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "chatbot-llm",
		// Component path points at the page-level wiring file. The
		// per-feature indicator component (AIChatbotIndicator.tsx)
		// is allowlisted via SPAWiringIndicatorOnly above.
		Component: "features/system/pages/ChatbotPage.tsx",
		Endpoint:  "POST /api/v1/ai/chatbot",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "cost-forecast-narration",
		Component: "components/ai/AICostForecastNarration.tsx",
		Endpoint:  "POST /api/v1/ai/charging/costs/forecast/narrate",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "cross-rule-conflict-detection",
		Component: "components/ai/AICrossRuleConflictDetection.tsx",
		Endpoint:  "POST /api/v1/ai/alerts/rules/conflicts",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "data-repair-suggestions",
		Component: "components/ai/AIDataRepairSuggestions.tsx",
		Endpoint:  "POST /api/v1/ai/system/data-repair/draft",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "digest-narration",
		Component: "components/ai/AIDigestNarration.tsx",
		Endpoint:  "POST /api/v1/ai/digests/weekly/narrate",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "drive-coaching",
		Component: "components/ai/AIDriveCoaching.tsx",
		Endpoint:  "POST /api/v1/ai/drives/{driveID}/coach",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "feedback-queue-triage",
		Component: "components/ai/AIFeedbackQueueTriage.tsx",
		Endpoint:  "POST /api/v1/ai/feedback/triage/draft",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "geofence-aware-automation-suggestions",
		Component: "components/ai/AIGeofenceAwareAutomationSuggestions.tsx",
		Endpoint:  "POST /api/v1/ai/geofences/automations/draft",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "inbox-auto-categorization",
		Component: "components/ai/AIInboxAutoCategorization.tsx",
		Endpoint:  "POST /api/v1/ai/alerts/inbox/categorize",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "incident-timeline-summarizer",
		Component: "components/ai/AIIncidentTimelineSummarizer.tsx",
		Endpoint:  "POST /api/v1/ai/system/incidents/{incidentID}/summarize",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "learned-per-vehicle-anomaly-baselines",
		Component: "components/ai/AILearnedAnomalyBaselines.tsx",
		Endpoint:  "POST /api/v1/ai/ml/anomaly-baselines/train",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "lifetime-stats-qa",
		Component: "components/ai/AILifetimeStatsQA.tsx",
		Endpoint:  "POST /api/v1/ai/analytics/lifetime/qa",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "log-trace-summarization",
		Component: "components/ai/AILogTraceSummarization.tsx",
		Endpoint:  "POST /api/v1/ai/system/logs/summarize",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "ml-charging-curve-clustering",
		Component: "components/ai/AIMLChargingCurveClustering.tsx",
		Endpoint:  "POST /api/v1/ai/ml/charging-curves/cluster",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "mqtt-sse-inspector-explanations",
		Component: "components/ai/AIMqttSseInspectorExplanations.tsx",
		Endpoint:  "POST /api/v1/ai/system/streams/explain",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "nl-alert-builder",
		Component: "components/ai/AINLAlertBuilder.tsx",
		Endpoint:  "POST /api/v1/ai/alerts/rules/draft",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "nl-automation-builder",
		Component: "components/ai/AINLAutomationBuilder.tsx",
		Endpoint:  "POST /api/v1/ai/automations/draft",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "nl-dashboard-composer",
		Component: "components/ai/AINLDashboardComposer.tsx",
		Endpoint:  "POST /api/v1/ai/power/dashboard/draft",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "nl-drive-search-replay",
		Component: "components/ai/AINLDriveSearch.tsx",
		Endpoint:  "POST /api/v1/ai/drives/search",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "nl-grafana-panel",
		Component: "components/ai/AINLGrafanaPanel.tsx",
		Endpoint:  "POST /api/v1/ai/power/grafana-panel/draft",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "nl-search",
		Component: "components/ai/AINLSearch.tsx",
		Endpoint:  "POST /api/v1/ai/search/query",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "nl-sql-playground",
		Component: "components/ai/AINLSqlPlayground.tsx",
		Endpoint:  "POST /api/v1/ai/power/sql/draft",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "period-compare-narration",
		Component: "components/ai/AIPeriodCompareNarration.tsx",
		Endpoint:  "POST /api/v1/ai/analytics/period-compare/narrate",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "pii-redaction-shared-exports",
		Component: "components/ai/AIPiiRedactionSharedExports.tsx",
		Endpoint:  "POST /api/v1/ai/exports/redaction/draft",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "predictive-maintenance",
		Component: "components/ai/AIPredictiveMaintenance.tsx",
		Endpoint:  "POST /api/v1/ai/maintenance/predict",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "preheat-precool-recommender",
		Component: "components/ai/AIPreheatPrecoolRecommender.tsx",
		Endpoint:  "POST /api/v1/ai/climate/schedule/draft",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "quiet-hours-suggestion",
		Component: "components/ai/AIQuietHoursSuggestion.tsx",
		Endpoint:  "POST /api/v1/ai/settings/quiet-hours/draft",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "rag-help",
		Component: "components/ai/AIRAGHelp.tsx",
		Endpoint:  "POST /api/v1/ai/help/query",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "range-prediction-model",
		Component: "components/ai/AIRangePrediction.tsx",
		Endpoint:  "POST /api/v1/ai/ml/range/train",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "route-efficiency-suggestions",
		Component: "components/ai/AIRouteEfficiencySuggestions.tsx",
		Endpoint:  "POST /api/v1/ai/routes/{routeID}/efficiency/suggest",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "safety-setting-explainer",
		Component: "components/ai/AISafetySettingExplainer.tsx",
		Endpoint:  "POST /api/v1/ai/settings/safety/explain",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "signal-explorer-nl-filter",
		Component: "components/ai/AISignalExplorerNlFilter.tsx",
		Endpoint:  "POST /api/v1/ai/signals/filter/draft",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "smart-charge-schedule-suggestion",
		Component: "components/ai/AISmartChargeScheduleSuggestion.tsx",
		Endpoint:  "POST /api/v1/ai/charging/schedule/draft",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "software-update-changelog-summarizer",
		Component: "components/ai/AISoftwareUpdateChangelogSummarizer.tsx",
		Endpoint:  "POST /api/v1/ai/software-updates/summarize",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "speed-profile-insights",
		Component: "components/ai/AISpeedProfileInsights.tsx",
		Endpoint:  "POST /api/v1/ai/drives/{driveID}/speed-profile/insights",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "state-machine-debugger-narrator",
		Component: "components/ai/AIStateMachineDebuggerNarrator.tsx",
		Endpoint:  "POST /api/v1/ai/system/fsm/narrate",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "suggest-new-geofences",
		Component: "components/ai/AISuggestNewGeofences.tsx",
		Endpoint:  "POST /api/v1/ai/geofences/draft",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "tco-narration",
		Component: "components/ai/AITCONarration.tsx",
		Endpoint:  "POST /api/v1/ai/analytics/tco/narrate",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "tire-pressure-trend-reasoning",
		Component: "components/ai/AITirePressureTrendReasoning.tsx",
		Endpoint:  "POST /api/v1/ai/tire-pressure/trends/explain",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "trip-planner-llm-agent",
		Component: "components/ai/AITripPlannerLLMAgent.tsx",
		Endpoint:  "POST /api/v1/ai/trips/plan/draft",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "trip-postcard-share-card-image-generation",
		Component: "components/ai/AITripPostcardShareCardImageGeneration.tsx",
		Endpoint:  "POST /api/v1/ai/share-cards/trip-image/draft",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "vampire-drain-explanation",
		Component: "components/ai/AIVampireDrainExplanation.tsx",
		Endpoint:  "POST /api/v1/ai/charging/vampire-drain/explain",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "vehicle-paint-preview",
		Component: "components/ai/AIVehiclePaintPreview.tsx",
		Endpoint:  "POST /api/v1/ai/vehicles/{vehicleID}/paint-preview/draft",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "voice-mode",
		Component: "components/ai/AIVoiceMode.tsx",
		Endpoint:  "POST /api/v1/ai/voice/chat",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "watch-face-nl-response",
		Component: "components/ai/AIWatchFaceNLResponse.tsx",
		Endpoint:  "POST /api/v1/ai/watch/respond",
		Render:    RenderNarrative,
	},
	{
		FeatureID: "yir-narration",
		Component: "components/ai/AIYearReviewNarration.tsx",
		Endpoint:  "POST /api/v1/ai/analytics/year-in-review/narrate",
		Render:    RenderNarrative,
	},
}

// spaWiringPublicIDs returns the set of registry IDs that are
// expected to appear in SPAWiringTable. Internal-only entries
// (__usage__, __redaction_bypass__) and ops-only diagnostic entries
// (ai-provider-health) are excluded because they have no user-
// facing component surface to wire.
func spaWiringPublicIDs() map[string]struct{} {
	excluded := map[string]struct{}{
		"__usage__":            {},
		"__redaction_bypass__": {},
		"ai-provider-health":   {},
	}
	out := map[string]struct{}{}
	for _, id := range IDs() {
		if _, skip := excluded[id]; skip {
			continue
		}
		f, _ := Get(id)
		if len(f.Routes.UITestIDs) == 0 {
			// A registry entry without a UITestIDs has no visible
			// AI surface to wire, even if it is otherwise public.
			// This branch is defensive — every public entry today
			// declares a UITestIDs.
			continue
		}
		out[id] = struct{}{}
	}
	return out
}

// SPAWiringSelfCheck enforces four invariants between the live
// Registry and the static SPAWiringTable above:
//
//  1. Every public registry entry (UITestIDs non-empty AND ID not in
//     the exclusion list) appears in SPAWiringTable exactly once.
//  2. Every SPAWiringTable.FeatureID is present in Registry.
//  3. Every SPAWiringTable.Endpoint matches
//     Registry[FeatureID].Routes.Backend[0] verbatim.
//  4. Every RenderProposal / RenderSuggestion entry has a non-empty
//     BaselineFormHandoff that matches one of
//     Registry[FeatureID].Routes.Frontend.
//
// (4) is reserved-forward enforcement — no current entry uses
// RenderProposal or RenderSuggestion, so the check is a no-op today.
// The first slice that introduces a proposal hand-off will trip this
// guard until BaselineFormHandoff is populated.
//
// Component file existence is NOT verified here because the
// /internal package cannot reach across to web/src/ portably in
// tests run on every CI shard. SPAWiringComponentsExistCheck in the
// matching _test.go file performs that filesystem check.
func SPAWiringSelfCheck() error {
	want := spaWiringPublicIDs()

	seen := map[string]struct{}{}
	for _, w := range SPAWiringTable {
		if _, dup := seen[w.FeatureID]; dup {
			return wrapSPAErr(w.FeatureID, "duplicate entry in SPAWiringTable")
		}
		seen[w.FeatureID] = struct{}{}

		f, ok := Get(w.FeatureID)
		if !ok {
			return wrapSPAErr(w.FeatureID, "FeatureID is not present in Registry")
		}
		if len(f.Routes.Backend) == 0 {
			return wrapSPAErr(w.FeatureID, "Registry entry has empty Backend; cannot wire SPA")
		}
		if f.Routes.Backend[0] != w.Endpoint {
			return wrapSPAErr(w.FeatureID,
				"Endpoint mismatch: SPAWiringTable=%q Registry.Backend[0]=%q",
				w.Endpoint, f.Routes.Backend[0])
		}

		switch w.Render {
		case RenderNarrative:
			if w.BaselineFormHandoff != "" {
				return wrapSPAErr(w.FeatureID,
					"RenderNarrative entries MUST have an empty BaselineFormHandoff; got %q",
					w.BaselineFormHandoff)
			}
		case RenderProposal, RenderSuggestion:
			if w.BaselineFormHandoff == "" {
				return wrapSPAErr(w.FeatureID,
					"%s entries MUST have a non-empty BaselineFormHandoff", w.Render)
			}
			matched := false
			for _, fe := range f.Routes.Frontend {
				if fe == w.BaselineFormHandoff {
					matched = true
					break
				}
			}
			if !matched {
				return wrapSPAErr(w.FeatureID,
					"BaselineFormHandoff %q does not match any Registry.Frontend entry %v",
					w.BaselineFormHandoff, f.Routes.Frontend)
			}
		default:
			return wrapSPAErr(w.FeatureID, "unknown RenderContract %q", w.Render)
		}
	}

	// Every public registry ID must be represented.
	for id := range want {
		if _, ok := seen[id]; !ok {
			return wrapSPAErr(id, "public registry entry is missing from SPAWiringTable")
		}
	}
	// And the table must not include non-public entries (e.g. a
	// drift PR that registers __something__ here).
	for _, w := range SPAWiringTable {
		if _, ok := want[w.FeatureID]; !ok {
			return wrapSPAErr(w.FeatureID,
				"SPAWiringTable contains entry that is not a public registry ID "+
					"(internal __*__ entries and ai-provider-health are excluded)")
		}
	}

	return nil
}

// SPAWiringEndpointPath returns the path-after-/api/v1 portion of
// the canonical endpoint string, suitable for passing to useAiStream
// (which prepends ${apiBase}/api/v1). For "POST /api/v1/ai/foo" this
// returns "/ai/foo".
//
// The aigen --spa-wiring generator emits this value into the TS
// mirror so SPA components can import the URL by feature ID and stay
// in lock-step with Go.
func SPAWiringEndpointPath(endpoint string) string {
	// Split off the HTTP method.
	idx := indexByte(endpoint, ' ')
	if idx < 0 {
		return endpoint
	}
	path := endpoint[idx+1:]
	const prefix = "/api/v1"
	if hasPrefix(path, prefix) {
		path = path[len(prefix):]
	}
	if path == "" {
		path = "/"
	}
	return path
}

// SPAWiringEndpointMethod returns the HTTP method portion of the
// canonical endpoint, e.g. "POST".
func SPAWiringEndpointMethod(endpoint string) string {
	idx := indexByte(endpoint, ' ')
	if idx < 0 {
		return ""
	}
	return endpoint[:idx]
}

// SPAWiringEndpointStaticPrefix returns the static prefix of the
// endpoint's path-after-prefix, stopping at the first '{' template
// placeholder. For "/ai/drives/{driveID}/coach" it returns
// "/ai/drives/". For "/ai/alerts/rules/draft" (no placeholder) it
// returns the whole path. The W1-B aivet check uses this so a
// component that builds a template-literal URL still passes when the
// static prefix appears in the file.
func SPAWiringEndpointStaticPrefix(endpoint string) string {
	path := SPAWiringEndpointPath(endpoint)
	if idx := indexByte(path, '{'); idx >= 0 {
		return path[:idx]
	}
	return path
}

// IsIndicatorOnly reports whether the given web/src/-relative path
// is allowlisted to skip the W1-B "must import useAiStream" check.
func IsIndicatorOnly(componentPath string) bool {
	for _, p := range SPAWiringIndicatorOnly {
		if p == componentPath {
			return true
		}
	}
	return false
}

// wrapSPAErr formats a SPAWiringSelfCheck error with the feature ID
// prefix for easy CI debugging.
func wrapSPAErr(id, format string, args ...interface{}) error {
	return fmt.Errorf("SPAWiringTable[%s]: "+format, append([]interface{}{id}, args...)...)
}

// indexByte is a tiny strings.IndexByte shim kept inline so this
// file does not need to import "strings" (the package already
// imports fmt; keeping the import surface narrow makes the file
// trivial to vendor or trace).
func indexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}

// hasPrefix mirrors strings.HasPrefix without pulling the import.
func hasPrefix(s, p string) bool {
	if len(s) < len(p) {
		return false
	}
	return s[:len(p)] == p
}
