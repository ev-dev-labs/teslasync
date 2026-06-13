// Pure, framework-free model for the withAiFeature shared surface — the native analogue of everything the web
// higher-order component derives (web/src/components/ai/withAiFeature.tsx). No Compose, no Android framework, no
// HTTP: every declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web source is the AI-Off Contract gate primitive (ADR-015): `withAiFeature(feature, Inner)` is a factory
// that (1) THROWS at construction for an unknown feature id (a typo is caught the first time the module is
// imported, not silently rendered as nothing forever), and (2) returns a component that reads
// `useAiEnabled(feature)` and renders `null` unless the feature is on, otherwise wrapping `Inner` in a marker
// element carrying `data-ai-feature="<id>"` plus a `data-testid` so the off-mode invariant walk can prove no AI
// surface leaks into the DOM when `ai_mode='off'`. `useAiEnabled` is FAIL-CLOSED (ADR-015 §I6): an unresolved
// settings query, `ai_mode === 'off'`, a missing `ai_features` map, or a flag that is not exactly `true` all
// yield `false`, the same verdict the backend `guard.Wrap` 404 reaches.
//
// Parity-with-honesty (Honesty Covenant #9 — documented, not silent): the web gate has exactly two render
// outcomes — open → the inner content, closed → nothing. It has NO loading / empty / error / stale / offline
// lifecycle of its own; the fail-closed gate collapses settings-loading, settings-error, off-mode, and
// feature-disabled into a single "render nothing". Modelling those generic data-states here would fabricate
// behaviour the web spec does not have (the same rationale the accepted AIChatbotIndicator / VisuallyHidden
// ports document). The surface's real outcomes are reproduced instead:
//   • [GateSurface.Hidden]  ← the gate is closed (off / unresolved / feature off) — web `withAiFeature` → null.
//   • [GateSurface.Visible] ← the gate is open — the inner content, wrapped in the parity marker.
// The "loading" dimension is captured honestly: while settings are unresolved the gate is fail-closed to Hidden,
// exactly as the web `useAiEnabled` returns `false` until settings resolve; "offline" / "stale" / "error" are the
// same fail-closed Hidden because the verdict derives only from the resolved AI-mode + per-feature opt-in.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/withAiFeature — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment and a non-identifier leaf are illegal in a package id), so the package intentionally
// diverges from the path — exactly as the sibling AIChatbotIndicator / VisuallyHidden surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations, and
// `ktlint:standard:filename` because the file mirrors the camelCase web source name (`withAiFeature`).
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.sharedsurfaces.withaifeature

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the one-shot `view.opened` event (P1/S11). It is the surface slug the
 * prompt mandates (`withAiFeature`) and carries no VIN, vehicle id, settings value, or generated text, so a
 * diagnostics line can never leak the operator's fleet state.
 */
const val WITH_AI_FEATURE_SLUG: String = "withAiFeature"

/**
 * The AI mode that disables every AI surface unconditionally (web `settings.ai_mode === 'off'`, ADR-015 §I1).
 * Any other mode (`local` / `cloud`) is "on"; an absent/unresolved mode is treated as off (fail-closed).
 */
const val AI_MODE_OFF: String = "off"

/** The stable, dot-namespaced diagnostics event emitted once when the surface first composes (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on the `view.opened` diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * The native mirror of the generated web AI feature registry (`@/ai/features`, itself generated from
 * `internal/ai/features/registry.go`): every known feature id → the `data-testid` the web `withAiFeature`
 * stamps on the marker element, resolved verbatim as `meta.uiTestIds[0] ?? "ai-feature-<id>"`. Keeping the set
 * here (rather than depending on a feature-view's copy) keeps this gate primitive self-contained and below the
 * feature layer it gates; a drift test pins the id count + sampled ids against the web source. Regenerate from
 * `web/src/ai/features.ts` when the registry changes.
 */
