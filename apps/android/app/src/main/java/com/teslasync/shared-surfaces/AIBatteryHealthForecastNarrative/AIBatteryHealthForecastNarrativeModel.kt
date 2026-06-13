// Pure, framework-free model + classifier + diagnostics for the AIBatteryHealthForecastNarrative shared
// surface — the native analogue of everything web/src/components/ai/AIBatteryHealthForecastNarrative.tsx (and
// the AIFeatureCard / AiOutputPanel scaffold it composes) derives before returning JSX. No Compose, no Android,
// no HTTP: every declaration here is exercised off-device in the :android:testReleaseUnitTest gate (P3
// acceptance: adapter + per-state + a11y label tests), keeping the composable a thin render layer.
//
// AIBatteryHealthForecastNarrative is the optional Helix narrator on the Battery Health page. The web component
// is gated by withAiFeature('battery-health-forecast-narrative', …) — hidden when ai_mode='off' or the feature
// toggle is disabled — and, once shown, renders an AIFeatureCard whose Narrate button POSTs to
// /ai/battery/health/narrate and streams the explanation into an AiOutputPanel. It never replaces the
// deterministic battery-health charts/metrics/insights; it only narrates the same numbers. Its data sources are
// the web `useTranslation` (→ the P1/S10 i18n facade, `stringResource`) and `useAiStream` (the SSE lifecycle).
//
// The stream is host-controlled here exactly as the sibling AIRestorePanel is prop-controlled: the surface
// performs no HTTP (engineering rule: no direct fetch from a view; bind via the shared P1/S8 state holder).
// The host Battery-Health screen owns the `useAiStream` analogue (a state holder that POSTs the SSE and exposes
// its lifecycle) and hands this surface an [AiNarrativeStreamState] snapshot plus an `onNarrate` start action —
// the native decomposition of the web `AIFeatureStream { state, text, error, start }` the card consumes. The
// view binds to that snapshot; it never opens a socket itself.
//
// [AiStreamPhase] mirrors the web `AiStreamState` subset this surface can reach (idle / streaming / done /
// error); the web `paused-confirm` state is unreachable because the battery narrator runs no tools and issues no
// confirmation requests. [aiNarrativeSurfaceFor] is the per-state classifier the composable switches on,
// reproducing the AiOutputPanel branches (open-but-empty → thinking, text → narrative, error → error) plus the
// connectivity-driven offline surface and the idle/ready presentation. [onlineFromLifecycle] binds the shared
// P1/S8 cache-then-network [UiState] freshness onto the surface's connectivity flag, so a stale/offline cached
// value (the web "last known" lifecycle) resolves to the offline surface with its cached narrative preserved.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/AIBatteryHealthForecastNarrative — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package identifier (a hyphen and PascalCase segments are illegal), so the package
// intentionally diverges from the path — exactly as the sibling feature-views surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aibatteryhealthforecastnarrative

import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger

/** Registry + diagnostics identifiers for the surface (P1/S11). */
object AIBatteryHealthForecastNarrativeRegistration {
    /** The web gate `data-testid="ai-feature-battery-health-forecast-narrative-root"`. */
    const val ID: String = "ai-feature-battery-health-forecast-narrative-root"

    /** The AI feature id (web `withAiFeature('battery-health-forecast-narrative', …)`), generated from registry.go. */
    const val FEATURE_ID: String = "battery-health-forecast-narrative"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AIBatteryHealthForecastNarrative"
}

/**
 * The web `t(key, default)` fallback strings the InnerSection supplies inline. The keys exist in the generated
 * i18n catalog (`translation_battery_aiNarrative_*`), so the composable shows the localized `stringResource`;
 * the English source values below are reproduced for the off-device contract test (mirroring the sibling
 * AIRestorePanel defaults).
 */
object AIBatteryHealthForecastNarrativeDefaults {
    /** Web `t('battery.aiNarrative.title', 'Explain the battery health forecast')`. */
    const val TITLE: String = "Explain the battery health forecast"

    /** Web `t('battery.aiNarrative.description', …)` — the long privacy-grounded explanation (em dash = U+2014). */
    const val DESCRIPTION: String =
        "Ask Helix to explain which charging habits and risk factors drive your deterministic " +
            "battery-health forecast. The narrator never changes the forecast \u2014 it grounds every " +
            "sentence in the same numbers the chart below renders."

