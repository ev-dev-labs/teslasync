package api

// Phase-50 / 0001 — F0 AI-Off Contract.
// Phase-50 / 0011 — U1 wires the real chatbot LLM handler in place
// of the F0 stub.
//
// This file mounts the canonical /api/v1/ai/* routes.
//
// Why this exists:
// The AI-off contract (ADR-015 §I6) is "off mode handlers return 404".
// Asserting that contract requires at least one route to *be* mounted —
// otherwise the 404 the curl probe sees is the chi router's
// default-no-match 404, which proves nothing about the guard. Mounting
// the chatbot-llm route (with the real handler now that U1 has shipped)
// gives the off-mode test, the integration log curl, and the 9999
// final-gate Playwright walk a concrete handler whose 404 is *guaranteed
// by the guard* and not by the absence of a registration.
//
// The real handler (Phase-50 / U1) only runs when a user has explicitly:
//   1. Set ai_mode to "local" or "cloud" in Settings, AND
//   2. Toggled the chatbot-llm feature flag on.
// Otherwise the guard returns 404 BEFORE the handler is reached.

import (
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
)

// mountAIRoutes registers every /api/v1/ai/* route through the guard.
// Called from inside the /api/v1 subroute in NewRouter so the standard
// auth, logging, rate-limit, and tracing middleware all apply before
// the per-request feature gate fires.
//
// Adding a new AI route MUST go through this function so tools/aivet
// can statically prove every AI route is wrapped by guard.Wrap.
//
// All AI feature handlers are bundled into the AIHandlers field-bag (see
// the struct definition immediately below) — each field is independently
// nil-safe and falls back to a 501 stub so the off-mode 404 invariant
// (ADR-015 §I6) is held by the guard regardless of partial wiring.
//
// AIHandlers bundles every AI feature handler wired into mountAIRoutes.
//
// Each field is independently nil-safe — the matching 501 stub handler
// runs when the field is nil so the off-mode 404 invariant
// (ADR-015 §I6) is held by the guard regardless of partial wiring.
//
// Adding a new AI handler? Add a field here (typed as http.Handler so
// later carves can move the concrete type to a subpackage without
// touching this file), plus one route block inside mountAIRoutes, plus
// one stub function at the bottom of this file. Then assign the
// constructed handler to the matching field at the single call site in
// router.go. This struct exists so parallel subpackage carves (R2d.*)
// can move concrete handler types into subpkgs WITHOUT re-touching the
// mountAIRoutes signature on every carve — only the router.go field
// assignment changes, which already conflicts on every carve.
type AIHandlers struct {
	Chatbot                              http.Handler
	Digest                               http.Handler
	YIR                                  http.Handler
	Anomaly                              http.Handler
	Alert                                http.Handler
	Automation                           http.Handler
	Search                               http.Handler
	DriveCoach                           http.Handler
	ChargingDiagnosis                    http.Handler
	RagHelp                              http.Handler
	DriveSearch                          http.Handler
	SpeedProfileInsights                 http.Handler
	RouteEfficiencySuggestions           http.Handler
	AutoTripName                         http.Handler
	TripPlannerLLM                       http.Handler
	SmartChargeSchedule                  http.Handler
	BatteryHealth                        http.Handler
	ChargingCurveClustering              http.Handler
	CostForecastNarration                http.Handler
	VampireDrainExplanation              http.Handler
	PreheatPrecoolRecommender            http.Handler
	CabinTemperatureImpactNarrative      http.Handler
	TirePressureTrendReasoning           http.Handler
	AlertTuning                          http.Handler
	InboxCategorize                      http.Handler
	CrossRuleConflict                    http.Handler
	AutoNameUnnamedLocations             http.Handler
	SuggestNewGeofences                  http.Handler
	GeofenceAwareAutomation              http.Handler
	LearnedAnomalyBaselines              http.Handler
	RangePrediction                      http.Handler
	MLChargingCurveClustering            http.Handler
	PeriodCompareNarration               http.Handler
	LifetimeStatsQA                      http.Handler
	IncidentTimelineSummarizer           http.Handler
	DataRepairSuggestions                http.Handler
	SignalExplorerNlFilter               http.Handler
	LogTraceSummarization                http.Handler
	FeedbackQueueTriage                  http.Handler
	MqttSseInspectorExplanations         http.Handler
	StateMachineDebuggerNarrator         http.Handler
	PredictiveMaintenance                http.Handler
	TCONarration                         http.Handler
	SoftwareUpdateChangelogSummarizer    http.Handler
	PiiRedactionSharedExports            http.Handler
	QuietHoursSuggestion                 http.Handler
	SafetySettingExplainer               http.Handler
	VoiceMode                            http.Handler
	WatchFaceNLResponse                  http.Handler
	NLSqlPlayground                      http.Handler
	NLGrafanaPanel                       http.Handler
	NLDashboardComposer                  http.Handler
	TripPostcardShareCardImageGeneration http.Handler
	VehiclePaintPreview                  http.Handler
}