val AI_FEATURE_TEST_IDS: Map<String, String> =
    mapOf(
        "__redaction_bypass__" to "ai-feature-redaction-bypass",
        "__usage__" to "ai-feature-usage",
        "ai-provider-health" to "ai-feature-ai-provider-health",
        "alert-tuning-suggestions" to "ai-feature-alert-tuning-suggestions-root",
        "anomaly-explanations" to "ai-feature-anomaly-explanations-root",
        "auto-name-unnamed-locations" to "ai-feature-auto-name-unnamed-locations-root",
        "auto-trip-naming" to "ai-feature-auto-trip-naming-root",
        "battery-health-forecast-narrative" to "ai-feature-battery-health-forecast-narrative-root",
        "cabin-temperature-impact-narrative" to "ai-feature-cabin-temperature-impact-narrative-root",
        "charging-curve-fingerprint-clustering" to "ai-feature-charging-curve-fingerprint-clustering-root",
        "charging-diagnosis" to "ai-feature-charging-diagnosis-root",
        "chatbot-llm" to "ai-feature-chatbot-llm-root",
        "cost-forecast-narration" to "ai-feature-cost-forecast-narration-root",
        "cross-rule-conflict-detection" to "ai-feature-cross-rule-conflict-detection-root",
        "data-repair-suggestions" to "ai-feature-data-repair-suggestions-root",
        "digest-narration" to "ai-feature-digest-narration-root",
        "drive-coaching" to "ai-feature-drive-coaching-root",
        "feedback-queue-triage" to "ai-feature-feedback-queue-triage-root",
        "geofence-aware-automation-suggestions" to "ai-feature-geofence-aware-automation-suggestions-root",
        "inbox-auto-categorization" to "ai-feature-inbox-auto-categorization-root",
        "incident-timeline-summarizer" to "ai-feature-incident-timeline-summarizer-root",
        "learned-per-vehicle-anomaly-baselines" to "ai-feature-learned-per-vehicle-anomaly-baselines-root",
        "lifetime-stats-qa" to "ai-feature-lifetime-stats-qa-root",
        "log-trace-summarization" to "ai-feature-log-trace-summarization-root",
        "ml-charging-curve-clustering" to "ai-feature-ml-charging-curve-clustering-root",
        "mqtt-sse-inspector-explanations" to "ai-feature-mqtt-sse-inspector-explanations-root",
        "nl-alert-builder" to "ai-feature-nl-alert-builder-root",
        "nl-automation-builder" to "ai-feature-nl-automation-builder-root",
        "nl-dashboard-composer" to "ai-feature-nl-dashboard-composer-root",
        "nl-drive-search-replay" to "ai-feature-nl-drive-search-replay-root",
        "nl-grafana-panel" to "ai-feature-nl-grafana-panel-root",
        "nl-search" to "ai-feature-nl-search-root",
        "nl-sql-playground" to "ai-feature-nl-sql-playground-root",
        "period-compare-narration" to "ai-feature-period-compare-narration-root",
        "pii-redaction-shared-exports" to "ai-feature-pii-redaction-shared-exports-root",
        "predictive-maintenance" to "ai-feature-predictive-maintenance-root",
        "preheat-precool-recommender" to "ai-feature-preheat-precool-recommender-root",
        "quiet-hours-suggestion" to "ai-feature-quiet-hours-suggestion-root",
        "rag-help" to "ai-feature-rag-help-root",
        "range-prediction-model" to "ai-feature-range-prediction-model-root",
        "route-efficiency-suggestions" to "ai-feature-route-efficiency-suggestions-root",
        "safety-setting-explainer" to "ai-feature-safety-setting-explainer-root",
        "signal-explorer-nl-filter" to "ai-feature-signal-explorer-nl-filter-root",
        "smart-charge-schedule-suggestion" to "ai-feature-smart-charge-schedule-suggestion-root",
        "software-update-changelog-summarizer" to "ai-feature-software-update-changelog-summarizer-root",
        "speed-profile-insights" to "ai-feature-speed-profile-insights-root",
        "state-machine-debugger-narrator" to "ai-feature-state-machine-debugger-narrator-root",
        "suggest-new-geofences" to "ai-feature-suggest-new-geofences-root",
        "tco-narration" to "ai-feature-tco-narration-root",
        "tire-pressure-trend-reasoning" to "ai-feature-tire-pressure-trend-reasoning-root",
        "trip-planner-llm-agent" to "ai-feature-trip-planner-llm-agent-root",
        "trip-postcard-share-card-image-generation" to "ai-feature-trip-postcard-share-card-image-generation-root",
        "vampire-drain-explanation" to "ai-feature-vampire-drain-explanation-root",
        "vehicle-paint-preview" to "ai-feature-vehicle-paint-preview-root",
        "voice-mode" to "ai-feature-voice-mode-root",
        "watch-face-nl-response" to "ai-feature-watch-face-nl-response-root",
        "yir-narration" to "ai-feature-yir-narration-root",
    )

/**
 * Whether [feature] is a registered AI feature id (the native mirror of the web `isKnownAiFeature` /
 * `AI_FEATURES[feature]` membership check). The fail-closed [evaluateAiEnabled] gate and the fail-fast
 * [requireKnownAiFeature] construction guard both consult this set.
 */
fun isKnownAiFeature(feature: String): Boolean = AI_FEATURE_TEST_IDS.containsKey(feature)

