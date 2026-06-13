// Pure, framework-free model + reducer + surface classifier for the AIMqttSseInspectorExplanations shared
// surface — the native analogue of everything the web component derives around its stream
// (web/src/components/ai/AIMqttSseInspectorExplanations.tsx → AIFeatureCard → AiOutputPanel, driven by
// useAiStream). No Compose, no Android UI, no HTTP: every declaration here is exercised off-device by the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer (ADR-002).
//
// The web surface is `withAiFeature('mqtt-sse-inspector-explanations', InnerSection)`. InnerSection derives
// `haveWindow` from the (fromUnix, toUnix) tuple, builds a stable `{ from_unix, to_unix }` body, POSTs it to
// `/ai/system/streams/explain` via useAiStream, and feeds the accumulated delta text, lifecycle state, and
// error into AIFeatureCard. The "Explain streams" button is gated on `haveWindow` (web `canStart`), so the LLM
// can never widen the operator's in-scope window — see [ExplainerWindow.isValid] and [explainRequestBody]. The
// HOC renders nothing when the AI feature is gated off (ai_mode off), so the canonical baseline this surface
// ships against is "gate off => nothing rendered" — reproduced here as [ExplainerSurface.Hidden] (Honesty
// Covenant #9: documented, not silent). Every other state renders a non-blank surface as the P3 contract
// requires; the deterministic broker-status snapshot table the web keeps above the explainer is owned by the
// MQTTInspectorPage host and is out of this surface's scope (ADR-015 §I3 baseline intact).
//
// The useAiStream lifecycle (idle -> streaming -> done | error) is mapped onto the P3 state vocabulary:
//   loading  => Streaming with no delta yet ([ExplainerSurface.Working], a thinking indicator)
//   empty    => Idle ([ExplainerSurface.Resting], the resting card inviting an explain) or a blank Done
//   content  => Live (streaming partial text) / Ready (completed explanation)
//   error    => Failed (no last-known) — a QueryError-equivalent with retry
//   stale    => Ready with a fetch older than the freshness window (a stale chip + manual regenerate)
//   offline  => Cached (a network failure that keeps the last-known explanation + an offline chip + retry)
// Unlike a cache-then-network feed there is no automatic background refresh: re-running an LLM generation is an
// explicit, billable action, so the stale surface invites a manual regenerate rather than auto-refreshing
// (documented divergence from the templated "auto-refresh", Honesty Covenant #9).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package (a
// hyphen is illegal in a package identifier), so the package intentionally diverges from the path — exactly as
// the sibling AICostForecastNarration / AIAnomalyExplanations surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aimqttsseinspectorexplanations

import io.teslasync.android.data.ErrorKind

/**
 * Diagnostics surface slug emitted with the one-shot `view.opened` event (P1/S11). Carries no broker hostname,
 * SSE client id, VIN, window timestamp, or any generated text, so a diagnostics line can never leak the
 * operator's broker state or the model output (ADR-016).
 */
const val AI_MQTT_SSE_INSPECTOR_EXPLANATIONS_SLUG: String = "AIMqttSseInspectorExplanations"

/**
 * How long a completed explanation is considered fresh before the surface flags it stale and invites a manual
 * regenerate. Five minutes mirrors the app's live-data staleness budget; it is generous because an LLM
 * narration of the broker envelope does not churn second-to-second.
 */
const val EXPLAINER_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

/**
 * The inclusive explanation window the parent MQTTInspectorPage supplies (web InnerSection's `fromUnix` /
 * `toUnix` props), in Unix seconds. The window is the only request input; it is held here rather than in the
 * rendered state because it never changes what is drawn (the surface looks identical for any window).
 *
 * @property fromUnix inclusive start of the window; `null` (or non-positive) leaves the action disabled.
 * @property toUnix inclusive end of the window; `null` (or not greater than [fromUnix]) leaves it disabled.
 */
data class ExplainerWindow(
    val fromUnix: Long? = null,
    val toUnix: Long? = null,
) {
    /**
     * Web `haveWindow`: a valid window needs a positive start and an end strictly after it. (The web also tests
     * `Number.isFinite` because a JS number can be NaN/Infinity; a Kotlin [Long] is always finite, so the bound
     * checks alone are the faithful native equivalent.)
     */
    val isValid: Boolean
        get() {
            val from = fromUnix
            val to = toUnix
            return from != null && from > 0L && to != null && to > from
        }
}

/**
 * The request body the backend reads from `from_unix` / `to_unix` (web InnerSection's memoized `body`). When the
 * window is unset the web ships a zeroed body that the disabled button never actually posts; reproduced here so
 * the body shape is unit-tested for parity.
 *
 * @property fromUnix the `from_unix` field, or `0` when the window is invalid.
 * @property toUnix the `to_unix` field, or `0` when the window is invalid.
 */
data class ExplainRequestBody(
    val fromUnix: Long,
    val toUnix: Long,
)

