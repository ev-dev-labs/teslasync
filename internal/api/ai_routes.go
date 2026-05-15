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
