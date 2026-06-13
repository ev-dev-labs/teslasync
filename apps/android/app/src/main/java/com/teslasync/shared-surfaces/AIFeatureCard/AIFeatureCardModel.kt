// Pure, framework-free model + projection for the AIFeatureCard shared surface — the native analogue of
// everything web/src/components/ai/AIFeatureCard.tsx (and the AiOutputPanel / AIThinkingIndicator scaffold it
// composes) derives before returning JSX. No Compose, no Android, no HTTP lives here, so every declaration is
// exercised off-device by the :android:testReleaseUnitTest gate and the composable stays a thin render layer
// (ADR-002).
//
// AIFeatureCard is the reusable scaffold every "header + Ask-Helix button + streamed output" AI feature is built
// on: a GlassPanel wrapping a branded header (HelixMark + per-feature title + the cyan "Helix" badge +
// description + optional empty hint), an optional prompt-input slot, the universal "Ask Helix" action (its
// visible label flips to "Helix is thinking…" while streaming, its aria-label carries the per-feature verb), an
// optional domain-specific children slot, and the AiOutputPanel. The per-feature title/description/buttonLabel
// are supplied by the caller already-translated (web parity — the card does NOT i18n those, the namespace is
// feature-specific); the card's OWN i18n is only the Helix-brand chrome (badge / Ask Helix / thinking / error)
// plus the lifecycle-chrome the prompt's mandated offline + stale states need.
//
// This file owns the parity-critical pieces that have nothing to do with Compose:
//   - the i18n by-name facade (the [StringResolver] seam) + the card's brand/chrome keys (web `t(key, …)`),
//   - the native [AiStreamPhase] (mirror of the web `AiStreamState` union) + the [AiFeatureStream] slice the
//     card reads (the native `AIFeatureStream { state, text, error }`),
//   - the action label / accessible-name / enabled rules (web's "Ask Helix" CTA + `aria-label` + `disabled`),
//   - the [AiOutputSurface] projection covering every state the prompt mandates
//     (loading / empty / error / stale / offline, plus content), reproducing the AiOutputPanel branches,
//   - and the PII-safe `view.opened` diagnostic (P1/S11).
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed because the mandated surface
// directory (com/teslasync/shared-surfaces/AIFeatureCard — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package identifier and the file hosts several co-located declarations, exactly as the sibling
// surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.sharedsurfaces.aifeaturecard

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical metadata for the surface. [SLUG] is the diagnostics surface slug emitted with the one-shot
 * `view.opened` event (P1/S11). AIFeatureCard is a presentational scaffold (web `AIFeatureCard`, not wrapped by
 * `withAiFeature` itself — each call site keeps its own per-feature gate), so it carries no feature-gate id.
 */
object AIFeatureCardRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AIFeatureCard"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AIFeatureCardRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the host view calls it from the
 * first-composition effect. It carries only the static slug, so a diagnostics line can never leak a feature id,
 * prompt, or any streamed value (ADR-016).
 */
fun recordAIFeatureCardViewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AIFeatureCardRegistration.SLUG))
}

// ── i18n facade (web `t(key, fallback)`) ─────────────────────────────────────────────────────────────────────

/** A by-name string resolver — the P1/S10 i18n facade in production, a map/fallback in tests (web `t`). */
typealias StringResolver = (key: String, fallback: String) -> String

private val NON_IDENTIFIER = Regex("[^A-Za-z0-9_]")

/**
 * Folds a dotted i18next key into the generated Android catalog resource name (web `a.b.c` → `translation_a_b_c`),
 * matching apps/shared/i18n/generators/gen-i18n.ts `androidName`. The production resolver looks this up by name
 * and falls back to the web English when the key is absent.
 */
fun foldCatalogKey(dottedKey: String): String = "translation_" + dottedKey.replace(NON_IDENTIFIER, "_").trim('_')

/** A resolver that always returns the web English fallback — used by @Preview and the off-device unit tests. */
val FallbackResolver: StringResolver = { _, fallback -> fallback }

/**
 * The card's own i18n keys + their exact web English fallbacks. The `helix.*` brand keys carry the same fallback
 * the shared web scaffold (`AIFeatureCard` / `AiOutputPanel` / `AIThinkingIndicator`) renders when the key is
 * absent from the catalog, so the rendered English is identical either way. The lifecycle-chrome keys
 * (`common.*`, `error.network.*`) ARE present in the generated catalog (asserted in the model test), so the
 * offline + stale + retry affordances localize.
 */