    /** Web `t('battery.aiNarrative.generateButton', 'Narrate forecast')`. */
    const val BUTTON_LABEL: String = "Narrate forecast"

    /** Web `t('battery.aiNarrative.badge', 'Helix')`. */
    const val BADGE: String = "Helix"

    /** The web `useAiStream({ url: '/ai/battery/health/narrate' })` endpoint the host's state holder POSTs to. */
    const val NARRATE_URL: String = "/ai/battery/health/narrate"
}

/** Android resource name for the web `battery.aiNarrative.title` key (catalog presence asserted in tests). */
const val KEY_TITLE: String = "translation_battery_aiNarrative_title"

/** Android resource name for the web `battery.aiNarrative.description` key. */
const val KEY_DESCRIPTION: String = "translation_battery_aiNarrative_description"

/** Android resource name for the web `battery.aiNarrative.generateButton` key. */
const val KEY_BUTTON_LABEL: String = "translation_battery_aiNarrative_generateButton"

/** Android resource name for the web `battery.aiNarrative.badge` key. */
const val KEY_BADGE: String = "translation_battery_aiNarrative_badge"

/** Shared-state resource names the surface uses for its lifecycle chrome (all present in the catalog). */
object AIBatteryHealthForecastNarrativeStateKeys {
    /** Thinking affordance label (web AIThinkingIndicator) → `translation_common_loading`. */
    const val LOADING: String = "translation_common_loading"

    /** Offline chip label → `translation_common_offline`. */
    const val OFFLINE: String = "translation_common_offline"

    /** Offline detail copy → `translation_error_network_offlineDetail`. */
    const val OFFLINE_DETAIL: String = "translation_error_network_offlineDetail"

    /** Retry affordance label → `translation_common_retry`. */
    const val RETRY: String = "translation_common_retry"

    /** Error title (web AiOutputPanel error branch) → `translation_error_serverError_title`. */
    const val ERROR_TITLE: String = "translation_error_serverError_title"

    /** Error message → `translation_error_serverError_message`. */
    const val ERROR_MESSAGE: String = "translation_error_serverError_message"
}

/**
 * The user-facing stream lifecycle, the native mirror of the web `AiStreamState`. Only the four states the
 * battery narrator can reach are modeled — the web `paused-confirm` is unreachable here (the narrator runs no
 * tools and never issues a confirmation request), so reproducing it would be dead state.
 */
enum class AiStreamPhase { Idle, Streaming, Done, Error }

/**
 * The reactive snapshot of the host's `useAiStream` analogue the view binds to — the native decomposition of the
 * web `AIFeatureStream { state, text, error }` (the `start` action is the separate `onNarrate` callback). The
 * host's P1/S8 state holder exposes a stream of this; the surface renders it and never performs HTTP itself.
 *
 * @property phase the current lifecycle ([AiStreamPhase]).
 * @property text the accumulated `delta.text` narrative (web `stream.text`), empty until the first token.
 * @property error the terminal technical error code if [phase] is [AiStreamPhase.Error] (web `stream.error`);
 *   surfaced for diagnostics only — the view shows the localized server-error copy, never this raw code.
 */
data class AiNarrativeStreamState(
    val phase: AiStreamPhase = AiStreamPhase.Idle,
    val text: String = "",
    val error: String? = null,
) {
    /** True once at least one narrative token has arrived (web `text.length > 0`). */
    val hasText: Boolean get() = text.isNotEmpty()
}

/**
 * The top-level surface the composable switches on. Each maps to a mandated P3 state and always renders a
 * non-blank region:
 *  - [Offline] — no connectivity: the Narrate button is disabled, an offline chip shows, and any cached
 *    narrative stays visible (the web "cached value + offline chip" lifecycle).
 *  - [Error] — the stream ended in error: the localized server-error panel with a retry affordance.
 *  - [Thinking] — the SSE is open but no token has arrived: the loading/thinking affordance
 *    (web AiOutputPanel's `state==='streaming' && text===''` → AIThinkingIndicator branch).
 *  - [Narrative] — streamed or finished narrative text is present: the prose output (web `whitespace-pre-wrap`).
 *  - [Ready] — idle with nothing generated yet: the card header + description + Narrate button, no output box
 *    (web AiOutputPanel returns null), i.e. the friendly empty/ready presentation.
 */
enum class AiNarrativeSurface { Offline, Error, Thinking, Narrative, Ready }

