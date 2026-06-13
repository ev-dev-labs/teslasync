// Pure, framework-free model + reducer + surface classifier for the AISignalExplorerNlFilter shared surface — the
// native analogue of everything the web component derives around its stream
// (web/src/components/ai/AISignalExplorerNlFilter.tsx -> AIFeatureCard -> AiOutputPanel, driven by useAiStream).
// No Compose, no Android UI, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer (ADR-002).
//
// The web surface is `withAiFeature('signal-explorer-nl-filter', InnerSection)`. InnerSection POSTs
// `{ vehicle_id, prompt }` to `/ai/signals/filter/draft` via useAiStream, feeds the accumulated delta text +
// lifecycle state + error into AIFeatureCard, and — distinct from the pure-narration siblings — captures a typed
// SignalFilter draft from the `draft_signal_filter` tool_result frame. When a draft is captured an "Apply to
// filters" affordance appears; clicking it hands the typed [SignalFilterDraft] back to the parent
// SignalExplorerPage via the view's `onApply` callback, which copies it into the deterministic filter form. The
// LLM NEVER edits filter state directly (ADR-015 I8 propose-only) — this model therefore carries no mutation, it
// only reduces the draft stream onto a render contract and surfaces the captured draft for review.
//
// The HOC renders nothing when the AI feature is gated off (ai_mode off), so the canonical baseline this surface
// ships against is "gate off => nothing rendered" — reproduced here as [FilterDraftSurface.Hidden] (Honesty
// Covenant #9: documented, not silent). Every other state renders a non-blank surface as the P3 contract
// requires. The useAiStream lifecycle (idle -> streaming -> done | error) is mapped onto the P3 state vocabulary:
//   loading  => Streaming with no delta yet ([FilterDraftSurface.Working], a thinking indicator)
//   empty    => Idle ([FilterDraftSurface.Resting], the resting card inviting a draft) or a blank Done
//   content  => Live (streaming partial draft) / Ready (completed draft replay text)
//   error    => Failed (no last-known) — a QueryError-equivalent with retry
//   stale    => Ready with a draft older than the freshness window (a stale chip + manual re-draft)
//   offline  => Cached (a network failure that keeps the last-known draft text + an offline chip + retry)
// Unlike a cache-then-network feed there is no automatic background refresh: re-running an LLM draft is an
// explicit, billable action, so the stale surface invites a manual re-draft rather than auto-refreshing
// (documented divergence from the templated "auto-refresh", Honesty Covenant #9).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/AISignalExplorerNlFilter — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen is illegal in a package identifier), so the package intentionally diverges from
// the path — exactly as the sibling AINLSqlPlayground / AICrossRuleConflictDetection surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aisignalexplorernlfilter

import io.teslasync.android.data.ErrorKind
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, vehicle id, prompt
 * text, or any draft detail, so a diagnostics line can never leak the operator's fleet state or the model output.
 */
const val AI_SIGNAL_EXPLORER_NL_FILTER_SLUG: String = "AISignalExplorerNlFilter"

/** The per-feature AI-Off gate id — mirrors the web `withAiFeature('signal-explorer-nl-filter', ...)` argument. */
const val SIGNAL_EXPLORER_NL_FILTER_FEATURE_ID: String = "signal-explorer-nl-filter"

/** The tool whose `tool_result` carries the typed filter draft (web `name === 'draft_signal_filter'`). */
const val DRAFT_TOOL_NAME: String = "draft_signal_filter"

/**
 * How long a completed draft is considered fresh before the surface flags it stale and invites a manual
 * re-draft. Five minutes mirrors the app's live-data staleness budget; it is generous because an LLM filter
 * draft for a single request does not churn second-to-second.
 */
const val DRAFT_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

// ── Captured draft (web `SignalFilterDraft`) ──────────────────────────────────────────────────────────────────

/**
 * The typed signal-filter draft the Helix panel emits when the LLM successfully calls `draft_signal_filter` —
 * the native mirror of the web `SignalFilterDraft` interface and the Go-side `SignalFilter` DTO. The field set
 * is intentionally narrow: only the fields the SignalExplorerPage's deterministic filter form already owns.
 *
 * @property vehicleId the vehicle the proposed filter scopes to (web `vehicle_id`).
 * @property signals the catalog signal names the filter selects (web `signals`).
 * @property rangePreset the time-range preset key the filter applies (web `range_preset`).
 * @property perPage the page size the filter requests (web `per_page`).
 */