internal object AIFeatureCardKeys {
    const val BADGE = "helix.badge"
    const val BADGE_EN = "Helix"

    const val BADGE_ARIA = "helix.ariaLabel"
    const val BADGE_ARIA_EN = "Helix"

    const val BADGE_TOOLTIP = "helix.tooltip"
    const val BADGE_TOOLTIP_EN =
        "Helix is your AI assistant. It generates responses using your redacted fleet context."

    const val ASK_HELIX = "helix.askHelix"
    const val ASK_HELIX_EN = "Ask Helix"

    const val THINKING = "helix.thinking"
    const val THINKING_EN = "Helix is thinking\u2026"

    const val REFRESHING = "helix.refreshing"
    const val REFRESHING_EN = "Helix is refreshing\u2026"

    const val ERROR_LABEL = "helix.errorLabel"
    const val ERROR_LABEL_EN = "Helix error:"

    const val ERROR_UNKNOWN = "ai.common.errorUnknown"
    const val ERROR_UNKNOWN_EN = "unknown"

    const val EMPTY_OUTPUT = "helix.noOutput"
    const val EMPTY_OUTPUT_EN = "No response generated."

    const val OFFLINE = "common.offline"
    const val OFFLINE_EN = "Offline"

    const val OFFLINE_DETAIL = "error.network.offlineDetail"
    const val OFFLINE_DETAIL_EN = "We'll retry automatically when your connection returns."

    const val RETRY = "common.retry"
    const val RETRY_EN = "Retry"
}

/** The fully-resolved Helix-brand + lifecycle-chrome strings the composable paints (resolved off-device). */
@Suppress("LongParameterList")
data class AIFeatureCardChrome(
    val badge: String,
    val badgeAria: String,
    val badgeTooltip: String,
    val askHelix: String,
    val thinking: String,
    val refreshing: String,
    val errorLabel: String,
    val errorUnknown: String,
    val emptyOutput: String,
    val offline: String,
    val offlineDetail: String,
    val retry: String,
)

/** Resolves every chrome label through [resolve], folding the web `t(key, fallback)` calls into one value. */
fun aiFeatureCardChrome(resolve: StringResolver): AIFeatureCardChrome =
    AIFeatureCardChrome(
        badge = resolve(AIFeatureCardKeys.BADGE, AIFeatureCardKeys.BADGE_EN),
        badgeAria = resolve(AIFeatureCardKeys.BADGE_ARIA, AIFeatureCardKeys.BADGE_ARIA_EN),
        badgeTooltip = resolve(AIFeatureCardKeys.BADGE_TOOLTIP, AIFeatureCardKeys.BADGE_TOOLTIP_EN),
        askHelix = resolve(AIFeatureCardKeys.ASK_HELIX, AIFeatureCardKeys.ASK_HELIX_EN),
        thinking = resolve(AIFeatureCardKeys.THINKING, AIFeatureCardKeys.THINKING_EN),
        refreshing = resolve(AIFeatureCardKeys.REFRESHING, AIFeatureCardKeys.REFRESHING_EN),
        errorLabel = resolve(AIFeatureCardKeys.ERROR_LABEL, AIFeatureCardKeys.ERROR_LABEL_EN),
        errorUnknown = resolve(AIFeatureCardKeys.ERROR_UNKNOWN, AIFeatureCardKeys.ERROR_UNKNOWN_EN),
        emptyOutput = resolve(AIFeatureCardKeys.EMPTY_OUTPUT, AIFeatureCardKeys.EMPTY_OUTPUT_EN),
        offline = resolve(AIFeatureCardKeys.OFFLINE, AIFeatureCardKeys.OFFLINE_EN),
        offlineDetail = resolve(AIFeatureCardKeys.OFFLINE_DETAIL, AIFeatureCardKeys.OFFLINE_DETAIL_EN),
        retry = resolve(AIFeatureCardKeys.RETRY, AIFeatureCardKeys.RETRY_EN),
    )

// ── Action button (web AIFeatureCard "Ask Helix" CTA) ────────────────────────────────────────────────────────