/**
 * Mirrors the web `body` useMemo: a valid window yields its `{ from_unix, to_unix }`; an invalid window yields
 * the zeroed body (the button is disabled from posting it). Pure, so the parity is asserted off-device.
 */
fun explainRequestBody(window: ExplainerWindow): ExplainRequestBody =
    if (window.isValid) {
        ExplainRequestBody(window.fromUnix as Long, window.toUnix as Long)
    } else {
        ExplainRequestBody(0L, 0L)
    }

/** The useAiStream lifecycle, narrowed to what this surface reacts to (idle -> streaming -> done | failed). */
enum class ExplainerPhase {
    /** No generation requested yet — the resting card with the "Explain streams" action (web `state==='idle'`). */
    Idle,

    /** A stream is open; delta text accumulates until a terminal frame (web `state==='streaming'`). */
    Streaming,

    /** The stream closed successfully — the accumulated text is the explanation (web `state==='done'`). */
    Done,

    /** The stream ended in a terminal error frame or threw (web `state==='error'`). */
    Failed,
}

/**
 * One parsed frame of the explain stream — the native narrowing of the web `AiStreamEvent` union this surface
 * consumes. Delta frames accumulate text; [Done] closes the stream successfully; [Failed] carries the classified
 * transport/HTTP failure so the render boundary can localize it (never the raw provider message).
 */
sealed interface ExplainerChunk {
    /** A `delta` frame — a chunk of generated prose appended to the accumulator (web `delta.text`). */
    data class Delta(
        val text: String,
    ) : ExplainerChunk

    /** The terminal `done` frame — the stream finished cleanly. */
    data object Done : ExplainerChunk

    /** A terminal `error` frame — carries the [ErrorKind] the UI maps to localized recovery copy. */
    data class Failed(
        val errorKind: ErrorKind,
    ) : ExplainerChunk
}

/**
 * The immutable surface state the [AIMqttSseInspectorExplanationsViewModel] exposes. It carries the AI feature
 * gate (web `withAiFeature`), the selected [window] (web InnerSection's props -> `canStart`), the stream [phase],
 * the in-flight [streamingText] accumulator, the last committed explanation ([committedText], kept across a
 * failed regenerate so an offline surface can still show last-known), the classified [errorKind], and the
 * completion [fetchedAt] stamp used for the freshness check.
 *
 * @property gateEnabled whether the AI feature is on (web `useAiEnabled('mqtt-sse-inspector-explanations')`).
 * @property window the active explanation window (web props); invalid => the explain action is disabled.
 * @property phase the stream lifecycle phase.
 * @property streamingText the delta accumulator for the in-flight stream (web useAiStream `text`).
 * @property committedText the last successfully completed explanation, preserved for the offline surface.
 * @property errorKind the classification of the most recent failure, or `null`.
 * @property fetchedAt epoch-millis stamp of [committedText], or `null` when nothing has completed.
 */
data class MqttExplainerState(
    val gateEnabled: Boolean = true,
    val window: ExplainerWindow = ExplainerWindow(),
    val phase: ExplainerPhase = ExplainerPhase.Idle,
    val streamingText: String = "",
    val committedText: String = "",
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /** Web `canStart = haveWindow`: the explain action is available only with a valid window. */
    val canStart: Boolean get() = window.isValid

    /** True while a stream is open (drives the button's busy affordance + disables re-entry). */
    val isStreaming: Boolean get() = phase == ExplainerPhase.Streaming
}

/**
 * Opens a fresh generation: enter [ExplainerPhase.Streaming], clear the in-flight accumulator, and drop any
 * prior error. The last [MqttExplainerState.committedText] is intentionally retained (not shown while streaming)
 * so a failed regenerate can fall back to last-known — the web clears its visible text the same way at
 * `start()`, surfacing the thinking indicator until the first delta.
 */
fun MqttExplainerState.startGenerating(): MqttExplainerState = copy(phase = ExplainerPhase.Streaming, streamingText = "", errorKind = null)

/** Reduces one parsed [ExplainerChunk] into the next state (delta accumulation / done / failure). */
fun MqttExplainerState.onChunk(
    chunk: ExplainerChunk,
    nowMs: Long,
): MqttExplainerState =
    when (chunk) {
        is ExplainerChunk.Delta -> copy(streamingText = streamingText + chunk.text)
        ExplainerChunk.Done -> markDone(nowMs)
        is ExplainerChunk.Failed -> markFailed(chunk.errorKind)
    }

/**
 * Commits the accumulated text as the explanation and stamps it for the freshness check. A blank result keeps a
 * blank [MqttExplainerState.committedText] so the surface renders its friendly empty state rather than an empty
 * box.
 */
fun MqttExplainerState.markDone(nowMs: Long): MqttExplainerState =
    copy(phase = ExplainerPhase.Done, committedText = streamingText, fetchedAt = nowMs)