func mountAIRoutes(
	r chi.Router,
	g *guard.Guard,
	registry *provider.Registry,
	settingsRepo *settingsdb.SettingsRepo,
	sudoMW func(http.Handler) http.Handler,
	h AIHandlers,
) {
	r.Route("/ai", func(r chi.Router) {
		// Phase-50 / units honour — install the global Application
		// settings as dispatcher UserPrefs on every /ai/* request.
		// Resolved once per request (cheap key/value Get on the
		// settings table). The dispatcher's Run reads the prefs
		// from ctx and injects a short "narrate in MILES/MPH/°F…"
		// system message right after the strategy's prompt so the
		// LLM's prose matches the user's UI without any per-handler
		// or per-strategy plumbing. See dispatch/prefs.go for the
		// full design notes.
		r.Use(userPrefsMiddleware(settingsRepo))
		// chatbot-llm (Phase-50 / U1, slice 0011 wires the real
		// handler). Earlier slices used a 501 stub; the stub is
		// retained for nil-handler defensive wiring so a misordered
		// boot still yields a non-nil http.Handler whose 404 in
		// off mode is provable by the guard.
		var chatbotHandler http.HandlerFunc = aiChatbotStubHandler
		if h.Chatbot != nil {
			chatbotHandler = h.Chatbot.ServeHTTP
		}
		r.Post("/chatbot", g.Wrap("chatbot-llm", chatbotHandler))

		// digest-narration (Phase-50 / U2, slice 0012). Same
		// stub-fallback pattern as chatbot — a nil handler is
		// possible during partial wiring but the off-mode 404
		// invariant still holds because guard.Wrap returns 404
		// BEFORE the handler runs in off mode.
		var digestHandler http.HandlerFunc = aiDigestStubHandler
		if h.Digest != nil {
			digestHandler = h.Digest.ServeHTTP
		}
		r.Post("/digests/weekly/narrate", g.Wrap("digest-narration", digestHandler))

		// yir-narration (Phase-50 / U3, slice 0013). Same
		// stub-fallback pattern as chatbot/digest — a nil handler
		// is possible during partial wiring but the off-mode 404
		// invariant still holds because guard.Wrap returns 404
		// BEFORE the handler runs in off mode.
		var yirHandler http.HandlerFunc = aiYIRStubHandler
		if h.YIR != nil {
			yirHandler = h.YIR.ServeHTTP
		}
		r.Post("/analytics/year-in-review/narrate", g.Wrap("yir-narration", yirHandler))

		// anomaly-explanations (Phase-50 / U4, slice 0014). Same
		// stub-fallback pattern as chatbot/digest/yir — a nil
		// handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode.
		var anomalyHandler http.HandlerFunc = aiAnomalyStubHandler
		if h.Anomaly != nil {
			anomalyHandler = h.Anomaly.ServeHTTP
		}
		r.Post("/anomalies/explain", g.Wrap("anomaly-explanations", anomalyHandler))

		// nl-alert-builder (Phase-50 / N1, slice 0015). Same
		// stub-fallback pattern as the other AI handlers — a nil
		// handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode. Note
		// the route lives under /ai/alerts/... (parallel to the
		// canonical /alerts/rules typed handler) so the AI
		// surface is namespaced and can be removed in one route
		// block if the feature is ever decommissioned.
		var alertHandler http.HandlerFunc = aiAlertStubHandler
		if h.Alert != nil {
			alertHandler = h.Alert.ServeHTTP
		}
		r.Post("/alerts/rules/draft", g.Wrap("nl-alert-builder", alertHandler))

		// nl-automation-builder (Phase-50 / N2, slice 0016). Same
		// stub-fallback pattern as the other AI handlers — a nil
		// handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode. The
		// route lives under /ai/automations/... (parallel to the
		// canonical /automations typed handler) so the AI surface
		// is namespaced and can be removed in one route block if
		// the feature is ever decommissioned.
		var automationHandler http.HandlerFunc = aiAutomationStubHandler
		if h.Automation != nil {
			automationHandler = h.Automation.ServeHTTP
		}
		r.Post("/automations/draft", g.Wrap("nl-automation-builder", automationHandler))

		// nl-search (Phase-50 / N3, slice 0017). Same
		// stub-fallback pattern as the other AI handlers — a nil
		// handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode. The
		// route lives under /ai/search/... (parallel to the
		// canonical /search typed handler at SearchHandler.Search)
		// so the AI surface is namespaced and can be removed in
		// one route block if the feature is ever decommissioned.
		var searchHandler http.HandlerFunc = aiSearchStubHandler
		if h.Search != nil {
			searchHandler = h.Search.ServeHTTP
		}
		r.Post("/search/query", g.Wrap("nl-search", searchHandler))

		// drive-coaching (Phase-50 / N4, slice 0018). Same
		// stub-fallback pattern as the other AI handlers — a nil
		// handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode. The
		// route lives under /ai/drives/... (parallel to the
		// canonical /drives typed handlers at DriveDetailHandler)
		// so the AI surface is namespaced and can be removed in
		// one route block if the feature is ever decommissioned.
		// driveID is a chi URL param; the handler parses + validates
		// it (positive int64) and rejects 0 / negative / non-numeric
		// values with a 400 BEFORE opening the SSE stream.
		var driveCoachHandler http.HandlerFunc = aiDriveCoachStubHandler
		if h.DriveCoach != nil {
			driveCoachHandler = h.DriveCoach.ServeHTTP
		}
		r.Post("/drives/{driveID}/coach", g.Wrap("drive-coaching", driveCoachHandler))

		// charging-diagnosis (Phase-50 / N5, slice 0019). Same
		// stub-fallback pattern as the other AI handlers — a nil
		// handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode. The
		// route lives under /ai/charging/... (parallel to the
		// canonical /charging typed handlers at ChargingHandler)
		// so the AI surface is namespaced and can be removed in
		// one route block if the feature is ever decommissioned.
		// sessionID is a chi URL param; the handler parses + validates
		// it (positive int64) and rejects 0 / negative / non-numeric
		// values with a 400 BEFORE opening the SSE stream.
		//
		// smart-charge-schedule-suggestion (Phase-50 / C1, slice
		// 0026) is registered FIRST under /ai/charging/... so
		// chi's radix-tree disambiguates the static
		// /charging/schedule/draft pattern over the
		// /charging/{sessionID}/diagnose wildcard registered
		// immediately below. Same stub-fallback pattern — a nil
		// handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode. The
		// canonical baseline route at
		// POST /api/v1/charge-planner/optimize is unchanged.
		var smartChargeScheduleHandler http.HandlerFunc = aiSmartChargeScheduleStubHandler
		if h.SmartChargeSchedule != nil {
			smartChargeScheduleHandler = h.SmartChargeSchedule.ServeHTTP
		}
		r.Post("/charging/schedule/draft", g.Wrap("smart-charge-schedule-suggestion", smartChargeScheduleHandler))

		// battery-health-forecast-narrative (Phase-50 / C2, slice
		// 0027) narrates the deterministic battery-health forecast
		// the chart on /battery (BatteryHealthPage) renders. The
		// route lives under /ai/battery/health/narrate so it is
		// namespaced under the existing /battery SPA route family
		// the BatteryHealthPage component mounts on. Same
		// stub-fallback pattern — a nil handler is possible during
		// partial wiring but the off-mode 404 invariant still holds
		// because guard.Wrap returns 404 BEFORE the handler runs in
		// off mode. The canonical baseline routes at
		// GET /api/v1/analytics/battery-health and
		// GET /api/v1/analytics/battery-degradation are unchanged.
		var batteryHealthHandler http.HandlerFunc = aiBatteryHealthStubHandler
		if h.BatteryHealth != nil {
			batteryHealthHandler = h.BatteryHealth.ServeHTTP
		}
		r.Post("/battery/health/narrate", g.Wrap("battery-health-forecast-narrative", batteryHealthHandler))

		// charging-curve-fingerprint-clustering (Phase-50 / C3,
		// slice 0028) names and explains the deterministic
		// charging-curve fingerprint clusters the SPA's
		// helpers.ts already classifies. The route lives under
		// /ai/charging/curves/clusters/explain so it is namespaced
		// under the existing /charging family the
		// ChargingCurvePage component renders. Same stub-fallback
		// pattern — a nil handler is possible during partial
		// wiring but the off-mode 404 invariant still holds
		// because guard.Wrap returns 404 BEFORE the handler runs
		// in off mode. The canonical baseline route at
		// GET /api/v1/charging is unchanged.
		var chargingCurveClusteringHandler http.HandlerFunc = aiChargingCurveClusteringStubHandler
		if h.ChargingCurveClustering != nil {
			chargingCurveClusteringHandler = h.ChargingCurveClustering.ServeHTTP
		}
		r.Post("/charging/curves/clusters/explain", g.Wrap("charging-curve-fingerprint-clustering", chargingCurveClusteringHandler))

		// cost-forecast-narration (Phase-50 / C4, slice 0029)
		// narrates the deterministic cost forecast that the SPA's
		// CostAnalysisPage already renders from
		// GET /api/v1/analytics/cost-forecast. The route lives
		// under /ai/charging/costs/forecast/narrate so it is
		// namespaced under the existing /charging family. Same
		// stub-fallback pattern as the other AI handlers — a nil
		// handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode. The
		// canonical baseline route at
		// GET /api/v1/analytics/cost-forecast is unchanged.
		var costForecastNarrationHandler http.HandlerFunc = aiCostForecastNarrationStubHandler
		if h.CostForecastNarration != nil {
			costForecastNarrationHandler = h.CostForecastNarration.ServeHTTP
		}
		r.Post("/charging/costs/forecast/narrate", g.Wrap("cost-forecast-narration", costForecastNarrationHandler))

		// period-compare-narration (Phase-50 / X1, slice 0040)
		// narrates the deterministic period-over-period comparison
		// the SPA's PeriodComparePage already renders from
		// GET /api/v1/analytics/period-stats. The route lives
		// under /ai/analytics/period-compare/narrate so it is
		// namespaced under the /analytics family alongside
		// /analytics/year-in-review/narrate. Same stub-fallback
		// pattern as the other AI handlers — a nil handler is
		// possible during partial wiring but the off-mode 404
		// invariant still holds because guard.Wrap returns 404
		// BEFORE the handler runs in off mode. The canonical
		// baseline route at GET /api/v1/analytics/period-stats
		// is unchanged.
		var periodCompareNarrationHandler http.HandlerFunc = aiPeriodCompareNarrationStubHandler
		if h.PeriodCompareNarration != nil {
			periodCompareNarrationHandler = h.PeriodCompareNarration.ServeHTTP
		}
		r.Post("/analytics/period-compare/narrate", g.Wrap("period-compare-narration", periodCompareNarrationHandler))

		// lifetime-stats-qa (Phase-50 / X2, slice 0041) answers
		// natural-language questions about the deterministic
		// lifetime stats the SPA's LifetimeStatsPage already
		// renders from GET /api/v1/analytics/lifetime. The route
		// lives under /ai/analytics/lifetime/qa so it is namespaced
		// under the /analytics family alongside the other analytics
		// AI surfaces. Same stub-fallback pattern as the other AI
		// handlers — a nil handler is possible during partial
		// wiring but the off-mode 404 invariant still holds because
		// guard.Wrap returns 404 BEFORE the handler runs in off
		// mode. The canonical baseline route at
		// GET /api/v1/analytics/lifetime is unchanged.
		var lifetimeStatsQAHandler http.HandlerFunc = aiLifetimeStatsQAStubHandler
		if h.LifetimeStatsQA != nil {
			lifetimeStatsQAHandler = h.LifetimeStatsQA.ServeHTTP
		}
		r.Post("/analytics/lifetime/qa", g.Wrap("lifetime-stats-qa", lifetimeStatsQAHandler))

		// incident-timeline-summarizer (Phase-50 / S1, slice 0042).
		// Opt-in LLM summarizer that condenses the deterministic
		// per-incident timeline the SPA's IncidentTimelinePage
		// already renders from GET /api/v1/status/incidents/{id}.
		// The route lives under /ai/system/incidents/{incidentID}/
		// summarize so it is namespaced under the existing /system
		// family and the URL incidentID matches the chi pattern of
		// the canonical baseline path. Same stub-fallback pattern
		// as the other AI handlers — a nil handler is possible
		// during partial wiring but the off-mode 404 invariant
		// still holds because guard.Wrap returns 404 BEFORE the
		// handler runs in off mode. The canonical baseline route at
		// GET /api/v1/status/incidents/{id} is unchanged.
		var incidentTimelineSummarizerHandler http.HandlerFunc = aiIncidentTimelineSummarizerStubHandler
		if h.IncidentTimelineSummarizer != nil {
			incidentTimelineSummarizerHandler = h.IncidentTimelineSummarizer.ServeHTTP
		}
		r.Post("/system/incidents/{incidentID}/summarize", g.Wrap("incident-timeline-summarizer", incidentTimelineSummarizerHandler))

		// data-repair-suggestions (Phase-50 / S2, slice 0043).
		// Opt-in LLM that proposes a typed RepairPlan for ONE
		// stale charging session OR ONE stale drive from the
		// in-scope inventory loaded server-side. PROPOSE-ONLY:
		// the user reviews the typed proposal in the AI side
		// panel and clicks the canonical Save / Close / Quarantine
		// button on the baseline /system/data-repair edit form;
		// the LLM never writes. Same stub-fallback pattern as the
		// other AI handlers — a nil handler is possible during
		// partial wiring but the off-mode 404 invariant still
		// holds because guard.Wrap returns 404 BEFORE the handler
		// runs in off mode. The canonical baseline routes at
		// GET /api/v1/data-repair/stale-sessions and
		// PUT/POST/DELETE /api/v1/data-repair/{kind}/{id}{...}
		// are unchanged.
		var dataRepairSuggestionsHandler http.HandlerFunc = aiDataRepairSuggestionsStubHandler
		if h.DataRepairSuggestions != nil {
			dataRepairSuggestionsHandler = h.DataRepairSuggestions.ServeHTTP
		}
		r.Post("/system/data-repair/draft", g.Wrap("data-repair-suggestions", dataRepairSuggestionsHandler))

		// signal-explorer-nl-filter (Phase-50 / S3, slice 0044).
		// Opt-in LLM that translates a natural-language filter
		// request into a typed SignalFilter DTO the
		// SignalExplorerPage at /signals/explorer can apply.
		// PROPOSE-ONLY: the user reviews the typed proposal in
		// the AI side panel and clicks the Apply button to copy
		// the draft into the baseline filter form; the LLM never
		// edits filter state directly. Same stub-fallback pattern
		// as the other AI handlers — a nil handler is possible
		// during partial wiring but the off-mode 404 invariant
		// still holds because guard.Wrap returns 404 BEFORE the
		// handler runs in off mode. The canonical baseline routes
		// at GET /api/v1/signals/{vehicleID}/available and
		// GET /api/v1/signals/{vehicleID}/{signalName}/history
		// are unchanged.
		var signalExplorerNlFilterHandler http.HandlerFunc = aiSignalExplorerNlFilterStubHandler
		if h.SignalExplorerNlFilter != nil {
			signalExplorerNlFilterHandler = h.SignalExplorerNlFilter.ServeHTTP
		}
		r.Post("/signals/filter/draft", g.Wrap("signal-explorer-nl-filter", signalExplorerNlFilterHandler))

		// log-trace-summarization (Phase-50 / S4, slice 0045).
		// Opt-in LLM that summarizes a recent redacted log/trace
		// window for the operator-facing live-logs surface into a
		// 3-6 sentence factual summary. PROPOSE-ONLY: the user
		// reviews the summary in the AI side panel and continues
		// to use the deterministic SSE log tail below for raw
		// inspection. Same stub-fallback pattern as the other AI
		// handlers — a nil handler is possible during partial
		// wiring but the off-mode 404 invariant still holds
		// because guard.Wrap returns 404 BEFORE the handler runs
		// in off mode. The canonical baseline route at
		// GET /api/v1/admin/logs/stream is unchanged.
		var logTraceSummarizationHandler http.HandlerFunc = aiLogTraceSummarizationStubHandler
		if h.LogTraceSummarization != nil {
			logTraceSummarizationHandler = h.LogTraceSummarization.ServeHTTP
		}
		r.Post("/system/logs/summarize", g.Wrap("log-trace-summarization", logTraceSummarizationHandler))

		// feedback-queue-triage (Phase-50 / S5, slice 0046).
		// Opt-in LLM that proposes a typed
		// {proposed_status, proposed_category, proposed_priority,
		// rationale} envelope for one user_feedback row by
		// routing through three propose/read-only tools
		// (draft_feedback_triage, validate_feedback_triage, and
		// the OPTIONAL retrieve_feedback_chunks). PROPOSE-ONLY:
		// the user reviews the proposal in the AI side panel and
		// continues to use the deterministic FeedbackQueuePage
		// manual-triage controls (PATCH /api/v1/admin/feedback/{id})
		// to apply any change. Same stub-fallback pattern as the
		// other AI handlers — a nil handler is possible during
		// partial wiring but the off-mode 404 invariant still
		// holds because guard.Wrap returns 404 BEFORE the handler
		// runs in off mode. The canonical baseline route at
		// PATCH /api/v1/admin/feedback/{id} is unchanged.
		var feedbackQueueTriageHandler http.HandlerFunc = aiFeedbackQueueTriageStubHandler
		if h.FeedbackQueueTriage != nil {
			feedbackQueueTriageHandler = h.FeedbackQueueTriage.ServeHTTP
		}
		r.Post("/feedback/triage/draft", g.Wrap("feedback-queue-triage", feedbackQueueTriageHandler))

		// mqtt-sse-inspector-explanations (Phase-50 / S6, slice
		// 0047). Opt-in LLM-backed explainer that turns the
		// deterministic MQTT-broker / SSE-hub / background-job
		// snapshot into a 3-6 sentence operator-readable factual
		// explanation by routing through two read-only tools
		// (query_stream_inspector and the OPTIONAL
		// retrieve_stream_chunks). EXPLAIN-ONLY: the user reviews
		// the explanation in the AI side panel and continues to
		// use the deterministic MQTTInspectorPage broker-status
		// snapshot table for raw inspection. Same stub-fallback
		// pattern as the other AI handlers — a nil handler is
		// possible during partial wiring but the off-mode 404
		// invariant still holds because guard.Wrap returns 404
		// BEFORE the handler runs in off mode. The canonical
		// baseline route at GET /api/v1/admin/mqtt/status is
		// unchanged.
		var mqttSseInspectorExplanationsHandler http.HandlerFunc = aiMqttSseInspectorExplanationsStubHandler
		if h.MqttSseInspectorExplanations != nil {
			mqttSseInspectorExplanationsHandler = h.MqttSseInspectorExplanations.ServeHTTP
		}
		r.Post("/system/streams/explain", g.Wrap("mqtt-sse-inspector-explanations", mqttSseInspectorExplanationsHandler))

		// state-machine-debugger-narrator (Phase-50 / S7, slice
		// 0048). Opt-in LLM-backed narrator that turns the
		// deterministic per-vehicle FSM transition trace into a
		// 3-6 sentence operator-readable factual narration by
		// routing through two read-only tools (query_fsm_trace
		// and the OPTIONAL retrieve_fsm_chunks). NARRATE-ONLY:
		// the user reviews the narration in the AI side panel
		// and continues to use the deterministic
		// StateMachineDebuggerPage transition table + state
		// diagram + FSM health panel + timeline chart for raw
		// inspection. Same stub-fallback pattern as the other AI
		// handlers — a nil handler is possible during partial
		// wiring but the off-mode 404 invariant still holds
		// because guard.Wrap returns 404 BEFORE the handler runs
		// in off mode. The canonical baseline route at GET
		// /api/v1/fsm/transitions is unchanged.
		var stateMachineDebuggerNarratorHandler http.HandlerFunc = aiStateMachineDebuggerNarratorStubHandler
		if h.StateMachineDebuggerNarrator != nil {
			stateMachineDebuggerNarratorHandler = h.StateMachineDebuggerNarrator.ServeHTTP
		}
		r.Post("/system/fsm/narrate", g.Wrap("state-machine-debugger-narrator", stateMachineDebuggerNarratorHandler))

		// predictive-maintenance (Phase-50 / M1, slice 0049).
		// Opt-in LLM-backed advisor that turns the deterministic
		// per-vehicle maintenance reminders + service history
		// into a 3-6 sentence operator-readable risk narration
		// by routing through two read-only tools
		// (query_maintenance_context and the OPTIONAL
		// retrieve_maintenance_chunks). NARRATE-ONLY: the user
		// reviews the advisory in the AI side panel and
		// continues to use the deterministic MaintenancePage
		// items grid + summary cards + service records table +
		// due-soon / overdue badges for the canonical
		// maintenance overview. Same stub-fallback pattern as
		// the other AI handlers — a nil handler is possible
		// during partial wiring but the off-mode 404 invariant
		// still holds because guard.Wrap returns 404 BEFORE the
		// handler runs in off mode. The canonical baseline
		// routes at GET /api/v1/maintenance and
		// /api/v1/maintenance/records are unchanged.
		var predictiveMaintenanceHandler http.HandlerFunc = aiPredictiveMaintenanceStubHandler
		if h.PredictiveMaintenance != nil {
			predictiveMaintenanceHandler = h.PredictiveMaintenance.ServeHTTP
		}
		r.Post("/maintenance/predict", g.Wrap("predictive-maintenance", predictiveMaintenanceHandler))

		// tco-narration (Phase-50 / M2, slice 0050) narrates
		// the deterministic operating-cost envelope the SPA's
		// TrueCostPage already renders from
		// GET /api/v1/analytics/tco. The route lives under
		// /ai/analytics/tco/narrate so it is namespaced under
		// the existing /analytics family alongside
		// /analytics/period-compare/narrate. Same
		// stub-fallback pattern as the other AI handlers — a
		// nil handler is possible during partial wiring but
		// the off-mode 404 invariant still holds because
		// guard.Wrap returns 404 BEFORE the handler runs in
		// off mode. The canonical baseline route at
		// GET /api/v1/analytics/tco is unchanged.
		var tcoNarrationHandler http.HandlerFunc = aiTCONarrationStubHandler
		if h.TCONarration != nil {
			tcoNarrationHandler = h.TCONarration.ServeHTTP
		}
		r.Post("/analytics/tco/narrate", g.Wrap("tco-narration", tcoNarrationHandler))

		// software-update-changelog-summarizer (Phase-50 / M3,
		// slice 0051) summarizes the deterministic firmware
		// update history the SPA's SoftwareUpdatesPage already
		// renders from GET /api/v1/vehicles/{id}/software-updates.
		// The route lives under /ai/software-updates/summarize
		// so it is namespaced alongside the existing
		// /vehicles/{id}/software-updates baseline reader. Same
		// stub-fallback pattern as the other AI handlers — a
		// nil handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode. The
		// canonical baseline route at
		// GET /api/v1/vehicles/{id}/software-updates is unchanged.
		var softwareUpdateChangelogSummarizerHandler http.HandlerFunc = aiSoftwareUpdateChangelogSummarizerStubHandler
		if h.SoftwareUpdateChangelogSummarizer != nil {
			softwareUpdateChangelogSummarizerHandler = h.SoftwareUpdateChangelogSummarizer.ServeHTTP
		}
		r.Post("/software-updates/summarize", g.Wrap("software-update-changelog-summarizer", softwareUpdateChangelogSummarizerHandler))

		// pii-redaction-shared-exports (Phase-50 / P1, slice 0052)
		// recommends which PII classes the user should redact
		// before sharing or downloading an export of the chosen
		// export_type. The route lives under
		// /ai/exports/redaction/draft so it is namespaced under
		// the existing /export family. Same stub-fallback pattern
		// as the other AI handlers — a nil handler is possible
		// during partial wiring but the off-mode 404 invariant
		// still holds because guard.Wrap returns 404 BEFORE the
		// handler runs in off mode. The canonical baseline routes
		// at GET/POST /api/v1/export/jobs (the deterministic
		// export pipeline) are unchanged.
		var piiRedactionSharedExportsHandler http.HandlerFunc = aiPiiRedactionSharedExportsStubHandler
		if h.PiiRedactionSharedExports != nil {
			piiRedactionSharedExportsHandler = h.PiiRedactionSharedExports.ServeHTTP
		}
		r.Post("/exports/redaction/draft", g.Wrap("pii-redaction-shared-exports", piiRedactionSharedExportsHandler))

		// quiet-hours-suggestion (Phase-50 / P2, slice 0053)
		// proposes ONE quiet-hours / Do-Not-Disturb window for
		// the in-scope user, derived strictly from their recent
		// notification history. The route lives under
		// /ai/settings/quiet-hours/draft so it is namespaced
		// under the existing /settings family. Same stub-
		// fallback pattern as the other AI handlers — a nil
		// handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode. The
		// canonical baseline routes at /api/v1/notifications/
		// quiet-hours (List, Create, Patch, Delete) are
		// unchanged; the AI surface NEVER persists state and
		// hands its typed candidate to the user via "Apply to
		// form" in the SPA.
		var quietHoursSuggestionHandler http.HandlerFunc = aiQuietHoursSuggestionStubHandler
		if h.QuietHoursSuggestion != nil {
			quietHoursSuggestionHandler = h.QuietHoursSuggestion.ServeHTTP
		}
		r.Post("/settings/quiet-hours/draft", g.Wrap("quiet-hours-suggestion", quietHoursSuggestionHandler))

		// safety-setting-explainer (Phase-50 / P3, slice 0054)
		// explains the user's existing safety-related TeslaSync
		// settings in plain English, grounded strictly in the
		// typed envelope query_safety_settings returns. The
		// route lives under /ai/settings/safety/explain so it
		// is namespaced under the existing /settings family.
		// Same stub-fallback pattern as the other AI handlers
		// — a nil handler is possible during partial wiring
		// but the off-mode 404 invariant still holds because
		// guard.Wrap returns 404 BEFORE the handler runs in
		// off mode. The canonical baseline routes at
		// /api/v1/settings (READ) + /api/v1/settings (WRITE)
		// are unchanged; the AI surface NEVER persists state
		// and never proposes a value — it explains the values
		// the user has already configured.
		var safetySettingExplainerHandler http.HandlerFunc = aiSafetySettingExplainerStubHandler
		if h.SafetySettingExplainer != nil {
			safetySettingExplainerHandler = h.SafetySettingExplainer.ServeHTTP
		}
		r.Post("/settings/safety/explain", g.Wrap("safety-setting-explainer", safetySettingExplainerHandler))

		// voice-mode (Phase-50 / V1, slice 0055) layers an
		// opt-in browser STT/TTS conversational surface on top
		// of the existing /chatbot text panel. The route lives
		// under /ai/voice/chat — namespaced under a new /voice
		// family because future voice surfaces (transcription
		// download, voice-only settings, etc.) will share the
		// prefix.
		//
		// Same stub-fallback pattern as the other AI handlers
		// — a nil handler is possible during partial wiring
		// but the off-mode 404 invariant still holds because
		// guard.Wrap returns 404 BEFORE the handler runs in
		// off mode. The canonical baseline route at
		// POST /api/v1/chatbot is unchanged; the AI surface
		// NEVER replaces the text panel — it COEXISTS with it.
		//
		// Browser STT/TTS is the only audio path; NO raw audio
		// bytes ever cross this handler. The request body is
		// text-only, just like /chatbot. (ADR-015 §I12.)
		var voiceModeHandler http.HandlerFunc = aiVoiceModeStubHandler
		if h.VoiceMode != nil {
			voiceModeHandler = h.VoiceMode.ServeHTTP
		}
		r.Post("/voice/chat", g.Wrap("voice-mode", voiceModeHandler))

		// watch-face-nl-response (Phase-50 / 0056, V2 slice).
		// Opt-in Helix narrator on the /watch route that answers
		// glance-style natural-language questions (battery, range,
		// charging, locks, climate, recent alerts) about the
		// install's primary vehicle. The narrator uses ONE
		// read-only typed tool (query_watch_context) that returns
		// a deterministic envelope mirroring the deterministic
		// /watch card state — same class of grounding the fixed
		// watch cards have, with watch-specific instructions to
		// keep replies SHORT and free of markdown / lists / code
		// blocks / URLs because watch panels render plain text
		// only.
		//
		// Same stub-fallback pattern as the other AI handlers — a
		// nil handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode. The
		// canonical baseline route at GET /api/v1/watch/summary
		// is unchanged; the AI surface NEVER replaces the
		// deterministic watch cards or tap-commands — it
		// COEXISTS with them.
		//
		// The narrator is READ-only: it NEVER claims to have
		// changed a setting, NEVER promises to send a vehicle
		// command. The deterministic tap-icons on the watch face
		// remain the only command path. (ADR-015 §I3 + §I5 +
		// §I6.)
		var watchFaceNLResponseHandler http.HandlerFunc = aiWatchFaceNLResponseStubHandler
		if h.WatchFaceNLResponse != nil {
			watchFaceNLResponseHandler = h.WatchFaceNLResponse.ServeHTTP
		}
		r.Post("/watch/respond", g.Wrap("watch-face-nl-response", watchFaceNLResponseHandler))

		// nl-sql-playground (Phase-50 / 0057, PU1 slice).
		// Opt-in Helix translator that converts a natural-language
		// request into a typed read-only SQL DRAFT (a single
		// SELECT or WITH statement against the curated install-
		// wide schema catalog) the user reviews in the AI side
		// panel of the manual SQL playground page at /power/sql,
		// then explicitly clicks the canonical Apply to editor
		// button to copy the draft into the manual SQL editor and
		// the canonical Run button to execute. The narrator NEVER
		// executes the SQL — there is no apply / execute tool;
		// the deny-by-default keyword scan + per-request scope
		// binding refuses anything other than a SELECT/WITH
		// against the curated table whitelist. The canonical
		// baseline editor on /power/sql is unchanged; the AI
		// surface NEVER replaces the deterministic editor — it
		// COEXISTS with it. (ADR-015 §I3 + §I5 + §I6.)
		var nlSqlPlaygroundHandler http.HandlerFunc = aiNLSqlPlaygroundStubHandler
		if h.NLSqlPlayground != nil {
			nlSqlPlaygroundHandler = h.NLSqlPlayground.ServeHTTP
		}
		r.Post("/power/sql/draft", g.Wrap("nl-sql-playground", nlSqlPlaygroundHandler))

		// nl-grafana-panel (Phase-50 / 0058, PU2 slice).
		// Opt-in Helix translator that converts a natural-language
		// data question into a typed GrafanaPanelDraft (a single
		// Grafana panel JSON envelope — title, type, datasource,
		// targets, grid_pos) the user reviews in the AI side
		// panel of the manual Grafana panel-builder page at
		// /power/grafana, then explicitly clicks the canonical
		// Apply to editor button to copy the draft into the
		// manual JSON editor and the canonical Copy to clipboard
		// button to paste it into their existing Grafana
		// dashboard editor. The narrator NEVER pushes the panel
		// — there is no apply / push tool; the per-request scope
		// binding refuses any panel type, datasource type, or
		// table outside the curated install-wide whitelists, and
		// the postgres rawSql contract refuses anything other
		// than a SELECT/WITH against the curated table whitelist.
		// The canonical baseline editor on /power/grafana is
		// unchanged; the AI surface NEVER replaces the
		// deterministic editor — it COEXISTS with it.
		// (ADR-015 §I3 + §I5 + §I6.)
		var nlGrafanaPanelHandler http.HandlerFunc = aiNLGrafanaPanelStubHandler
		if h.NLGrafanaPanel != nil {
			nlGrafanaPanelHandler = h.NLGrafanaPanel.ServeHTTP
		}
		r.Post("/power/grafana-panel/draft", g.Wrap("nl-grafana-panel", nlGrafanaPanelHandler))

		// nl-dashboard-composer (Phase-50 / 0059, PU3 slice).
		// Opt-in Helix translator that converts a natural-language
		// dashboard request into a typed DashboardLayoutDraft (a
		// single dashboard envelope — title + ordered list of
		// panel slots picking panels by name from a curated
		// install-wide panel catalog and placing each on the
		// Grafana 24-column grid) the user reviews in the AI side
		// panel of the manual dashboard composer page at
		// /power/dashboards, then explicitly clicks the canonical
		// Apply to editor button to copy the draft into the
		// manual JSON dashboard composer form and the canonical
		// Copy to clipboard button to paste it into their existing
		// Grafana dashboard editor. The narrator NEVER pushes the
		// dashboard — there is no apply / push tool; the
		// per-request scope binding refuses any panel_name outside
		// the curated install-wide whitelist, and the layout
		// contract refuses overlapping bounding boxes or more than
		// 12 slots. The canonical baseline composer on
		// /power/dashboards is unchanged; the AI surface NEVER
		// replaces the deterministic composer — it COEXISTS with
		// it. (ADR-015 §I3 + §I5 + §I6.)
		var nlDashboardComposerHandler http.HandlerFunc = aiNLDashboardComposerStubHandler
		if h.NLDashboardComposer != nil {
			nlDashboardComposerHandler = h.NLDashboardComposer.ServeHTTP
		}
		r.Post("/power/dashboard/draft", g.Wrap("nl-dashboard-composer", nlDashboardComposerHandler))

		// trip-postcard-share-card-image-generation (Phase-50 / 0060,
		// GEN1 slice) drafts a typed share-card image-prompt + a
		// render-ready preview envelope for ONE existing trip. The
		// LLM does NOT generate image bytes, NEVER calls an external
		// image-generation provider, and NEVER publishes / saves /
		// uploads anything — the surface is propose-only, mirroring
		// the auto-trip-naming pattern. The user reviews the
		// structured proposal in the AI panel and applies it through
		// the existing manual share-link controls in the SPA's
		// authenticated /sharing/trips page; the static /s/:token
		// share-card baseline (SharedDrivePage) is unchanged. Same
		// stub-fallback pattern as the other AI handlers — a nil
		// handler is possible during partial wiring but the off-mode
		// 404 invariant still holds because guard.Wrap returns 404
		// BEFORE the handler runs in off mode. (ADR-015 §I3 + §I5
		// + §I6.)
		var tripPostcardShareCardImageGenerationHandler http.HandlerFunc = aiTripPostcardShareCardImageGenerationStubHandler
		if h.TripPostcardShareCardImageGeneration != nil {
			tripPostcardShareCardImageGenerationHandler = h.TripPostcardShareCardImageGeneration.ServeHTTP
		}
		r.Post("/share-cards/trip-image/draft", g.Wrap("trip-postcard-share-card-image-generation", tripPostcardShareCardImageGenerationHandler))

		// vehicle-paint-preview (Phase-50 / 0061, GEN2 slice) drafts a
		// typed paint-preview image-prompt envelope (proposed color,
		// image prompt, optional one-word style hint) for ONE existing
		// vehicle grounded in the vehicle's read-only model / trim /
		// current exterior color. The LLM does NOT generate image
		// bytes, NEVER calls an external image-generation provider,
		// and NEVER persists or applies a new color — the surface is
		// propose-only, mirroring the auto-trip-naming +
		// trip-postcard patterns. The user reviews the structured
		// proposal in the AI panel on /vehicles/:vehicleId and
		// applies the new paint color through the existing manual
		// per-vehicle Color setting (VehicleConfigSection); the
		// existing vehicle photo gallery + manual exterior_color row
		// + manual theme/appearance settings are unchanged. Same
		// stub-fallback pattern as the other AI handlers — a nil
		// handler is possible during partial wiring but the off-mode
		// 404 invariant still holds because guard.Wrap returns 404
		// BEFORE the handler runs in off mode. (ADR-015 §I3 + §I5
		// + §I6.)
		var vehiclePaintPreviewHandler http.HandlerFunc = aiVehiclePaintPreviewStubHandler
		if h.VehiclePaintPreview != nil {
			vehiclePaintPreviewHandler = h.VehiclePaintPreview.ServeHTTP
		}
		r.Post("/vehicles/{vehicleID}/paint-preview/draft", g.Wrap("vehicle-paint-preview", vehiclePaintPreviewHandler))

		// vampire-drain-explanation (Phase-50 / C5, slice 0030).
		// Opt-in LLM narrator that explains the deterministic
		// idle-energy-loss (vampire-drain) signal the SPA's
		// VampireDrainPage already renders from
		// GET /api/v1/vampire-drain + GET /api/v1/vampire-drain/stats.
		// The route lives under /ai/charging/vampire-drain/explain
		// so it is namespaced under the existing /charging family.
		// Same stub-fallback pattern as the other AI handlers — a
		// nil handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode. The
		// canonical baseline routes at GET /api/v1/vampire-drain
		// and /api/v1/vampire-drain/stats are unchanged.
		//
		// IMPORTANT: registered BEFORE
		// /charging/{sessionID}/diagnose so chi's radix tree
		// disambiguates the static `/charging/vampire-drain/explain`
		// path before the wildcard.
		var vampireDrainExplanationHandler http.HandlerFunc = aiVampireDrainExplanationStubHandler
		if h.VampireDrainExplanation != nil {
			vampireDrainExplanationHandler = h.VampireDrainExplanation.ServeHTTP
		}
		r.Post("/charging/vampire-drain/explain", g.Wrap("vampire-drain-explanation", vampireDrainExplanationHandler))

		// preheat-precool-recommender (Phase-50 / T1, slice 0031).
		// Opt-in LLM agent that proposes a preheat or precool window
		// for the deterministic ClimateControlPage's manual climate
		// controls baseline. The route lives under
		// /ai/climate/schedule/draft so it is namespaced under the
		// existing /climate SPA route alias the AIPreheatPrecoolRecommender
		// component mounts on. Same stub-fallback pattern — a nil
		// handler is possible during partial wiring but the off-mode
		// 404 invariant still holds because guard.Wrap returns 404
		// BEFORE the handler runs in off mode. The canonical baseline
		// routes (GET /api/v1/climate/latest +
		// GET /api/v1/vehicles/{id}/state) are unchanged; the schedule
		// is PROPOSE-only and the user MUST click the existing manual
		// climate controls UI to apply.
		var preheatPrecoolRecommenderHandler http.HandlerFunc = aiPreheatPrecoolRecommenderStubHandler
		if h.PreheatPrecoolRecommender != nil {
			preheatPrecoolRecommenderHandler = h.PreheatPrecoolRecommender.ServeHTTP
		}
		r.Post("/climate/schedule/draft", g.Wrap("preheat-precool-recommender", preheatPrecoolRecommenderHandler))

		// cabin-temperature-impact-narrative (Phase-50 / T2, slice
		// 0032). Opt-in LLM narrator that explains how outside
		// ambient temperature affects driving efficiency and range
		// for the in-scope vehicle, grounded strictly in the same
		// deterministic bucketed-efficiency + monthly seasonal-trend
		// aggregates the existing /temperature-impact analytics page
		// already renders. The route lives under
		// /ai/climate/temperature-impact/narrate so it is namespaced
		// under the existing /climate AI surface family. Same
		// stub-fallback pattern — a nil handler is possible during
		// partial wiring but the off-mode 404 invariant still holds
		// because guard.Wrap returns 404 BEFORE the handler runs in
		// off mode. The canonical baseline route
		// (GET /api/v1/analytics/temperature-impact) is unchanged;
		// the narration is read-only and never modifies the
		// aggregates the chart renders.
		var cabinTemperatureImpactNarrativeHandler http.HandlerFunc = aiCabinTemperatureImpactNarrativeStubHandler
		if h.CabinTemperatureImpactNarrative != nil {
			cabinTemperatureImpactNarrativeHandler = h.CabinTemperatureImpactNarrative.ServeHTTP
		}
		r.Post("/climate/temperature-impact/narrate", g.Wrap("cabin-temperature-impact-narrative", cabinTemperatureImpactNarrativeHandler))

		// tire-pressure-trend-reasoning (Phase-50 / T3, slice
		// 0033). Opt-in LLM narrator that explains the recent
		// 30-day trend in the four corner tire pressures
		// (front-left, front-right, rear-left, rear-right) for
		// the in-scope vehicle, grounded strictly in the same
		// signal.StateReader.Timeline projection over the
		// TpmsPressure* + OutsideTemp signals that the existing
		// /tire-pressure baseline route already exposes. The
		// route lives under /ai/tire-pressure/trends/explain so
		// it is namespaced under the existing /tire-pressure
		// surface family. Same stub-fallback pattern — a nil
		// handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode. The
		// canonical baseline route (GET /api/v1/tire-pressure)
		// is unchanged; the narration is read-only and never
		// modifies the gauges or thresholds the SPA renders.
		var tirePressureTrendReasoningHandler http.HandlerFunc = aiTirePressureTrendReasoningStubHandler
		if h.TirePressureTrendReasoning != nil {
			tirePressureTrendReasoningHandler = h.TirePressureTrendReasoning.ServeHTTP
		}
		r.Post("/tire-pressure/trends/explain", g.Wrap("tire-pressure-trend-reasoning", tirePressureTrendReasoningHandler))

		// alert-tuning-suggestions (Phase-50 / A1, slice 0034).
		// Opt-in LLM that reads an existing alert rule + its
		// recent firing history (last 30 days) and proposes a
		// lower-noise typed AlertRule patch (threshold,
		// cooldown, severity, trigger_mode). The route lives
		// under /ai/alerts/rules/{ruleID}/tune/draft so it is
		// namespaced under the existing /alerts/rules surface
		// family. Same stub-fallback pattern — a nil handler is
		// possible during partial wiring but the off-mode 404
		// invariant still holds because guard.Wrap returns 404
		// BEFORE the handler runs in off mode. The canonical
		// baseline route (PUT /api/v1/alerts/rules/{ruleID}) is
		// unchanged; the AI is propose-only and never persists
		// — the user reviews the typed draft in AlertStudio and
		// applies it via the canonical Save button which calls
		// alertHandler.UpdateRule (ADR-015 §I3 + §I8).
		var alertTuningHandler http.HandlerFunc = aiAlertTuningStubHandler
		if h.AlertTuning != nil {
			alertTuningHandler = h.AlertTuning.ServeHTTP
		}
		r.Post("/alerts/rules/{ruleID}/tune/draft", g.Wrap("alert-tuning-suggestions", alertTuningHandler))

		// inbox-auto-categorization (Phase-50 / A2, slice 0035).
		// Opt-in LLM that reads recent notification_log rows
		// (last 7 days by default) for the requested vehicle +
		// severities, buckets them into a closed taxonomy of
		// nine categories (battery / charging / climate / tire
		// / security / connectivity / maintenance / noise /
		// other) using the deterministic substring mapper in
		// internal/ai/tools/inbox_auto_categorization.go, and
		// proposes which category buckets dominate the inbox.
		// The route lives under /ai/alerts/inbox/categorize so
		// it is namespaced under the existing /alerts surface
		// family. Same stub-fallback pattern — a nil handler is
		// possible during partial wiring but the off-mode 404
		// invariant still holds because guard.Wrap returns 404
		// BEFORE the handler runs in off mode. The canonical
		// baseline route (GET /api/v1/notifications/logs) is
		// unchanged; the AI is propose-only and never persists
		// — the user reviews the suggested category chips in
		// InboxBody and applies them via the canonical
		// rule_id filter on the existing baseline list endpoint
		// (ADR-015 §I3 + §I8).
		var inboxCategorizationHandler http.HandlerFunc = aiInboxCategorizationStubHandler
		if h.InboxCategorize != nil {
			inboxCategorizationHandler = h.InboxCategorize.ServeHTTP
		}
		r.Post("/alerts/inbox/categorize", g.Wrap("inbox-auto-categorization", inboxCategorizationHandler))

		// cross-rule-conflict-detection (Phase-50 / A3, slice 0036).
		// Opt-in LLM that READS the caller's alert_rules and
		// surfaces structural conflicts (rule-pair definitions
		// that overlap or are byte-identical) so the user can
		// review them via the existing baseline AlertStudio
		// editor. The route lives under
		// /ai/alerts/rules/conflicts so it is namespaced under
		// the existing /alerts surface family. Same stub-fallback
		// pattern — a nil handler is possible during partial
		// wiring but the off-mode 404 invariant still holds
		// because guard.Wrap returns 404 BEFORE the handler runs
		// in off mode. The canonical baseline routes
		// (GET /api/v1/alerts/rules + PUT /api/v1/alerts/rules/{id})
		// are unchanged; the AI is propose-only and never
		// persists — the user reviews the typed conflict cards
		// in AlertStudio and clicks "Review rule" which selects
		// the offending rule in the canonical sidebar list, then
		// edits it via the canonical typed editor + Save button
		// (ADR-015 §I3 + §I8).
		var crossRuleConflictHandler http.HandlerFunc = aiCrossRuleConflictStubHandler
		if h.CrossRuleConflict != nil {
			crossRuleConflictHandler = h.CrossRuleConflict.ServeHTTP
		}
		r.Post("/alerts/rules/conflicts", g.Wrap("cross-rule-conflict-detection", crossRuleConflictHandler))

		// auto-name-unnamed-locations (Phase-50 / G1, slice 0037).
		// Opt-in LLM that PROPOSES a concise, human-readable name
		// for ONE existing visited location. Same propose-only
		// invariant as auto-trip-naming (slice 0024) — the AI
		// reads the visited-location aggregate via the typed
		// draft_location_name + validate_location_name tool pair
		// and the user reviews the structured proposal in the
		// LocationsPage UI before clicking the existing baseline
		// Save / geofence-create affordance. The AI itself never
		// persists. Same stub-fallback pattern — a nil handler is
		// possible during partial wiring but the off-mode 404
		// invariant still holds because guard.Wrap returns 404
		// BEFORE the handler runs in off mode. The canonical
		// baseline route (GET /api/v1/locations) is unchanged
		// (ADR-015 §I3 + §I8).
		var autoNameUnnamedLocationsHandler http.HandlerFunc = aiAutoNameUnnamedLocationsStubHandler
		if h.AutoNameUnnamedLocations != nil {
			autoNameUnnamedLocationsHandler = h.AutoNameUnnamedLocations.ServeHTTP
		}
		r.Post("/locations/{locationID}/name/draft", g.Wrap("auto-name-unnamed-locations", autoNameUnnamedLocationsHandler))

		// suggest-new-geofences (Phase-50 / G2, slice 0038).
		// Opt-in LLM that PROPOSES a typed geofence draft (centroid
		// lat/lon + radius_m + name) for ONE existing visited
		// location based on its visit evidence (current
		// address_name, visit_count, total_duration_s,
		// last_visited). Same propose-only invariant as
		// auto-name-unnamed-locations (slice 0037) — the AI reads
		// the visited-location aggregate via the typed
		// draft_geofence + validate_geofence tool pair and the
		// user reviews the structured proposal in the
		// GeofencesPage UI before clicking "Apply to form" (which
		// copies the typed envelope into the existing baseline
		// Add Geofence form) and SAVES IT THEMSELVES via the
		// canonical POST /api/v1/geofences write path. The AI
		// itself never persists. Same stub-fallback pattern — a
		// nil handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode. The
		// canonical baseline route (POST /api/v1/geofences and
		// the rest of the geofence CRUD surface) is unchanged
		// (ADR-015 §I3 + §I8).
		//
		// The route has no URL path param — the caller picks the
		// candidate visited-location at click time and ships
		// `{"location_id": <int64>}` in the JSON body. The
		// handler clamps the id BEFORE opening the SSE stream.
		var suggestNewGeofencesHandler http.HandlerFunc = aiSuggestNewGeofencesStubHandler
		if h.SuggestNewGeofences != nil {
			suggestNewGeofencesHandler = h.SuggestNewGeofences.ServeHTTP
		}
		r.Post("/geofences/draft", g.Wrap("suggest-new-geofences", suggestNewGeofencesHandler))

		// geofence-aware-automation-suggestions (Phase-50 / G3,
		// slice 0039). Opt-in LLM that PROPOSES a typed Automation
		// graph DTO scoped to ONE of the user's existing geofences.
		// The strategy reuses the SAME draft_automation_graph +
		// validate_automation_graph tool pair slice 0016
		// (nl-automation-builder) registered process-wide; no new
		// tools are added. The handler injects a deterministic
		// geofence catalog (id + name + category — NEVER lat/lon;
		// PolicyAlertBuilder denies coordinate prose) into the
		// synthesised user message so the LLM picks `place_id`
		// from a fixed list rather than hallucinating one.
		// Same propose-only invariant — the AI never persists; the
		// user reviews the structured draft in the
		// AutomationBuilderPage UI before clicking "Apply to form"
		// (which copies the typed envelope into the existing
		// baseline form) and SAVES IT THEMSELVES via the canonical
		// POST /api/v1/automations write path
		// (internal/api/automation_handler.go +
		// internal/api/automation_handler_decode.go). The AI
		// itself never persists. Same stub-fallback pattern — a
		// nil handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode. The
		// canonical baseline route (POST /api/v1/automations and
		// the rest of the automation CRUD surface) is unchanged
		// (ADR-015 §I3 + §I8).
		//
		// The route has no URL path param — the caller picks the
		// in-scope vehicle at click time and ships
		// `{"vehicle_id": <int64>, "prompt": <string>}` in the
		// JSON body. The handler clamps the id and trims the
		// prompt BEFORE opening the SSE stream.
		var geofenceAwareAutomationHandler http.HandlerFunc = aiGeofenceAwareAutomationStubHandler
		if h.GeofenceAwareAutomation != nil {
			geofenceAwareAutomationHandler = h.GeofenceAwareAutomation.ServeHTTP
		}
		r.Post("/geofences/automations/draft", g.Wrap("geofence-aware-automation-suggestions", geofenceAwareAutomationHandler))

		// learned-per-vehicle-anomaly-baselines (Phase-50 / ML1,
		// slice 0062). Opt-in LLM narrator that EXPLAINS the
		// per-signal LEARNED anomaly envelope (mean / stddev / p5 /
		// p95 per signal, clamped to the static safe-range envelope;
		// safe-range fallback per signal when fewer than
		// anomaly.DefaultMinSamples observations exist in the
		// recent signal_log window) for ONE vehicle. The
		// deterministic Z-score detector with static safeRanges
		// served by GET /api/v1/vehicles/{vehicleID}/anomalies
		// (rendered via the SPA route /anomaly-detection and the
		// /analytics/anomalies alias) remains the canonical
		// baseline visible to every off-mode user. Same
		// stub-fallback pattern — a nil handler is possible during
		// partial wiring but the off-mode 404 invariant still
		// holds because guard.Wrap returns 404 BEFORE the handler
		// runs in off mode (ADR-015 §I3 + §I6).
		var learnedAnomalyBaselinesHandler http.HandlerFunc = aiLearnedAnomalyBaselinesStubHandler
		if h.LearnedAnomalyBaselines != nil {
			learnedAnomalyBaselinesHandler = h.LearnedAnomalyBaselines.ServeHTTP
		}
		r.Post("/ml/anomaly-baselines/train", g.Wrap("learned-per-vehicle-anomaly-baselines", learnedAnomalyBaselinesHandler))

		// range-prediction-model (Phase-50 / ML2, slice 0063).
		// Opt-in LLM narrator that EXPLAINS the per-bucket
		// (temp_bucket × speed_bucket) LEARNED range envelope (mean
		// Wh/km plus stddev / p5 / p95 per bucket; linear-fallback
		// to the static heuristic curve per bucket when fewer than
		// mlrange.DefaultMinSamplesPerBucket drives exist in the
		// recent `drives` window) for ONE vehicle. The deterministic
		// Projected Range page with the static heuristic curve
		// served by GET /api/v1/vehicles/{vehicleID}/range/projection
		// (rendered via the SPA route /projected-range and the
		// /analytics/range alias) remains the canonical baseline
		// visible to every off-mode user. Same stub-fallback pattern
		// as 0062 — a nil handler is possible during partial wiring
		// but the off-mode 404 invariant still holds because
		// guard.Wrap returns 404 BEFORE the handler runs in off
		// mode (ADR-015 §I3 + §I6).
		var rangePredictionHandler http.HandlerFunc = aiRangePredictionStubHandler
		if h.RangePrediction != nil {
			rangePredictionHandler = h.RangePrediction.ServeHTTP
		}
		r.Post("/ml/range/train", g.Wrap("range-prediction-model", rangePredictionHandler))

		// ml-charging-curve-clustering (Phase-50 / ML3, slice 0064).
		// Opt-in LLM narrator that EXPLAINS the per-cluster
		// (L1 overnight / L2 workplace / DC fast / unknown) LEARNED
		// charging envelope (mean peak power plus stddev / p5 / p95
		// per cluster, mean avg power / total energy / duration /
		// ramp shape; rule-label fallback per cluster when fewer
		// than mlchargingcurves.DefaultMinSessionsPerCluster=3
		// sessions exist in the recent `charging_sessions` window)
		// for ONE vehicle. The deterministic Charging Curve page
		// at /charging/curves remains the canonical baseline
		// visible to every off-mode user. Same stub-fallback
		// pattern as 0063 — a nil handler is possible during
		// partial wiring but the off-mode 404 invariant still
		// holds because guard.Wrap returns 404 BEFORE the handler
		// runs in off mode (ADR-015 §I3 + §I6).
		var mlChargingCurveClusteringHandler http.HandlerFunc = aiMLChargingCurveClusteringStubHandler
		if h.MLChargingCurveClustering != nil {
			mlChargingCurveClusteringHandler = h.MLChargingCurveClustering.ServeHTTP
		}
		r.Post("/ml/charging-curves/cluster", g.Wrap("ml-charging-curve-clustering", mlChargingCurveClusteringHandler))

		// charging-diagnosis (Phase-50 / N4, slice 0018).
		var chargingDiagnosisHandler http.HandlerFunc = aiChargingDiagnosisStubHandler
		if h.ChargingDiagnosis != nil {
			chargingDiagnosisHandler = h.ChargingDiagnosis.ServeHTTP
		}
		r.Post("/charging/{sessionID}/diagnose", g.Wrap("charging-diagnosis", chargingDiagnosisHandler))

		// rag-help (Phase-50 / N6, slice 0020). Same
		// stub-fallback pattern as the other AI handlers — a nil
		// handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode. The
		// route lives under /ai/help/... (parallel to the
		// deterministic /help SPA page that ships curated docs
		// links + tooltips + i18n help copy as the canonical
		// off-mode baseline) so the AI surface is namespaced and
		// can be removed in one route block if the feature is
		// ever decommissioned.
		var ragHelpHandler http.HandlerFunc = aiRagHelpStubHandler
		if h.RagHelp != nil {
			ragHelpHandler = h.RagHelp.ServeHTTP
		}
		r.Post("/help/query", g.Wrap("rag-help", ragHelpHandler))

		// nl-drive-search-replay (Phase-50 / D1, slice 0021). Same
		// stub-fallback pattern as the other AI handlers — a nil
		// handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode. The
		// route lives under /ai/drives/search (parallel to the
		// canonical /drives typed-filter list handler at
		// DriveListHandler and the existing /drives/:id/replay
		// TripReplayPage) so the AI surface is namespaced and can
		// be removed in one route block if the feature is ever
		// decommissioned. The handler accepts a JSON body with a
		// natural-language prompt and streams SSE frames that cite
		// drive replay anchors (/drives/{id}/replay).
		var driveSearchHandler http.HandlerFunc = aiDriveSearchStubHandler
		if h.DriveSearch != nil {
			driveSearchHandler = h.DriveSearch.ServeHTTP
		}
		r.Post("/drives/search", g.Wrap("nl-drive-search-replay", driveSearchHandler))

		// speed-profile-insights (Phase-50 / D2, slice 0022). Same
		// stub-fallback pattern as the other AI handlers — a nil
		// handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode. The
		// route lives under /ai/drives/{driveID}/speed-profile/...
		// (parallel to the canonical /drives/{driveID} typed
		// handler at DriveDetailHandler and the SpeedHistogramChart
		// rendered by DriveDetailPage) so the AI surface is
		// namespaced and can be removed in one route block if the
		// feature is ever decommissioned. driveID is a chi URL
		// param; the handler parses + validates it (positive int64)
		// and rejects 0 / negative / non-numeric values with a 400
		// BEFORE opening the SSE stream.
		var speedProfileInsightsHandler http.HandlerFunc = aiSpeedProfileInsightsStubHandler
		if h.SpeedProfileInsights != nil {
			speedProfileInsightsHandler = h.SpeedProfileInsights.ServeHTTP
		}
		r.Post("/drives/{driveID}/speed-profile/insights", g.Wrap("speed-profile-insights", speedProfileInsightsHandler))

		// route-efficiency-suggestions (Phase-50 / D3, slice 0023).
		// Same stub-fallback pattern as the other AI handlers — a
		// nil handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode. The
		// route lives under /ai/routes/{routeID}/efficiency/... so
		// the AI surface is namespaced and can be removed in one
		// route block if the feature is ever decommissioned. The
		// routeID URL param is parsed + validated by the handler
		// as a positive int64 anchor (the deterministic
		// /analytics/route-efficiency baseline groups by
		// start_place/end_place without a stable primary key, so
		// the routeID is opaque metadata the LLM embeds in its
		// user message; the read tool query_route_efficiency
		// returns the per-route aggregates the LLM narrates).
		// 0 / negative / non-numeric values are rejected with a
		// 400 BEFORE opening the SSE stream.
		var routeEfficiencySuggestionsHandler http.HandlerFunc = aiRouteEfficiencySuggestionsStubHandler
		if h.RouteEfficiencySuggestions != nil {
			routeEfficiencySuggestionsHandler = h.RouteEfficiencySuggestions.ServeHTTP
		}
		r.Post("/routes/{routeID}/efficiency/suggest", g.Wrap("route-efficiency-suggestions", routeEfficiencySuggestionsHandler))

		// auto-trip-naming (Phase-50 / D4, slice 0024).
		// Same stub-fallback pattern as the other AI handlers — a
		// nil handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode. The
		// route lives under /ai/trips/{tripID}/name/... so the AI
		// surface is namespaced and can be removed in one route
		// block if the feature is ever decommissioned. The tripID
		// URL param is parsed + validated by the handler as a
		// positive int64; 0 / negative / non-numeric values are
		// rejected with a 400 BEFORE opening the SSE stream. The
		// route is PROPOSE-only: it returns a structured trip-name
		// proposal envelope via SSE; the actual persistence flows
		// through an explicit user confirmation in the
		// TripDetailPage UI (out of scope for this slice).
		var autoTripNameHandler http.HandlerFunc = aiAutoTripNameStubHandler
		if h.AutoTripName != nil {
			autoTripNameHandler = h.AutoTripName.ServeHTTP
		}
		r.Post("/trips/{tripID}/name/draft", g.Wrap("auto-trip-naming", autoTripNameHandler))

		// trip-planner-llm-agent (Phase-50 / D5, slice 0025).
		// Same stub-fallback pattern as the other AI handlers — a
		// nil handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode. The
		// route lives under /ai/trips/plan/draft so the AI surface
		// is namespaced and can be removed in one route block if
		// the feature is ever decommissioned. The JSON body
		// (origin, destination, current_soc, optional knobs) is
		// parsed + validated by the handler BEFORE opening the SSE
		// stream; malformed bodies are rejected with a 400. The
		// route is PROPOSE-only: it returns a structured trip-plan
		// proposal envelope via SSE; the actual persistence flows
		// through an explicit user click on the existing canonical
		// Plan button in the TripPlannerPage UI which hits
		// POST /api/v1/trip-planner/plan (unchanged baseline).
		//
		// Chi route ordering: the static "plan" segment in
		// "/trips/plan/draft" registers BEFORE the wildcard
		// "/trips/{tripID}/name/draft" so chi's prefix-tree match
		// disambiguates cleanly — `/trips/plan/draft` matches the
		// trip-planner-llm-agent route, `/trips/42/name/draft`
		// matches the auto-trip-naming route.
		var tripPlannerLLMHandler http.HandlerFunc = aiTripPlannerLLMStubHandler
		if h.TripPlannerLLM != nil {
			tripPlannerLLMHandler = h.TripPlannerLLM.ServeHTTP
		}
		r.Post("/trips/plan/draft", g.Wrap("trip-planner-llm-agent", tripPlannerLLMHandler))

		// ai-provider-health (Phase-50 / F1, slice 0002).
		// Ops-only diagnostic. Triple-gated:
		//   guard.Wrap (mode + feature toggle) → RequireSudo → handler.
		// Returns 404 in off mode (ADR-015 §I6 + §I9 — provider
		// info MUST NOT leak when AI is disabled).
		r.With(sudoMW).Get("/_internal/health",
			g.Wrap("ai-provider-health", newAIInternalHealthHandler(registry)))
	})
}