/**
 * The action button's accessible name — the native mirror of the web AIFeatureCard `aria-label`
 * (`"${askHelix} · ${buttonLabel}"`), so TalkBack announces the contextual per-feature verb, not just
 * "Ask Helix". [buttonLabel] is the caller-supplied, already-translated per-feature verb (web `buttonLabel`).
 */
fun actionContentDescription(
    askHelix: String,
    buttonLabel: String,
): String = "$askHelix \u00b7 $buttonLabel"

/**
 * The action button's visible label — "Helix is thinking…" while the stream is in flight, the universal
 * "Ask Helix" otherwise (web `isStreaming ? <AIThinkingDots/> : askHelixLabel`).
 */
fun actionLabel(
    phase: AiStreamPhase,
    askHelix: String,
    thinking: String,
): String = if (phase == AiStreamPhase.Streaming) thinking else askHelix

/**
 * Whether the action button is tappable — the web `disabled = !canStart || isStreaming`, extended with the
 * connectivity gate the prompt's offline state requires. Available only when the feature has its inputs
 * ([canStart]), the device is [online], and no stream is already in flight.
 */
fun actionEnabled(
    canStart: Boolean,
    online: Boolean,
    phase: AiStreamPhase,
): Boolean = canStart && online && phase != AiStreamPhase.Streaming

// ── Layout (web AIFeatureCard buttonPlacement / inputSlot) ────────────────────────────────────────────────────

/** Where the action button sits relative to the header — web `buttonPlacement: 'inline' | 'below'`. */
enum class ButtonPlacement { Inline, Below }

/**
 * Coerces the placement to [ButtonPlacement.Below] when an input slot is present — placing a button above an
 * input below is never the intended layout, so the web card coerces it and we mirror that safety net.
 */
fun effectivePlacement(
    placement: ButtonPlacement,
    hasInputSlot: Boolean,
): ButtonPlacement = if (hasInputSlot) ButtonPlacement.Below else placement

// ── AI stream lifecycle (native mirror of web `AiStreamState` + the `AIFeatureStream` slice) ─────────────────

/**
 * The lifecycle of the stream the card observes — the native mirror of the web `AiStreamState` union
 * (`idle | streaming | paused-confirm | done | error`). [PausedConfirm] is retained (unlike the single-feature
 * battery narrator) because the generic scaffold is consumed by tool-running features (e.g. the web
 * AICrossRuleConflictDetection) that can reach it.
 */
enum class AiStreamPhase { Idle, Streaming, PausedConfirm, Done, Error }

/**
 * The narrow slice of the host's `useAiStream` result the card reads — the native `AIFeatureStream`. The host's
 * P1/S8 state holder exposes a stream of this; the card renders it and never performs HTTP itself.
 *
 * @property phase the current lifecycle ([AiStreamPhase]).
 * @property text the accumulated `delta.text` payload (web `stream.text`), empty until the first token.
 * @property error the terminal error message when [phase] is [AiStreamPhase.Error] (web `stream.error`).
 */
data class AiFeatureStream(
    val phase: AiStreamPhase = AiStreamPhase.Idle,
    val text: String = "",
    val error: String? = null,
) {
    /** True once at least one token has arrived (web `text.length > 0`). */
    val hasText: Boolean get() = text.isNotEmpty()
}

// ── Output-panel projection (every state the prompt mandates) ─────────────────────────────────────────────────

/**
 * The mutually-exclusive output region the composable renders — the AiOutputPanel branches plus the prompt's
 * mandated offline + stale overlays. Each always renders a non-blank region (or, for [Hidden], no output box at
 * all — the card header + description + action is itself the friendly "ready" presentation, not a blank box):
 *  - [Offline] — no connectivity: the action is disabled, an offline chip shows, and any last streamed text
 *    stays visible (the prompt's "cached value + offline chip").
 *  - [Error] — the stream ended in error: the inline "Helix error" panel with a retry affordance.
 *  - [Thinking] — the stream is open but no token has arrived: the loading/thinking affordance
 *    (web AiOutputPanel's `text==='' && state==='streaming'` → AIThinkingIndicator branch).
 *  - [Stale] — streaming a refresh over previously-streamed text: a stale chip above the last-known text
 *    (the prompt's "stale chip + auto-refresh"; web shows the accumulating text, we flag it stale).
 *  - [Content] — streamed or finished text is present: the prose output (web `whitespace-pre-wrap`).
 *  - [Hidden] — idle with nothing generated: web AiOutputPanel returns `null`, so no output box renders.
 */