/**
 * The web `haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0`: the Narrate action needs a
 * resolved active vehicle, because the backend handler validates `vehicle_id > 0`. A null/zero/negative id keeps
 * the button disabled until the host resolves the active vehicle.
 */
fun canNarrate(vehicleId: Long?): Boolean = vehicleId != null && vehicleId > 0L

/**
 * Classifies the surface from connectivity + the stream snapshot — the heart of the AiOutputPanel parity, with
 * the offline lifecycle layered on top. Offline wins first (connectivity is the most fundamental gate, and a
 * cached narrative is still shown beneath the chip); then a hard stream error; then the open-but-empty thinking
 * affordance; then any present narrative text (streaming or done); otherwise the idle/ready presentation.
 */
fun aiNarrativeSurfaceFor(
    online: Boolean,
    phase: AiStreamPhase,
    hasText: Boolean,
): AiNarrativeSurface =
    when {
        !online -> AiNarrativeSurface.Offline
        phase == AiStreamPhase.Error -> AiNarrativeSurface.Error
        phase == AiStreamPhase.Streaming && !hasText -> AiNarrativeSurface.Thinking
        hasText -> AiNarrativeSurface.Narrative
        else -> AiNarrativeSurface.Ready
    }

/**
 * The Narrate button's enabled state — the web `disabled = !canStart || isStreaming`, extended with the
 * connectivity gate: the action is available only when online, an active vehicle is resolved, and no stream is
 * already in flight (double-submit protection, mirroring useAiStream's `runningRef` coalescing).
 */
fun narrativeButtonEnabled(
    online: Boolean,
    canNarrate: Boolean,
    phase: AiStreamPhase,
): Boolean = online && canNarrate && phase != AiStreamPhase.Streaming

/**
 * Binds the shared P1/S8 cache-then-network [UiState] freshness onto the surface's connectivity flag: a
 * stale/offline cached value (web "last known" — [UiState.isOffline] is `stale && data != null`) resolves to
 * offline so the surface shows the cached narrative with the offline chip, while a fresh value is online. This
 * is the seam a host wires when it derives connectivity from a shared store rather than a raw network probe.
 */
fun onlineFromLifecycle(lifecycle: UiState<*>): Boolean = !lifecycle.isOffline

/**
 * The localized lifecycle-chrome labels the output region folds into its TalkBack announcement. Resolved once by
 * the composable from the P1/S10 catalog and passed as a single value so the pure announcement stays small and
 * testable.
 */
data class NarrativeOutputLabels(
    val loading: String,
    val errorTitle: String,
    val errorMessage: String,
    val offline: String,
    val offlineDetail: String,
)

/**
 * The output region's merged TalkBack content description per surface, so the streamed/lifecycle output is
 * announced as one coherent message (the web AiOutputPanel's `role`/`aria-live` semantics). [AiNarrativeSurface.Ready]
 * has no output box and folds into the header announcement, so it returns an empty string.
 */
fun narrativeOutputAnnouncement(
    surface: AiNarrativeSurface,
    text: String,
    labels: NarrativeOutputLabels,
): String =
    when (surface) {
        AiNarrativeSurface.Thinking -> labels.loading
        AiNarrativeSurface.Narrative -> text
        AiNarrativeSurface.Error -> "${labels.errorTitle}. ${labels.errorMessage}"
        AiNarrativeSurface.Offline ->
            if (text.isBlank()) "${labels.offline}. ${labels.offlineDetail}" else "${labels.offline}. $text"
        AiNarrativeSurface.Ready -> ""
    }

/**
 * The host gate — the native analogue of the web `withAiFeature` visibility contract (§ADR-015): the surface is
 * offered only when AI is in a non-off mode and the per-feature toggle is enabled. The surface itself, once
 * mounted, always renders its presentation (web parity: InnerSection is the always-rendered body), so this
 * projection lives here for hosts + tests rather than being re-read inside the view.
 */
fun shouldRender(
    aiModeOff: Boolean,
    featureEnabled: Boolean,
): Boolean = !aiModeOff && featureEnabled

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AIBatteryHealthForecastNarrativeRegistration.SLUG]
 * (P1/S11). Carries only the slug — never a vehicle id or any narrative text — so a diagnostics line can never
 * leak fleet context. Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls
 * it from its first-composition effect.
 */
fun recordAIBatteryHealthForecastNarrativeOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AIBatteryHealthForecastNarrativeRegistration.SLUG))
}