// aiChatbotStubHandler is the legacy F0 fall-back. The U1 production
// path uses the real *AIChatbotHandler; the stub remains so a
// defensive nil-handler wiring still yields a meaningful 501 instead
// of panicking. Ops never see this in normal operation.
func aiChatbotStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai chatbot is not yet implemented")
}

// aiDigestStubHandler mirrors aiChatbotStubHandler for the U2 slice.
// Reachable only when AIDigestHandler is nil at construction; the
// off-mode 404 invariant is held by the guard, not the stub.
func aiDigestStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai digest narration is not yet implemented")
}

// aiYIRStubHandler mirrors aiDigestStubHandler for the U3 slice.
// Reachable only when AIYearReviewHandler is nil at construction; the
// off-mode 404 invariant is held by the guard, not the stub.
func aiYIRStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai year-in-review narration is not yet implemented")
}

// aiAnomalyStubHandler mirrors aiYIRStubHandler for the U4 slice.
// Reachable only when AIAnomalyHandler is nil at construction; the
// off-mode 404 invariant is held by the guard, not the stub.
func aiAnomalyStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai anomaly explanation is not yet implemented")
}

// aiAlertStubHandler mirrors aiAnomalyStubHandler for the N1 slice
// (Phase-50 / 0015 nl-alert-builder). Reachable only when
// AIAlertHandler is nil at construction; the off-mode 404 invariant
// is held by the guard, not the stub.
func aiAlertStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai alert builder is not yet implemented")
}