/** Marks the stream failed with the classified [kind]; the prior committed explanation is left intact. */
fun MqttExplainerState.markFailed(kind: ErrorKind): MqttExplainerState = copy(phase = ExplainerPhase.Failed, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the web
 * hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the
 * thinking indicator.
 */
fun MqttExplainerState.finishIfStreaming(nowMs: Long): MqttExplainerState = if (phase == ExplainerPhase.Streaming) markDone(nowMs) else this

/**
 * The render-ready classification of [MqttExplainerState] — a closed set of mutually-exclusive surfaces the view
 * switches on, so every branch is exhaustively covered and unit-tested off-device. Maps the stream lifecycle
 * onto the P3 loading / empty / content / error / stale / offline contract.
 */
sealed interface ExplainerSurface {
    /** The AI feature is gated off — the whole surface collapses (web `withAiFeature` renders `null`). */
    data object Hidden : ExplainerSurface

    /** Resting/idle: the card with the explain action, enabled only when [canStart] (web `haveWindow`). */
    data class Resting(
        val canStart: Boolean,
    ) : ExplainerSurface

    /** Streaming with no delta yet — the thinking indicator (the surface's loading state). */
    data object Working : ExplainerSurface

    /** Streaming with partial text — the explanation rendering live as it arrives. */
    data class Live(
        val text: String,
    ) : ExplainerSurface

    /** Completed with text — the explanation; [stale] flags a fetch older than the freshness window. */
    data class Ready(
        val text: String,
        val stale: Boolean,
    ) : ExplainerSurface

    /** Completed but blank — a friendly empty state (the model returned nothing). */
    data object Empty : ExplainerSurface

    /** Failed but a prior explanation exists — last-known kept visible; [offline] picks the chip/copy. */
    data class Cached(
        val text: String,
        val offline: Boolean,
    ) : ExplainerSurface

    /** Failed with no last-known — a QueryError-equivalent with retry; [offline] picks the recovery copy. */
    data class Failed(
        val offline: Boolean,
    ) : ExplainerSurface
}

/**
 * Selects the render-ready [ExplainerSurface] for [state]. Pure (no Compose/clock): the caller supplies [nowMs]
 * and the [windowMs] freshness budget so the staleness decision is deterministic and testable.
 */
fun classifyExplainer(
    state: MqttExplainerState,
    nowMs: Long,
    windowMs: Long = EXPLAINER_FRESHNESS_WINDOW_MS,
): ExplainerSurface {
    if (!state.gateEnabled) return ExplainerSurface.Hidden
    return when (state.phase) {
        ExplainerPhase.Idle -> ExplainerSurface.Resting(state.canStart)
        ExplainerPhase.Streaming ->
            if (state.streamingText.isBlank()) {
                ExplainerSurface.Working
            } else {
                ExplainerSurface.Live(state.streamingText)
            }

        ExplainerPhase.Done ->
            if (state.committedText.isBlank()) {
                ExplainerSurface.Empty
            } else {
                ExplainerSurface.Ready(state.committedText, isStale(state.fetchedAt, nowMs, windowMs))
            }

        ExplainerPhase.Failed -> failedSurface(state)
    }
}

/** Failure -> last-known [ExplainerSurface.Cached] when a prior explanation exists, else a hard failure. */
private fun failedSurface(state: MqttExplainerState): ExplainerSurface {
    val offline = state.errorKind == ErrorKind.Network
    return if (state.committedText.isNotBlank()) {
        ExplainerSurface.Cached(state.committedText, offline)
    } else {
        ExplainerSurface.Failed(offline)
    }
}

/** True when a completed explanation stamped at [fetchedAt] is older than [windowMs] relative to [nowMs]. */
fun isStale(
    fetchedAt: Long?,
    nowMs: Long,
    windowMs: Long,
): Boolean = fetchedAt != null && nowMs - fetchedAt > windowMs

/**
 * Builds the merged accessibility description for the card header from already-localized parts (web reads the
 * title, the "Helix" badge, and the description as one block). Kept pure so TalkBack-label presence is unit-
 * tested without a Compose host.
 */
fun headerAccessibilityLabel(
    title: String,
    badge: String,
    description: String,
): String = "$title ($badge). $description"

/**
 * Builds the accessibility description for the output region per [surface] from already-localized parts, or
 * `null` when the output region carries no announcement (the resting/hidden surfaces, whose card chrome is
 * announced instead). Pure so the per-state a11y labels are unit-tested off-device.
 */
fun outputAccessibilityLabel(
    surface: ExplainerSurface,
    labels: ExplainerOutputLabels,
): String? =
    when (surface) {
        ExplainerSurface.Hidden, is ExplainerSurface.Resting -> null
        ExplainerSurface.Working, is ExplainerSurface.Live -> labels.working
        ExplainerSurface.Empty -> labels.empty
        is ExplainerSurface.Ready -> if (surface.stale) "${labels.stale}. ${surface.text}" else surface.text
        is ExplainerSurface.Cached -> "${if (surface.offline) labels.offline else labels.error}. ${surface.text}"
        is ExplainerSurface.Failed -> labels.error
    }

/** The localized announcement fragments [outputAccessibilityLabel] composes — resolved by the view from i18n. */
data class ExplainerOutputLabels(
    val working: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val error: String,
)