enum class AiOutputSurface { Hidden, Thinking, Content, Error, Stale, Offline }

/**
 * Classifies the output region from connectivity + the stream phase + whether text has arrived — the heart of
 * the AiOutputPanel parity, with the offline/stale overlays layered on top. Offline wins first (connectivity is
 * the most fundamental gate, and any last text is still shown beneath the chip); then a hard stream error; then
 * streaming-over-last-text (stale) vs streaming-while-empty (thinking); then any present text; then a finished
 * stream that produced no text (web still renders an empty panel for `state==='done'`); otherwise nothing.
 */
fun aiOutputSurfaceFor(
    online: Boolean,
    phase: AiStreamPhase,
    hasText: Boolean,
): AiOutputSurface =
    when {
        !online -> AiOutputSurface.Offline
        phase == AiStreamPhase.Error -> AiOutputSurface.Error
        phase == AiStreamPhase.Streaming && hasText -> AiOutputSurface.Stale
        phase == AiStreamPhase.Streaming -> AiOutputSurface.Thinking
        hasText -> AiOutputSurface.Content
        phase == AiStreamPhase.Done -> AiOutputSurface.Content
        else -> AiOutputSurface.Hidden
    }

/**
 * The immutable snapshot the composable paints. [canStart] mirrors the web `canStart` prop; [actionEnabled] is
 * the web `!disabled`; [busy] flips the button label to "thinking" while streaming (web `isStreaming`). The last
 * streamed [text] is retained across refresh/offline so it is never blanked — it is flagged [stale], never
 * hidden.
 */
@Suppress("LongParameterList")
data class AiFeatureCardSnapshot(
    val surface: AiOutputSurface,
    val phase: AiStreamPhase,
    val text: String,
    val error: String?,
    val canStart: Boolean,
    val actionEnabled: Boolean,
    val busy: Boolean,
    val online: Boolean,
    val stale: Boolean,
)

/**
 * Projects the host stream snapshot + the feature's `canStart` + connectivity onto an [AiFeatureCardSnapshot] —
 * the single, side-effect-free place the prompt's six output states are derived, so the composable only paints.
 */
fun projectAiFeatureCard(
    stream: AiFeatureStream,
    canStart: Boolean,
    online: Boolean,
): AiFeatureCardSnapshot {
    val surface = aiOutputSurfaceFor(online, stream.phase, stream.hasText)
    return AiFeatureCardSnapshot(
        surface = surface,
        phase = stream.phase,
        text = stream.text,
        error = stream.error,
        canStart = canStart,
        actionEnabled = actionEnabled(canStart, online, stream.phase),
        busy = stream.phase == AiStreamPhase.Streaming,
        online = online,
        stale = surface == AiOutputSurface.Stale || (surface == AiOutputSurface.Offline && stream.hasText),
    )
}

/** The error body after the bold "Helix error:" label — the terminal message, or "unknown" (web `error ?? …`). */
fun outputErrorMessage(
    error: String?,
    chrome: AIFeatureCardChrome,
): String = error?.takeIf { it.isNotBlank() } ?: chrome.errorUnknown

/**
 * The output region's merged TalkBack content description per surface, so the streamed/lifecycle output is
 * announced as one coherent message (the web AiOutputPanel's `role`/`aria-live` semantics). [AiOutputSurface.Hidden]
 * has no output box and folds into the header announcement, so it returns an empty string.
 */
fun outputAnnouncement(
    snapshot: AiFeatureCardSnapshot,
    chrome: AIFeatureCardChrome,
): String =
    when (snapshot.surface) {
        AiOutputSurface.Thinking -> chrome.thinking
        AiOutputSurface.Stale -> if (snapshot.text.isBlank()) chrome.refreshing else "${chrome.refreshing} ${snapshot.text}"
        AiOutputSurface.Content -> snapshot.text.ifBlank { chrome.emptyOutput }
        AiOutputSurface.Error -> "${chrome.errorLabel} ${outputErrorMessage(snapshot.error, chrome)}"
        AiOutputSurface.Offline ->
            if (snapshot.text.isBlank()) "${chrome.offline}. ${chrome.offlineDetail}" else "${chrome.offline}. ${snapshot.text}"
        AiOutputSurface.Hidden -> ""
    }