// aiAutomationStubHandler mirrors aiAlertStubHandler for the N2 slice
// (Phase-50 / 0016 nl-automation-builder). Reachable only when
// AIAutomationHandler is nil at construction; the off-mode 404
// invariant is held by the guard, not the stub.
func aiAutomationStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai automation builder is not yet implemented")
}

// aiSearchStubHandler mirrors aiAutomationStubHandler for the N3 slice
// (Phase-50 / 0017 nl-search). Reachable only when AISearchHandler is
// nil at construction; the off-mode 404 invariant is held by the
// guard, not the stub.
func aiSearchStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai natural-language search is not yet implemented")
}

// aiDriveCoachStubHandler mirrors aiSearchStubHandler for the N4 slice
// (Phase-50 / 0018 drive-coaching). Reachable only when
// AIDriveCoachHandler is nil at construction; the off-mode 404
// invariant is held by the guard, not the stub.
func aiDriveCoachStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai drive coaching is not yet implemented")
}

// aiChargingDiagnosisStubHandler mirrors aiDriveCoachStubHandler for
// the N5 slice (Phase-50 / 0019 charging-diagnosis). Reachable only
// when AIChargingDiagnosisHandler is nil at construction; the
// off-mode 404 invariant is held by the guard, not the stub.
func aiChargingDiagnosisStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai charging diagnosis is not yet implemented")
}