/**
 * The marker test tag the surface stamps on the wrapper for [feature] — the native analogue of the web
 * `data-testid={meta.uiTestIds[0] ?? \`ai-feature-${feature}\`}`. Known ids resolve to the same string the web
 * registry emits; an unregistered id falls back to the `ai-feature-<id>` form (the gate never renders an
 * unregistered id — [requireKnownAiFeature] throws first — but the fallback keeps this helper total).
 */
fun resolveAiFeatureTestId(feature: String): String = AI_FEATURE_TEST_IDS[feature] ?: "ai-feature-$feature"

/**
 * The developer-facing message thrown for an unknown feature id — a parity port of the web `withAiFeature`
 * construction error (the same instruction to add the id to the Go registry and regenerate). It is a programmer
 * error string, not user-facing copy, so it is intentionally not routed through the i18n catalog (the web throws
 * a raw `Error` string too).
 */
fun unknownAiFeatureMessage(feature: String): String =
    "withAiFeature: unknown AI feature id \"$feature\". " +
        "Add it to internal/ai/features/registry.go and run `make generate`."

/**
 * The native analogue of the web `withAiFeature` construction-time guard: throws [IllegalArgumentException] for
 * an unregistered [feature] so a typo fails fast on first composition rather than silently rendering nothing
 * forever. Known ids pass through. Kept pure so the guard is unit-tested off-device.
 */
fun requireKnownAiFeature(feature: String) {
    require(isKnownAiFeature(feature)) { unknownAiFeatureMessage(feature) }
}

/**
 * Pure port of the web `useAiEnabled(feature)` predicate (web/src/hooks/useAiEnabled.ts) — the "adapter" a
 * host's production [WithAiFeatureSource] uses to fold the cached settings document into the single gate boolean
 * the surface binds. FAIL-CLOSED, matching the web hook (and the backend `guard.Wrap` 404) so backend and native
 * reach the same verdict for the same inputs:
 *
 *   - [feature] is not a registered id → `false` (mirrors web `if (!AI_FEATURES[feature]) return false`).
 *   - [aiMode] is `null` (settings not yet resolved / mode absent) → `false` (fail-closed while loading).
 *   - [aiMode] equals [AI_MODE_OFF] → `false` (off mode blocks every AI surface unconditionally).
 *   - [featureFlag] is `null`/`false` (the `ai_features` map is absent or the flag is not opted in) → `false`.
 *   - a non-off [aiMode] AND [featureFlag] exactly `true` → `true`.
 *
 * @param feature the AI feature id the gate is bound to (web `useAiEnabled(feature)` argument).
 * @param aiMode the resolved `settings.ai_mode` (`null` when settings are unresolved or the mode is absent).
 * @param featureFlag the resolved `settings.ai_features[feature]` opt-in (`null` when absent).
 */
fun evaluateAiEnabled(
    feature: String,
    aiMode: String?,
    featureFlag: Boolean?,
): Boolean = isKnownAiFeature(feature) && aiMode != null && aiMode != AI_MODE_OFF && featureFlag == true

/**
 * The immutable surface state the [WithAiFeatureViewModel] exposes. It carries only the resolved AI-feature gate
 * (web `useAiEnabled(feature)` via the `withAiFeature` HOC); the inner content is supplied by the caller, so
 * there is nothing else to project.
 *
 * @property gateEnabled whether the bound feature is enabled end-to-end (fail-closed default `false`, so the
 *   surface is hidden until the gate resolves — web's unresolved-settings behaviour).
 */
data class WithAiFeatureState(
    val gateEnabled: Boolean = false,
)

/**
 * The render-ready classification of [WithAiFeatureState] — a closed, mutually-exclusive set the view switches
 * on, so every branch is exhaustively covered and unit-tested off-device. It maps the web `withAiFeature` gate
 * onto the surface's two real outcomes (see the file header for the parity-with-honesty rationale).
 */
sealed interface GateSurface {
    /** The AI feature is gated off / unresolved — the whole surface collapses (web `withAiFeature` → `null`). */
    data object Hidden : GateSurface

    /** The AI feature is enabled — render the wrapped inner content (the web `Inner`, inside the marker). */
    data object Visible : GateSurface
}

/**
 * Selects the render-ready [GateSurface] for [state]. Pure (no Compose/clock): an enabled gate yields the
 * visible content, every other case (disabled / unresolved / off) yields [GateSurface.Hidden], mirroring the
 * fail-closed web `withAiFeature` gate.
 */
fun classifyGate(state: WithAiFeatureState): GateSurface = if (state.gateEnabled) GateSurface.Visible else GateSurface.Hidden

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [WITH_AI_FEATURE_SLUG] (P1/S11) —
 * never a settings value, the bound feature, a vehicle id, or any generated text, so a diagnostics line can
 * never leak fleet state. Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel
 * calls it once per surface open.
 */
fun recordWithAiFeatureOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to WITH_AI_FEATURE_SLUG))
}
