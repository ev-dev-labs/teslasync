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
	"github.com/ev-dev-labs/teslasync/internal/database"
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
// Parameters:
//   - r          : the parent chi router (the /api/v1 subroute).
//   - g          : the AI feature guard (mode + per-feature toggle).
//   - registry   : the provider registry (Phase-50 / F1, slice 0002).
//   - sudoMW     : RequireSudo middleware factory baked with the live
//                  sudoStore + sudoCfg. Wrapped around ops-only routes
//                  like /_internal/health so an attacker who somehow
//                  opens the feature toggle still needs a fresh sudo
//                  token to reach the diagnostic.
//   - aiChatbot  : the real LLM-backed handler from
//                  internal/api/ai_chatbot_handler.go (Phase-50 / U1).
//                  May be nil during early bring-up; nil falls back to
//                  the F0 501 stub so the off-mode 404 invariant still
//                  holds.
//   - aiDigest   : the real LLM-backed handler for the weekly digest
//                  narration (Phase-50 / U2). May be nil during early
//                  bring-up; nil falls back to the same 501 stub.
//   - aiYIR      : the real LLM-backed handler for the year-in-review
//                  narration (Phase-50 / U3, slice 0013). Same nil
//                  fallback as the chatbot/digest handlers.
//   - aiAnomaly  : the real LLM-backed handler for the anomaly
//                  explanation narration (Phase-50 / U4, slice 0014).
//                  Same nil fallback pattern.
//   - aiAlert    : the real LLM-backed handler for the natural-language
//                  alert builder (Phase-50 / N1, slice 0015). Same nil
//                  fallback pattern.
//   - aiAutomation: the real LLM-backed handler for the natural-language
//                  automation builder (Phase-50 / N2, slice 0016). Same
//                  nil fallback pattern.
//   - aiSearch   : the real LLM-backed handler for the natural-language
//                  search across drives, charges, and alerts
//                  (Phase-50 / N3, slice 0017). Same nil fallback pattern.
//   - aiDriveCoach: the real LLM-backed handler for the per-drive
//                  coaching narrative (Phase-50 / N4, slice 0018). Same
//                  nil fallback pattern.
//   - aiChargingDiagnosis: the real LLM-backed handler for the per-charging-
//                  session diagnosis (Phase-50 / N5, slice 0019). Same
//                  nil fallback pattern.
//   - aiRagHelp  : the real LLM-backed handler for the RAG-backed app
//                  help assistant (Phase-50 / N6, slice 0020). Same
//                  nil fallback pattern.
//   - aiDriveSearch: the real LLM-backed handler for the natural-language
//                  drive search and replay assistant (Phase-50 / D1,
//                  slice 0021). Same nil fallback pattern.
//   - aiSpeedProfileInsights: the real LLM-backed handler for the per-drive
//                  speed-profile insights narrative (Phase-50 / D2,
//                  slice 0022). Same nil fallback pattern.
//   - aiRouteEfficiencySuggestions: the real LLM-backed handler for the
//                  route-efficiency suggestions narrative (Phase-50 / D3,
//                  slice 0023). Same nil fallback pattern.
//   - aiAutoTripName: the real LLM-backed handler for the auto trip
//                  naming suggestion (Phase-50 / D4, slice 0024). Same
//                  nil fallback pattern.
//   - aiTripPlannerLLM: the real LLM-backed handler for the
//                  trip-planner LLM agent (Phase-50 / D5, slice 0025).
//                  Same nil fallback pattern.
//   - aiSmartChargeSchedule: the real LLM-backed handler for the
//                  smart-charge schedule suggestion (Phase-50 / C1,
//                  slice 0026). Same nil fallback pattern.
//   - aiBatteryHealth: the real LLM-backed handler for the battery
//                  health forecast narrative (Phase-50 / C2,
//                  slice 0027). Same nil fallback pattern.
//   - aiChargingCurveClustering: the real LLM-backed handler for
//                  the charging-curve fingerprint clustering
//                  narrator (Phase-50 / C3, slice 0028). Same nil
//                  fallback pattern.
func mountAIRoutes(
	r chi.Router,
	g *guard.Guard,
	registry *provider.Registry,
	settingsRepo *database.SettingsRepo,
	sudoMW func(http.Handler) http.Handler,
	aiChatbot *AIChatbotHandler,
	aiDigest *AIDigestHandler,
	aiYIR *AIYearReviewHandler,
	aiAnomaly *AIAnomalyHandler,
	aiAlert *AIAlertHandler,
	aiAutomation *AIAutomationHandler,
	aiSearch *AISearchHandler,
	aiDriveCoach *AIDriveCoachHandler,
	aiChargingDiagnosis *AIChargingDiagnosisHandler,
	aiRagHelp *AIRAGHelpHandler,
	aiDriveSearch *AIDriveSearchHandler,
	aiSpeedProfileInsights *AISpeedProfileInsightsHandler,
	aiRouteEfficiencySuggestions *AIRouteEfficiencySuggestionsHandler,
	aiAutoTripName *AIAutoTripNameHandler,
	aiTripPlannerLLM *AITripPlannerLLMHandler,
	aiSmartChargeSchedule *AISmartChargeScheduleHandler,
	aiBatteryHealth *AIBatteryHealthHandler,
	aiChargingCurveClustering *AIChargingCurveClusteringHandler,
	aiCostForecastNarration *AICostForecastNarrationHandler,
	aiVampireDrainExplanation *AIVampireDrainHandler,
	aiPreheatPrecoolRecommender *AIClimateScheduleHandler,
	aiCabinTemperatureImpactNarrative *AICabinTemperatureImpactHandler,
	aiTirePressureTrendReasoning *AITirePressureTrendHandler,
	aiAlertTuning *AIAlertTuningHandler,
	aiInboxCategorize *AIInboxCategorizationHandler,
	aiCrossRuleConflict *AICrossRuleConflictHandler,
	aiAutoNameUnnamedLocations *AIAutoNameUnnamedLocationsHandler,
	aiSuggestNewGeofences *AISuggestNewGeofencesHandler,
	aiGeofenceAwareAutomation *AIGeofenceAwareAutomationHandler,
	aiLearnedAnomalyBaselines *AILearnedAnomalyBaselineHandler,
	aiRangePrediction *AIRangePredictionHandler,
	aiMLChargingCurveClustering *AIMLChargingCurveHandler,
	aiPeriodCompareNarration *AIPeriodCompareNarrationHandler,
	aiLifetimeStatsQA *AILifetimeStatsQAHandler,
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
		if aiChatbot != nil {
			chatbotHandler = aiChatbot.ServeHTTP
		}
		r.Post("/chatbot", g.Wrap("chatbot-llm", chatbotHandler))

		// digest-narration (Phase-50 / U2, slice 0012). Same
		// stub-fallback pattern as chatbot — a nil handler is
		// possible during partial wiring but the off-mode 404
		// invariant still holds because guard.Wrap returns 404
		// BEFORE the handler runs in off mode.
		var digestHandler http.HandlerFunc = aiDigestStubHandler
		if aiDigest != nil {
			digestHandler = aiDigest.ServeHTTP
		}
		r.Post("/digests/weekly/narrate", g.Wrap("digest-narration", digestHandler))

		// yir-narration (Phase-50 / U3, slice 0013). Same
		// stub-fallback pattern as chatbot/digest — a nil handler
		// is possible during partial wiring but the off-mode 404
		// invariant still holds because guard.Wrap returns 404
		// BEFORE the handler runs in off mode.
		var yirHandler http.HandlerFunc = aiYIRStubHandler
		if aiYIR != nil {
			yirHandler = aiYIR.ServeHTTP
		}
		r.Post("/analytics/year-in-review/narrate", g.Wrap("yir-narration", yirHandler))

		// anomaly-explanations (Phase-50 / U4, slice 0014). Same
		// stub-fallback pattern as chatbot/digest/yir — a nil
		// handler is possible during partial wiring but the
		// off-mode 404 invariant still holds because guard.Wrap
		// returns 404 BEFORE the handler runs in off mode.
		var anomalyHandler http.HandlerFunc = aiAnomalyStubHandler
		if aiAnomaly != nil {
			anomalyHandler = aiAnomaly.ServeHTTP
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
		if aiAlert != nil {
			alertHandler = aiAlert.ServeHTTP
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
		if aiAutomation != nil {
			automationHandler = aiAutomation.ServeHTTP
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
		if aiSearch != nil {
			searchHandler = aiSearch.ServeHTTP
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
		if aiDriveCoach != nil {
			driveCoachHandler = aiDriveCoach.ServeHTTP
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
		if aiSmartChargeSchedule != nil {
			smartChargeScheduleHandler = aiSmartChargeSchedule.ServeHTTP
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
		if aiBatteryHealth != nil {
			batteryHealthHandler = aiBatteryHealth.ServeHTTP
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
		if aiChargingCurveClustering != nil {
			chargingCurveClusteringHandler = aiChargingCurveClustering.ServeHTTP
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
		if aiCostForecastNarration != nil {
			costForecastNarrationHandler = aiCostForecastNarration.ServeHTTP
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
		if aiPeriodCompareNarration != nil {
			periodCompareNarrationHandler = aiPeriodCompareNarration.ServeHTTP
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
		if aiLifetimeStatsQA != nil {
			lifetimeStatsQAHandler = aiLifetimeStatsQA.ServeHTTP
		}
		r.Post("/analytics/lifetime/qa", g.Wrap("lifetime-stats-qa", lifetimeStatsQAHandler))

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
		if aiVampireDrainExplanation != nil {
			vampireDrainExplanationHandler = aiVampireDrainExplanation.ServeHTTP
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
		if aiPreheatPrecoolRecommender != nil {
			preheatPrecoolRecommenderHandler = aiPreheatPrecoolRecommender.ServeHTTP
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
		if aiCabinTemperatureImpactNarrative != nil {
			cabinTemperatureImpactNarrativeHandler = aiCabinTemperatureImpactNarrative.ServeHTTP
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
		if aiTirePressureTrendReasoning != nil {
			tirePressureTrendReasoningHandler = aiTirePressureTrendReasoning.ServeHTTP
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
		if aiAlertTuning != nil {
			alertTuningHandler = aiAlertTuning.ServeHTTP
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
		if aiInboxCategorize != nil {
			inboxCategorizationHandler = aiInboxCategorize.ServeHTTP
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
		if aiCrossRuleConflict != nil {
			crossRuleConflictHandler = aiCrossRuleConflict.ServeHTTP
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
		if aiAutoNameUnnamedLocations != nil {
			autoNameUnnamedLocationsHandler = aiAutoNameUnnamedLocations.ServeHTTP
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
		if aiSuggestNewGeofences != nil {
			suggestNewGeofencesHandler = aiSuggestNewGeofences.ServeHTTP
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
		if aiGeofenceAwareAutomation != nil {
			geofenceAwareAutomationHandler = aiGeofenceAwareAutomation.ServeHTTP
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
		if aiLearnedAnomalyBaselines != nil {
			learnedAnomalyBaselinesHandler = aiLearnedAnomalyBaselines.ServeHTTP
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
		if aiRangePrediction != nil {
			rangePredictionHandler = aiRangePrediction.ServeHTTP
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
		if aiMLChargingCurveClustering != nil {
			mlChargingCurveClusteringHandler = aiMLChargingCurveClustering.ServeHTTP
		}
		r.Post("/ml/charging-curves/cluster", g.Wrap("ml-charging-curve-clustering", mlChargingCurveClusteringHandler))

		// charging-diagnosis (Phase-50 / N4, slice 0018).
		var chargingDiagnosisHandler http.HandlerFunc = aiChargingDiagnosisStubHandler
		if aiChargingDiagnosis != nil {
			chargingDiagnosisHandler = aiChargingDiagnosis.ServeHTTP
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
		if aiRagHelp != nil {
			ragHelpHandler = aiRagHelp.ServeHTTP
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
		if aiDriveSearch != nil {
			driveSearchHandler = aiDriveSearch.ServeHTTP
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
		if aiSpeedProfileInsights != nil {
			speedProfileInsightsHandler = aiSpeedProfileInsights.ServeHTTP
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
		if aiRouteEfficiencySuggestions != nil {
			routeEfficiencySuggestionsHandler = aiRouteEfficiencySuggestions.ServeHTTP
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
		if aiAutoTripName != nil {
			autoTripNameHandler = aiAutoTripName.ServeHTTP
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
		if aiTripPlannerLLM != nil {
			tripPlannerLLMHandler = aiTripPlannerLLM.ServeHTTP
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
func userPrefsMiddleware(settingsRepo *database.SettingsRepo) func(http.Handler) http.Handler {
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