// aiRagHelpStubHandler mirrors aiChargingDiagnosisStubHandler for
// the N6 slice (Phase-50 / 0020 rag-help). Reachable only when
// AIRAGHelpHandler is nil at construction; the off-mode 404
// invariant is held by the guard, not the stub.
func aiRagHelpStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai rag help is not yet implemented")
}

// aiDriveSearchStubHandler mirrors aiRagHelpStubHandler for the D1
// slice (Phase-50 / 0021 nl-drive-search-replay). Reachable only
// when AIDriveSearchHandler is nil at construction; the off-mode
// 404 invariant is held by the guard, not the stub.
func aiDriveSearchStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai natural-language drive search and replay is not yet implemented")
}

// aiSpeedProfileInsightsStubHandler mirrors aiDriveSearchStubHandler
// for the D2 slice (Phase-50 / 0022 speed-profile-insights).
// Reachable only when AISpeedProfileInsightsHandler is nil at
// construction; the off-mode 404 invariant is held by the guard,
// not the stub.
func aiSpeedProfileInsightsStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai speed-profile insights is not yet implemented")
}

// aiRouteEfficiencySuggestionsStubHandler mirrors
// aiSpeedProfileInsightsStubHandler for the D3 slice (Phase-50 /
// 0023 route-efficiency-suggestions). Reachable only when
// AIRouteEfficiencySuggestionsHandler is nil at construction; the
// off-mode 404 invariant is held by the guard, not the stub.
func aiRouteEfficiencySuggestionsStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai route-efficiency suggestions is not yet implemented")
}