data class SignalFilterDraft(
    val vehicleId: Long,
    val signals: List<String>,
    val rangePreset: String,
    val perPage: Int,
)

/**
 * Parses a `draft_signal_filter` tool_result payload into a [SignalFilterDraft] — a faithful port of the web
 * `parseSignalFilterDraft`. Returns `null` (web parity, never throwing) for a payload that is not an object, is
 * not `status === 'ok'`, has no `draft` object, has a non-number `vehicle_id`/`per_page`, a non-array `signals`,
 * a non-string `range_preset`, or — crucially, mirroring the web `signals.every(isString)` guard — a `signals`
 * array containing ANY non-string entry (the whole draft is rejected, not just the offending element).
 */
@Suppress("ReturnCount")
fun parseSignalFilterDraft(data: JsonElement?): SignalFilterDraft? {
    val obj = data as? JsonObject ?: return null
    if (obj.stringField("status") != "ok") return null
    val draft = obj["draft"] as? JsonObject ?: return null
    val vehicleId = draft.longNumberField("vehicle_id") ?: return null
    val signalsArray = draft["signals"] as? JsonArray ?: return null
    val signals = ArrayList<String>(signalsArray.size)
    for (element in signalsArray) {
        val signal = (element as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        signals.add(signal)
    }
    val rangePreset = draft.stringField("range_preset") ?: return null
    val perPage = draft.intNumberField("per_page") ?: return null
    return SignalFilterDraft(vehicleId = vehicleId, signals = signals, rangePreset = rangePreset, perPage = perPage)
}

/** Reads a JSON string field (web `typeof x === 'string'`): the unescaped content, or `null` for any non-string. */
private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

/** Reads a JSON number field as a [Long] (web `typeof x === 'number'`): a non-string primitive parsed as a long. */
private fun JsonObject.longNumberField(key: String): Long? = (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull

/** Reads a JSON number field as an [Int] (web `typeof x === 'number'`): a non-string primitive parsed as an int. */
private fun JsonObject.intNumberField(key: String): Int? = (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull

// ── Stream chunk (native narrowing of the web `AiStreamEvent` union this surface consumes) ────────────────────

/**
 * One parsed frame of the draft stream — the native narrowing of the web `AiStreamEvent` union that this surface
 * reacts to. Delta frames accumulate the streamed text; [DraftCaptured] carries the typed draft lifted from a
 * `draft_signal_filter` tool_result (web `parseSignalFilterDraft`); [Done] closes the stream successfully;
 * [Failed] carries the classified transport/HTTP failure so the render boundary can localize it (never the raw
 * provider message). The SSE-frame -> chunk decoding is the host adapter's responsibility (P1/S8 boundary),
 * exactly as the sibling narration surfaces document.
 */
sealed interface AiStreamChunk {
    /** A `delta` frame — a chunk of generated text appended to the accumulator (web `delta.text`). */
    data class Delta(
        val text: String,
    ) : AiStreamChunk

    /** A captured `draft_signal_filter` tool_result — the typed draft the Apply affordance hands back. */
    data class DraftCaptured(
        val draft: SignalFilterDraft,
    ) : AiStreamChunk

    /** The terminal `done` frame — the stream finished cleanly. */
    data object Done : AiStreamChunk

    /** A terminal `error` frame — carries the [ErrorKind] the UI maps to localized recovery copy. */
    data class Failed(
        val errorKind: ErrorKind,
    ) : AiStreamChunk
}

/** The useAiStream lifecycle, narrowed to what this surface reacts to (idle -> streaming -> done | failed). */
enum class DraftPhase {
    /** No draft requested yet — the resting card with the Draft action (web `state === 'idle'`). */
    Idle,

    /** A stream is open; delta text accumulates until a terminal frame (web `state === 'streaming'`). */
    Streaming,

    /** The stream closed successfully — the accumulated text is the draft replay (web `state === 'done'`). */
    Done,

    /** The stream ended in a terminal error frame or threw (web `state === 'error'`). */
    Failed,
}

/**
 * The immutable surface state the [AISignalExplorerNlFilterViewModel] exposes. It carries the AI feature gate
 * (web `withAiFeature`), the active [vehicleId] (web InnerSection's `vehicleId` prop) and the free-text [prompt]
 * (web `prompt` state -> `canStart`), the stream [phase], the in-flight [streamingText] accumulator, the last
 * committed draft text ([committedText], kept across a failed re-draft so an offline surface can still show
 * last-known), the captured typed [draft] (web `draft` state -> the Apply affordance), the classified
 * [errorKind], and the completion [fetchedAt] stamp.
 *
 * @property gateEnabled whether the AI feature is on (web `useAiEnabled('signal-explorer-nl-filter')`).
 * @property vehicleId the active vehicle (web prop); `null`/non-positive => the draft action is disabled.
 * @property prompt the free-text filter request (web `prompt`); blank/whitespace => the action is disabled.
 * @property phase the stream lifecycle phase.
 * @property streamingText the delta accumulator for the in-flight stream (web useAiStream `text`).
 * @property committedText the last successfully completed draft replay, preserved for the offline surface.
 * @property draft the typed draft captured from the tool_result, or `null` (web `draft` state).
 * @property errorKind the classification of the most recent failure, or `null`.
 * @property fetchedAt epoch-millis stamp of [committedText], or `null` when nothing has completed.
 */
data class AiFilterDraftState(
    val gateEnabled: Boolean = true,
    val vehicleId: Long? = null,
    val prompt: String = "",
    val phase: DraftPhase = DraftPhase.Idle,
    val streamingText: String = "",
    val committedText: String = "",
    val draft: SignalFilterDraft? = null,
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /** Web `trimmed = prompt.trim()`: the prompt with surrounding whitespace removed. */
    val trimmedPrompt: String get() = prompt.trim()

    /** Web `hasPrompt = trimmed.length > 0`: whether the filter request is non-empty. */
    val hasPrompt: Boolean get() = trimmedPrompt.isNotEmpty()

    /** Web `hasVehicle = vehicleId > 0`: whether a vehicle has been picked (a zero/null id disables Draft). */
    val hasVehicle: Boolean get() = (vehicleId ?: 0L) > 0L

    /** Web `canStart = hasPrompt && hasVehicle`: the draft action needs both a question AND a vehicle. */
    val canStart: Boolean get() = hasPrompt && hasVehicle

    /** True while a stream is open (drives the button's busy affordance + disables re-entry). */
    val isStreaming: Boolean get() = phase == DraftPhase.Streaming

    /** Web `canApply = !!draft && !isStreaming`: the Apply affordance is enabled only off a captured draft. */
    val canApply: Boolean get() = draft != null && !isStreaming
}

/** Sets the free-text [next] prompt (web `setPrompt`). */
fun AiFilterDraftState.withPrompt(next: String): AiFilterDraftState = copy(prompt = next)

/** Sets the active [vehicleId] (web InnerSection's `vehicleId` prop); a zero/null id disables the Draft action. */
fun AiFilterDraftState.withVehicle(vehicleId: Long?): AiFilterDraftState = copy(vehicleId = vehicleId)

/**
 * Opens a fresh draft: enter [DraftPhase.Streaming], clear the in-flight accumulator, drop any prior error, and
 * clear the captured [AiFilterDraftState.draft] (web `handleDraft` calls `setDraft(null)` before `stream.start()`).
 * The last [AiFilterDraftState.committedText] is intentionally retained (not shown while streaming) so a failed
 * re-draft can fall back to last-known, surfacing the thinking indicator until the first delta.
 */
fun AiFilterDraftState.startDrafting(): AiFilterDraftState =
    copy(phase = DraftPhase.Streaming, streamingText = "", errorKind = null, draft = null)

/** Reduces one parsed [AiStreamChunk] into the next state (delta accumulation / draft capture / done / failure). */
fun AiFilterDraftState.onChunk(
    chunk: AiStreamChunk,
    nowMs: Long,
): AiFilterDraftState =
    when (chunk) {
        is AiStreamChunk.Delta -> copy(streamingText = streamingText + chunk.text)
        is AiStreamChunk.DraftCaptured -> copy(draft = chunk.draft)
        AiStreamChunk.Done -> markDone(nowMs)
        is AiStreamChunk.Failed -> markFailed(chunk.errorKind)
    }

/**
 * Commits the accumulated text as the completed draft replay and stamps it for the freshness check. A blank
 * result keeps a blank [AiFilterDraftState.committedText] so the surface renders its friendly empty state rather
 * than an empty box (the captured [AiFilterDraftState.draft], if any, still drives the Apply affordance).
 */
fun AiFilterDraftState.markDone(nowMs: Long): AiFilterDraftState =
    copy(phase = DraftPhase.Done, committedText = streamingText, fetchedAt = nowMs)

/** Marks the stream failed with the classified [kind]; the prior committed draft + captured draft are left intact. */
fun AiFilterDraftState.markFailed(kind: ErrorKind): AiFilterDraftState = copy(phase = DraftPhase.Failed, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the web
 * hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the
 * thinking indicator.
 */
fun AiFilterDraftState.finishIfStreaming(nowMs: Long): AiFilterDraftState = if (phase == DraftPhase.Streaming) markDone(nowMs) else this

// ── Output-panel surface (every state the prompt mandates) ────────────────────────────────────────────────────

/**
 * The render-ready classification of the output region of [AiFilterDraftState] — a closed set of
 * mutually-exclusive surfaces the view switches on, so every branch is exhaustively covered and unit-tested
 * off-device. Maps the stream lifecycle onto the P3 loading / empty / content / error / stale / offline contract.
 * The captured [AiFilterDraftState.draft] + the Apply affordance are orthogonal to this output surface and are
 * driven directly from state, exactly as the web AIFeatureCard's output panel is independent of its `children`
 * Apply button.
 */
sealed interface FilterDraftSurface {
    /** The AI feature is gated off — the whole surface collapses (web `withAiFeature` renders `null`). */
    data object Hidden : FilterDraftSurface

    /** Resting/idle: the card with the Draft action, enabled only when [canStart] (web `canStart`). */
    data class Resting(
        val canStart: Boolean,
    ) : FilterDraftSurface

    /** Streaming with no delta yet — the thinking indicator (the surface's loading state). */
    data object Working : FilterDraftSurface

    /** Streaming with partial text — the draft rendering live as it arrives. */
    data class Live(
        val text: String,
    ) : FilterDraftSurface

    /** Completed with text — the draft replay; [stale] flags a draft older than the freshness window. */
    data class Ready(
        val text: String,
        val stale: Boolean,
    ) : FilterDraftSurface

    /** Completed but blank — a friendly empty state (the model streamed no text). */
    data object Empty : FilterDraftSurface

    /** Failed but a prior draft replay exists — last-known kept visible; [offline] picks the chip/copy. */
    data class Cached(
        val text: String,
        val offline: Boolean,
    ) : FilterDraftSurface

    /** Failed with no last-known — a QueryError-equivalent with retry; [offline] picks the recovery copy. */
    data class Failed(
        val offline: Boolean,
    ) : FilterDraftSurface
}

/**
 * Selects the render-ready [FilterDraftSurface] for [state]. Pure (no Compose/clock): the caller supplies [nowMs]
 * and the [windowMs] freshness budget so the staleness decision is deterministic and testable.
 */
fun classifyDraft(
    state: AiFilterDraftState,
    nowMs: Long,
    windowMs: Long = DRAFT_FRESHNESS_WINDOW_MS,
): FilterDraftSurface {
    if (!state.gateEnabled) return FilterDraftSurface.Hidden
    return when (state.phase) {
        DraftPhase.Idle -> FilterDraftSurface.Resting(state.canStart)
        DraftPhase.Streaming ->
            if (state.streamingText.isBlank()) {
                FilterDraftSurface.Working
            } else {
                FilterDraftSurface.Live(state.streamingText)
            }

        DraftPhase.Done ->
            if (state.committedText.isBlank()) {
                FilterDraftSurface.Empty
            } else {
                FilterDraftSurface.Ready(state.committedText, isStale(state.fetchedAt, nowMs, windowMs))
            }

        DraftPhase.Failed -> failedSurface(state)
    }
}

/** Failure -> last-known [FilterDraftSurface.Cached] when a prior draft replay exists, else a hard failure. */
private fun failedSurface(state: AiFilterDraftState): FilterDraftSurface {
    val offline = state.errorKind == ErrorKind.Network
    return if (state.committedText.isNotBlank()) {
        FilterDraftSurface.Cached(state.committedText, offline)
    } else {
        FilterDraftSurface.Failed(offline)
    }
}

/** True when a completed draft stamped at [fetchedAt] is older than [windowMs] relative to [nowMs]. */
fun isStale(
    fetchedAt: Long?,
    nowMs: Long,
    windowMs: Long,
): Boolean = fetchedAt != null && nowMs - fetchedAt > windowMs

// ── i18n facade (web `t(key, fallback)`) ─────────────────────────────────────────────────────────────────────

/** A by-name string resolver — the P1/S10 i18n facade in production, a map/fallback in tests (web `t`). */
typealias StringResolver = (key: String, fallback: String) -> String

private val NON_IDENTIFIER = Regex("[^A-Za-z0-9_]")

/**
 * Folds a dotted i18next key into the generated Android catalog resource name (web `a.b.c` -> `translation_a_b_c`),
 * matching apps/shared/i18n/generators/gen-i18n.ts `androidName`. The production resolver looks this up by name
 * and falls back to the web English when the key is absent.
 */
fun foldCatalogKey(dottedKey: String): String = "translation_" + dottedKey.replace(NON_IDENTIFIER, "_").trim('_')

/** A resolver that always returns the web English fallback — used by @Preview and the off-device unit tests. */
val FallbackResolver: StringResolver = { _, fallback -> fallback }

/**
 * The surface's i18n keys + their exact web English fallbacks. The `signalExplorer.aiFilter.*` keys are lifted
 * verbatim from the web component's `t(key, default)` calls; the `helix.*` / `common.*` / `mqtt.*` keys carry the
 * same English the shared web scaffold (`AIFeatureCard` / `AiOutputPanel`) and the lifecycle chrome render, so the
 * painted English is identical whether or not the catalog defines a given key. Keys absent from the generated
 * catalog resolve through the same fallback here — exact web parity, documented not silent (Honesty Covenant #9).
 */
internal object AiFilterKeys {
    const val TITLE = "signalExplorer.aiFilter.title"
    const val TITLE_EN = "Helix natural-language filter"

    const val DESCRIPTION = "signalExplorer.aiFilter.description"
    const val DESCRIPTION_EN =
        "Describe the filter in plain English (e.g. \"battery level for yesterday\"). The LLM proposes a typed " +
            "filter you can apply with one click; it never edits the form directly."

    const val BUTTON = "signalExplorer.aiFilter.button"
    const val BUTTON_EN = "Draft filter"

    const val BADGE = "signalExplorer.aiFilter.badge"
    const val BADGE_EN = "Helix"

    const val PROMPT_HINT = "signalExplorer.aiFilter.promptPlaceholder" // parity:allow web i18n key name, not a stub
    const val PROMPT_HINT_EN = "e.g. show me battery level for yesterday"

    const val PROMPT_LABEL = "signalExplorer.aiFilter.promptLabel"
    const val PROMPT_LABEL_EN = "Filter request"

    const val APPLY_BUTTON = "signalExplorer.aiFilter.applyButton"
    const val APPLY_BUTTON_EN = "Apply to filters"

    const val APPLY_TOOLTIP = "signalExplorer.aiFilter.applyTooltip"
    const val APPLY_TOOLTIP_EN =
        "Copy the proposed filter into the form above. You can still edit it before clicking Explore."

    // Native state-chrome keys (fallback-resolved; mirror the shared AIFeatureCard / AiOutputPanel English).
    const val ASK_HELIX = "helix.askHelix"
    const val ASK_HELIX_EN = "Ask Helix"

    const val BADGE_ARIA = "helix.ariaLabel"
    const val BADGE_ARIA_EN = "Helix"

    const val THINKING = "chatbot.thinking"
    const val THINKING_EN = "Helix is thinking\u2026"

    const val EMPTY = "common.noData"
    const val EMPTY_EN = "No data available"

    const val STALE = "mqtt.stale"
    const val STALE_EN = "Stale"

    const val OFFLINE = "common.offline"
    const val OFFLINE_EN = "Offline"

    const val RETRY = "common.retry"
    const val RETRY_EN = "Retry"

    const val ERROR = "signalExplorer.aiFilter.error"
    const val ERROR_EN = "Helix couldn't draft the filter. Please try again."
}

/** The fully-resolved display strings the composable paints — resolved off-device so i18n is unit-testable. */
@Suppress("LongParameterList")
data class AiFilterLabels(
    val title: String,
    val description: String,
    val button: String,
    val badge: String,
    val badgeAria: String,
    val promptHint: String,
    val promptLabel: String,
    val applyButton: String,
    val applyTooltip: String,
    val askHelix: String,
    val thinking: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val retry: String,
    val error: String,
)

/** Resolves every surface label through [resolve], folding the web `t(key, fallback)` calls into one value. */
fun aiFilterLabels(resolve: StringResolver): AiFilterLabels =
    AiFilterLabels(
        title = resolve(AiFilterKeys.TITLE, AiFilterKeys.TITLE_EN),
        description = resolve(AiFilterKeys.DESCRIPTION, AiFilterKeys.DESCRIPTION_EN),
        button = resolve(AiFilterKeys.BUTTON, AiFilterKeys.BUTTON_EN),
        badge = resolve(AiFilterKeys.BADGE, AiFilterKeys.BADGE_EN),
        badgeAria = resolve(AiFilterKeys.BADGE_ARIA, AiFilterKeys.BADGE_ARIA_EN),
        promptHint = resolve(AiFilterKeys.PROMPT_HINT, AiFilterKeys.PROMPT_HINT_EN),
        promptLabel = resolve(AiFilterKeys.PROMPT_LABEL, AiFilterKeys.PROMPT_LABEL_EN),
        applyButton = resolve(AiFilterKeys.APPLY_BUTTON, AiFilterKeys.APPLY_BUTTON_EN),
        applyTooltip = resolve(AiFilterKeys.APPLY_TOOLTIP, AiFilterKeys.APPLY_TOOLTIP_EN),
        askHelix = resolve(AiFilterKeys.ASK_HELIX, AiFilterKeys.ASK_HELIX_EN),
        thinking = resolve(AiFilterKeys.THINKING, AiFilterKeys.THINKING_EN),
        empty = resolve(AiFilterKeys.EMPTY, AiFilterKeys.EMPTY_EN),
        stale = resolve(AiFilterKeys.STALE, AiFilterKeys.STALE_EN),
        offline = resolve(AiFilterKeys.OFFLINE, AiFilterKeys.OFFLINE_EN),
        retry = resolve(AiFilterKeys.RETRY, AiFilterKeys.RETRY_EN),
        error = resolve(AiFilterKeys.ERROR, AiFilterKeys.ERROR_EN),
    )

// ── Accessibility-label builders (TalkBack-label presence; pure so unit-tested without a Compose host) ────────

/**
 * Builds the merged accessibility description for the card header from already-localized parts (web reads the
 * title, the "Helix" badge, and the description as one block).
 */
fun headerAccessibilityLabel(
    title: String,
    badge: String,
    description: String,
): String = "$title ($badge). $description"

/**
 * The Draft button's accessible name — the native mirror of the web AIFeatureCard `aria-label`
 * (`"${askHelix} \u00b7 ${buttonLabel}"`), so TalkBack announces the contextual Helix verb, not just "Ask Helix".
 */
fun draftButtonContentDescription(
    askHelix: String,
    button: String,
): String = "$askHelix \u00b7 $button"

/**
 * The Apply button's accessible name — the localized label folded with the web `title` tooltip so its guidance
 * survives on touch (no hover). Pure so the interactive element's label presence is unit-tested off-device.
 */
fun applyButtonContentDescription(
    applyButton: String,
    applyTooltip: String,
): String = "$applyButton. $applyTooltip"

/**
 * Builds the accessibility description for the output region per [surface] from already-localized parts, or
 * `null` when the output region carries no announcement (the resting/hidden surfaces, whose card chrome is
 * announced instead).
 */
fun outputAccessibilityLabel(
    surface: FilterDraftSurface,
    labels: FilterDraftOutputLabels,
): String? =
    when (surface) {
        FilterDraftSurface.Hidden, is FilterDraftSurface.Resting -> null
        FilterDraftSurface.Working, is FilterDraftSurface.Live -> labels.working
        FilterDraftSurface.Empty -> labels.empty
        is FilterDraftSurface.Ready -> if (surface.stale) joinAnnouncement(labels.stale, surface.text) else surface.text
        is FilterDraftSurface.Cached -> joinAnnouncement(if (surface.offline) labels.offline else labels.error, surface.text)
        is FilterDraftSurface.Failed -> labels.error
    }

/**
 * Joins an announcement [prefix] (a status label) with a [body] into one TalkBack utterance. A prefix that
 * already ends in sentence punctuation ('.', '!', '?') is followed by a single space so the announcement never
 * doubles a period — the localized draft error is a full sentence, while the offline/stale chips are bare words
 * that take the inserted ". ".
 */
private fun joinAnnouncement(
    prefix: String,
    body: String,
): String {
    val last = prefix.lastOrNull()
    val separator = if (last == '.' || last == '!' || last == '?') " " else ". "
    return "$prefix$separator$body"
}

/** The localized announcement fragments [outputAccessibilityLabel] composes — resolved by the view from i18n. */
data class FilterDraftOutputLabels(
    val working: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val error: String,
)