// aiAutoTripNameStubHandler mirrors
// aiRouteEfficiencySuggestionsStubHandler for the D4 slice
// (Phase-50 / 0024 auto-trip-naming). Reachable only when
// AIAutoTripNameHandler is nil at construction; the off-mode 404
// invariant is held by the guard, not the stub.
func aiAutoTripNameStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai auto trip naming is not yet implemented")
}

// aiTripPlannerLLMStubHandler mirrors aiAutoTripNameStubHandler for
// the D5 slice (Phase-50 / 0025 trip-planner-llm-agent). Reachable
// only when AITripPlannerLLMHandler is nil at construction; the
// off-mode 404 invariant is held by the guard, not the stub.
func aiTripPlannerLLMStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai trip-planner LLM agent is not yet implemented")
}

// aiSmartChargeScheduleStubHandler mirrors
// aiTripPlannerLLMStubHandler for the C1 slice (Phase-50 / 0026
// smart-charge-schedule-suggestion). Reachable only when
// AISmartChargeScheduleHandler is nil at construction; the
// off-mode 404 invariant is held by the guard, not the stub.
func aiSmartChargeScheduleStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai smart-charge schedule suggestion is not yet implemented")
}

// aiBatteryHealthStubHandler mirrors aiSmartChargeScheduleStubHandler
// for the C2 slice (Phase-50 / 0027
// battery-health-forecast-narrative). Reachable only when
// AIBatteryHealthHandler is nil at construction; the off-mode 404
// invariant is held by the guard, not the stub.
func aiBatteryHealthStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai battery health forecast narrative is not yet implemented")
}

// aiChargingCurveClusteringStubHandler mirrors
// aiBatteryHealthStubHandler for the C3 slice (Phase-50 / 0028
// charging-curve-fingerprint-clustering). Reachable only when
// AIChargingCurveClusteringHandler is nil at construction; the
// off-mode 404 invariant is held by the guard, not the stub.
func aiChargingCurveClusteringStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai charging-curve fingerprint clustering is not yet implemented")
}

// aiCostForecastNarrationStubHandler mirrors
// aiChargingCurveClusteringStubHandler for the C4 slice
// (Phase-50 / 0029 cost-forecast-narration). Reachable only when
// AICostForecastNarrationHandler is nil at construction; the
// off-mode 404 invariant is held by the guard, not the stub.
func aiCostForecastNarrationStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai cost forecast narration is not yet implemented")
}

// aiVampireDrainExplanationStubHandler mirrors
// aiCostForecastNarrationStubHandler for the C5 slice
// (Phase-50 / 0030 vampire-drain-explanation). Reachable only when
// AIVampireDrainHandler is nil at construction; the off-mode 404
// invariant is held by the guard, not the stub.
func aiVampireDrainExplanationStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai vampire-drain explanation is not yet implemented")
}

// aiPreheatPrecoolRecommenderStubHandler mirrors
// aiVampireDrainExplanationStubHandler for the T1 slice
// (Phase-50 / 0031 preheat-precool-recommender). Reachable only
// when AIClimateScheduleHandler is nil at construction; the
// off-mode 404 invariant is held by the guard, not the stub.
func aiPreheatPrecoolRecommenderStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai preheat-precool recommender is not yet implemented")
}

// aiCabinTemperatureImpactNarrativeStubHandler mirrors
// aiPreheatPrecoolRecommenderStubHandler for the T2 slice
// (Phase-50 / 0032 cabin-temperature-impact-narrative). Reachable
// only when AICabinTemperatureImpactHandler is nil at
// construction; the off-mode 404 invariant is held by the guard,
// not the stub.
func aiCabinTemperatureImpactNarrativeStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai cabin temperature impact narrative is not yet implemented")
}

// aiTirePressureTrendReasoningStubHandler mirrors
// aiCabinTemperatureImpactNarrativeStubHandler for the T3 slice
// (Phase-50 / 0033 tire-pressure-trend-reasoning). Reachable only
// when AITirePressureTrendHandler is nil at construction; the
// off-mode 404 invariant is held by the guard, not the stub.
func aiTirePressureTrendReasoningStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai tire-pressure trend reasoning is not yet implemented")
}

// aiAlertTuningStubHandler mirrors
// aiTirePressureTrendReasoningStubHandler for the A1 slice
// (Phase-50 / 0034 alert-tuning-suggestions). Reachable only
// when AIAlertTuningHandler is nil at construction; the off-mode
// 404 invariant is held by the guard, not the stub.
func aiAlertTuningStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai alert tuning suggestions is not yet implemented")
}

// aiInboxCategorizationStubHandler mirrors aiAlertTuningStubHandler
// for the A2 slice (Phase-50 / 0035 inbox-auto-categorization).
// Reachable only when AIInboxCategorizationHandler is nil at
// construction; the off-mode 404 invariant is held by the guard,
// not the stub.
func aiInboxCategorizationStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai inbox auto-categorization is not yet implemented")
}

// aiCrossRuleConflictStubHandler mirrors aiInboxCategorizationStubHandler
// for the A3 slice (Phase-50 / 0036 cross-rule-conflict-detection).
// Reachable only when AICrossRuleConflictHandler is nil at
// construction; the off-mode 404 invariant is held by the guard,
// not the stub.
func aiCrossRuleConflictStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai cross-rule conflict detection is not yet implemented")
}

// aiAutoNameUnnamedLocationsStubHandler mirrors aiCrossRuleConflictStubHandler
// for the G1 slice (Phase-50 / 0037 auto-name-unnamed-locations).
// Reachable only when AIAutoNameUnnamedLocationsHandler is nil at
// construction; the off-mode 404 invariant is held by the guard,
// not the stub.
func aiAutoNameUnnamedLocationsStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai auto-name-unnamed-locations is not yet implemented")
}

// aiSuggestNewGeofencesStubHandler mirrors aiAutoNameUnnamedLocationsStubHandler
// for the G2 slice (Phase-50 / 0038 suggest-new-geofences).
// Reachable only when AISuggestNewGeofencesHandler is nil at
// construction; the off-mode 404 invariant is held by the guard,
// not the stub.
func aiSuggestNewGeofencesStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai suggest-new-geofences is not yet implemented")
}

// aiGeofenceAwareAutomationStubHandler mirrors aiSuggestNewGeofencesStubHandler
// for the G3 slice (Phase-50 / 0039 geofence-aware-automation-suggestions).
// Reachable only when AIGeofenceAwareAutomationHandler is nil at
// construction; the off-mode 404 invariant is held by the guard,
// not the stub.
func aiGeofenceAwareAutomationStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai geofence-aware-automation-suggestions is not yet implemented")
}

// aiLearnedAnomalyBaselinesStubHandler mirrors aiAutoNameUnnamedLocationsStubHandler
// for the ML1 slice (Phase-50 / 0062 learned-per-vehicle-anomaly-baselines).
// Reachable only when AILearnedAnomalyBaselineHandler is nil at
// construction; the off-mode 404 invariant is held by the guard,
// not the stub.
func aiLearnedAnomalyBaselinesStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai learned per-vehicle anomaly baselines is not yet implemented")
}

// aiRangePredictionStubHandler mirrors aiLearnedAnomalyBaselinesStubHandler
// for the ML2 slice (Phase-50 / 0063 range-prediction-model).
// Reachable only when AIRangePredictionHandler is nil at
// construction; the off-mode 404 invariant is held by the guard,
// not the stub.
func aiRangePredictionStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai range prediction model is not yet implemented")
}

// aiMLChargingCurveClusteringStubHandler mirrors
// aiRangePredictionStubHandler for the ML3 slice (Phase-50 / 0064
// ml-charging-curve-clustering). Reachable only when
// AIMLChargingCurveHandler is nil at construction; the off-mode
// 404 invariant is held by the guard, not the stub.
func aiMLChargingCurveClusteringStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai ml-charging-curve-clustering is not yet implemented")
}

// aiPeriodCompareNarrationStubHandler mirrors
// aiCostForecastNarrationStubHandler for the X1 slice (Phase-50 /
// 0040 period-compare-narration). Reachable only when
// AIPeriodCompareNarrationHandler is nil at construction; the
// off-mode 404 invariant is held by the guard, not the stub.
func aiPeriodCompareNarrationStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai period compare narration is not yet implemented")
}

// aiLifetimeStatsQAStubHandler mirrors
// aiPeriodCompareNarrationStubHandler for the X2 slice (Phase-50 /
// 0041 lifetime-stats-qa). Reachable only when
// AILifetimeStatsQAHandler is nil at construction; the off-mode
// 404 invariant is held by the guard, not the stub.
func aiLifetimeStatsQAStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai lifetime stats qa is not yet implemented")
}

// aiIncidentTimelineSummarizerStubHandler mirrors
// aiLifetimeStatsQAStubHandler for the S1 slice (Phase-50 / 0042
// incident-timeline-summarizer). Reachable only when
// AIIncidentTimelineSummarizerHandler is nil at construction; the
// off-mode 404 invariant is held by the guard, not the stub.
func aiIncidentTimelineSummarizerStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai incident timeline summarizer is not yet implemented")
}

// aiDataRepairSuggestionsStubHandler mirrors
// aiIncidentTimelineSummarizerStubHandler for the S2 slice
// (Phase-50 / 0043 data-repair-suggestions). Reachable only when
// AIDataRepairSuggestionsHandler is nil at construction; the
// off-mode 404 invariant is held by the guard, not the stub.
func aiDataRepairSuggestionsStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai data-repair suggestions is not yet implemented")
}

// aiSignalExplorerNlFilterStubHandler mirrors
// aiDataRepairSuggestionsStubHandler for the S3 slice (Phase-50 /
// 0044 signal-explorer-nl-filter). Reachable only when
// AISignalExplorerNlFilterHandler is nil at construction; the
// off-mode 404 invariant is held by the guard, not the stub.
func aiSignalExplorerNlFilterStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai signal-explorer nl filter is not yet implemented")
}

// aiLogTraceSummarizationStubHandler mirrors
// aiSignalExplorerNlFilterStubHandler for the S4 slice (Phase-50
// / 0045 log-trace-summarization). Reachable only when
// AILogTraceSummarizationHandler is nil at construction; the
// off-mode 404 invariant is held by the guard, not the stub.
func aiLogTraceSummarizationStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai log-trace summarization is not yet implemented")
}

// aiFeedbackQueueTriageStubHandler mirrors
// aiLogTraceSummarizationStubHandler for the S5 slice (Phase-50
// / 0046 feedback-queue-triage). Reachable only when
// AIFeedbackQueueTriageHandler is nil at construction; the
// off-mode 404 invariant is held by the guard, not the stub.
func aiFeedbackQueueTriageStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai feedback queue triage is not yet implemented")
}

// aiMqttSseInspectorExplanationsStubHandler mirrors
// aiFeedbackQueueTriageStubHandler for the S6 slice (Phase-50
// / 0047 mqtt-sse-inspector-explanations). Reachable only when
// AIMqttSseInspectorExplanationsHandler is nil at construction;
// the off-mode 404 invariant is held by the guard, not the
// stub.
func aiMqttSseInspectorExplanationsStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai mqtt-sse inspector explanations is not yet implemented")
}

// aiStateMachineDebuggerNarratorStubHandler mirrors
// aiMqttSseInspectorExplanationsStubHandler for the S7 slice
// (Phase-50 / 0048 state-machine-debugger-narrator). Reachable
// only when AIStateMachineDebuggerNarratorHandler is nil at
// construction; the off-mode 404 invariant is held by the
// guard, not the stub.
func aiStateMachineDebuggerNarratorStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai state-machine debugger narrator is not yet implemented")
}

// aiPredictiveMaintenanceStubHandler mirrors
// aiStateMachineDebuggerNarratorStubHandler for the M1 slice
// (Phase-50 / 0049 predictive-maintenance). Reachable only when
// AIPredictiveMaintenanceHandler is nil at construction; the
// off-mode 404 invariant is held by the guard, not the stub.
func aiPredictiveMaintenanceStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai predictive maintenance is not yet implemented")
}

// aiTCONarrationStubHandler mirrors aiPredictiveMaintenanceStubHandler
// for the M2 slice (Phase-50 / 0050 tco-narration). Reachable only
// when AITCONarrationHandler is nil at construction; the off-mode
// 404 invariant is held by the guard, not the stub.
func aiTCONarrationStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai tco narration is not yet implemented")
}

// aiSoftwareUpdateChangelogSummarizerStubHandler mirrors
// aiTCONarrationStubHandler for the M3 slice (Phase-50 / 0051
// software-update-changelog-summarizer). Reachable only when
// AISoftwareUpdateChangelogSummarizerHandler is nil at
// construction; the off-mode 404 invariant is held by the
// guard, not the stub.
func aiSoftwareUpdateChangelogSummarizerStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai software update changelog summarizer is not yet implemented")
}

// aiPiiRedactionSharedExportsStubHandler mirrors
// aiSoftwareUpdateChangelogSummarizerStubHandler for the P1
// slice (Phase-50 / 0052 pii-redaction-shared-exports).
// Reachable only when AIPiiRedactionSharedExportsHandler is nil
// at construction; the off-mode 404 invariant is held by the
// guard, not the stub.
func aiPiiRedactionSharedExportsStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai pii redaction shared exports is not yet implemented")
}

// aiQuietHoursSuggestionStubHandler mirrors
// aiPiiRedactionSharedExportsStubHandler for the P2 slice
// (Phase-50 / 0053 quiet-hours-suggestion). Reachable only when
// AIQuietHoursSuggestionHandler is nil at construction; the
// off-mode 404 invariant is held by the guard, not the stub.
func aiQuietHoursSuggestionStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai quiet hours suggestion is not yet implemented")
}

// aiSafetySettingExplainerStubHandler mirrors
// aiQuietHoursSuggestionStubHandler for the P3 slice
// (Phase-50 / 0054 safety-setting-explainer). Reachable only
// when AISafetySettingExplainerHandler is nil at construction;
// the off-mode 404 invariant is held by the guard, not the
// stub.
func aiSafetySettingExplainerStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai safety setting explainer is not yet implemented")
}

// aiVoiceModeStubHandler mirrors
// aiSafetySettingExplainerStubHandler for the V1 slice
// (Phase-50 / 0055 voice-mode). Reachable only when
// AIVoiceModeHandler is nil at construction; the off-mode 404
// invariant is held by the guard, not the stub.
func aiVoiceModeStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai voice mode is not yet implemented")
}

// aiWatchFaceNLResponseStubHandler mirrors the other AI stub
// handlers for the V2 slice (Phase-50 / 0056 watch-face-nl-
// response). Reachable only when AIWatchFaceNLResponseHandler
// is nil at construction; the off-mode 404 invariant is held by
// the guard, not the stub.
func aiWatchFaceNLResponseStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai watch face natural-language response is not yet implemented")
}

// aiNLSqlPlaygroundStubHandler mirrors the other AI stub
// handlers for the PU1 slice (Phase-50 / 0057 nl-sql-
// playground). Reachable only when AINLSQLPlaygroundHandler is
// nil at construction; the off-mode 404 invariant is held by
// the guard, not the stub.
func aiNLSqlPlaygroundStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai natural-language sql playground is not yet implemented")
}

// aiNLGrafanaPanelStubHandler mirrors the other AI stub handlers
// for the PU2 slice (Phase-50 / 0058 nl-grafana-panel).
// Reachable only when AINLGrafanaPanelHandler is nil at
// construction; the off-mode 404 invariant is held by the guard,
// not the stub.
func aiNLGrafanaPanelStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai natural-language grafana panel is not yet implemented")
}

// aiNLDashboardComposerStubHandler mirrors the other AI stub
// handlers for the PU3 slice (Phase-50 / 0059
// nl-dashboard-composer). Reachable only when
// AINLDashboardComposerHandler is nil at construction; the
// off-mode 404 invariant is held by the guard, not the stub.
func aiNLDashboardComposerStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai natural-language dashboard composer is not yet implemented")
}

// aiTripPostcardShareCardImageGenerationStubHandler mirrors the
// other AI stub handlers for the GEN1 slice (Phase-50 / 0060
// trip-postcard-share-card-image-generation). Reachable only when
// AITripPostcardShareCardImageGenerationHandler is nil at
// construction; the off-mode 404 invariant is held by the guard,
// not the stub.
func aiTripPostcardShareCardImageGenerationStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai trip postcard / share-card image-prompt generation is not yet implemented")
}

// aiVehiclePaintPreviewStubHandler mirrors the other AI stub
// handlers for the GEN2 slice (Phase-50 / 0061 vehicle-paint-preview).
// Reachable only when AIVehiclePaintPreviewHandler is nil at
// construction; the off-mode 404 invariant is held by the guard,
// not the stub.
func aiVehiclePaintPreviewStubHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "ai vehicle paint-preview image-prompt generation is not yet implemented")
}

// userPrefsMiddleware reads the global Application settings on every
// /api/v1/ai/* request and installs the resulting [dispatch.UserPrefs]
// on the request context. The dispatcher's Run consults that ctx and
// prepends a SHORT "narrate in MILES/MPH/°F/PSI/$/locale" system
// message right after the strategy's prompt, ensuring every LLM
// response uses the same units the rest of the UI already does.
//
// Failure modes are deliberately silent: if the settings repo is nil
// (test wiring) or the Get call errors (DB unreachable, schema drift,
// etc.) the middleware logs at debug and proceeds without installing
// prefs. The dispatcher treats a missing ctx value as "no hint" and
// behaves exactly as it did before this middleware existed, so the
// AI features still work — they just won't honour units that request.
// That's the conservative choice: an outage in the settings table
// must NOT take down AI narration entirely.
//
// Performance: Settings.Get is a single SELECT against the very small
// `settings` key/value table (well under 50 rows) executed once per
// AI request. The LLM call that follows is the dominant cost by 3-5
// orders of magnitude, so the Get is not on the critical path.
func userPrefsMiddleware(settingsRepo *settingsdb.SettingsRepo) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if settingsRepo == nil {
				next.ServeHTTP(w, r)
				return
			}
			s, err := settingsRepo.Get(r.Context())
			if err != nil || s == nil {
				if err != nil {
					log.Debug().Err(err).Msg("ai: user prefs middleware: settings fetch failed, proceeding without unit hint")
				}
				next.ServeHTTP(w, r)
				return
			}
			prefs := dispatch.UserPrefs{
				UnitOfLength:     s.UnitOfLength,
				UnitOfTemp:       s.UnitOfTemp,
				UnitOfPressure:   s.UnitOfPressure,
				PreferredRange:   s.PreferredRange,
				CurrencySymbol:   s.CurrencySymbol,
				DecimalPrecision: s.DecimalPrecision,
				Locale:           s.Locale,
				Language:         s.Language,
			}
			ctx := dispatch.WithUserPrefs(r.Context(), prefs)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
