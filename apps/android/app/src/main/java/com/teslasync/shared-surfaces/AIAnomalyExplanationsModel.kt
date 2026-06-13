// Pure, framework-free model + reducer + surface classifier for the AIAnomalyExplanations shared surface —
// the native analogue of everything the web component derives around its stream
// (web/src/components/ai/AIAnomalyExplanations.tsx → AIFeatureCard → AiOutputPanel, driven by useAiStream).
// No Compose, no Android UI, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web surface is `withAiFeature('anomaly-explanations', InnerSection)`. InnerSection POSTs
// { vehicle_id, days: 30 } to `/ai/anomalies/explain` via useAiStream and feeds the accumulated delta text,
// lifecycle state, and error into AIFeatureCard. The HOC renders nothing when the AI feature is gated off
// (ai_mode off), so the canonical baseline this surface ships against is "gate off => nothing rendered" —
// reproduced here as [ExplanationSurface.Hidden] (Honesty Covenant #9: documented, not silent). Every other
// state renders a non-blank surface as the P3 contract requires.
//
// The useAiStream lifecycle (idle -> streaming -> done | error) is mapped onto the P3 state vocabulary:
//   loading  => Streaming with no delta yet ([ExplanationSurface.Working], a thinking indicator)
//   empty    => Idle ([ExplanationSurface.Resting], the resting card inviting a generate) or a blank Done
//   content  => Live (streaming partial text) / Ready (completed explanation)
//   error    => Failed (no last-known) — a QueryError-equivalent with retry
//   stale    => Ready with a fetch older than the freshness window (a stale chip + manual regenerate)
//   offline  => Cached (a network failure that keeps the last-known explanation + an offline chip + retry)
// Unlike a cache-then-network feed there is no automatic background refresh: re-running an LLM generation is
// an explicit, billable action, so the stale surface invites a manual regenerate rather than auto-refreshing
// (documented divergence from the templated "auto-refresh", Honesty Covenant #9).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling AnomalyInlineRow / AIRestorePanel surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aianomalyexplanations

import io.teslasync.android.data.ErrorKind

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, vehicle id, or any
 * generated text, so a diagnostics line can never leak the operator's fleet state or the model output.
 */
const val AI_ANOMALY_EXPLANATIONS_SLUG: String = "AIAnomalyExplanations"

/** The analysis window the web component pins (`days: 30`), threaded into the explain request body. */
const val ANOMALY_EXPLANATION_WINDOW_DAYS: Int = 30

/**
 * How long a completed explanation is considered fresh before the surface flags it stale and invites a manual
 * regenerate. Five minutes mirrors the app's live-data staleness budget; it is generous because an LLM
 * narration of a 30-day window does not churn second-to-second.
 */
const val EXPLANATION_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

/** The useAiStream lifecycle, narrowed to what this surface reacts to (idle -> streaming -> done | failed). */
enum class ExplanationPhase {
    /** No generation requested yet — the resting card with the Generate action (web `state === 'idle'`). */
    Idle,

    /** A stream is open; delta text accumulates until a terminal frame (web `state === 'streaming'`). */
    Streaming,

    /** The stream closed successfully — the accumulated text is the explanation (web `state === 'done'`). */
    Done,

    /** The stream ended in a terminal error frame or threw (web `state === 'error'`). */
    Failed,
}

/**
 * One parsed frame of the explain stream — the native narrowing of the web `AiStreamEvent` union that this
 * surface consumes. Delta frames accumulate text; [Done] closes the stream successfully; [Failed] carries the
 * classified transport/HTTP failure so the render boundary can localize it (never the raw provider message).
 */
sealed interface AiStreamChunk {
    /** A `delta` frame — a chunk of generated prose appended to the accumulator (web `delta.text`). */
    data class Delta(
        val text: String,
    ) : AiStreamChunk

    /** The terminal `done` frame — the stream finished cleanly. */
    data object Done : AiStreamChunk

    /** A terminal `error` frame — carries the [ErrorKind] the UI maps to localized recovery copy. */
    data class Failed(
        val errorKind: ErrorKind,
    ) : AiStreamChunk
}

/**
 * The immutable surface state the [AIAnomalyExplanationsViewModel] exposes. It carries the AI feature gate
 * (web `withAiFeature`), the selected vehicle (web InnerSection's `vehicleId` prop -> `canStart`), the stream
 * [phase], the in-flight [streamingText] accumulator, the last committed explanation ([committedText], kept
 * across a failed regenerate so an offline surface can still show last-known), the classified [errorKind], and
 * the completion [fetchedAt] stamp used for the freshness check.
 *
 * @property gateEnabled whether the AI feature is on (web `useAiEnabled('anomaly-explanations')`).
 * @property vehicleId the active vehicle (web prop); `null` => the generate action is disabled.
 * @property phase the stream lifecycle phase.
 * @property streamingText the delta accumulator for the in-flight stream (web useAiStream `text`).
 * @property committedText the last successfully completed explanation, preserved for the offline surface.
 * @property errorKind the classification of the most recent failure, or `null`.
 * @property fetchedAt epoch-millis stamp of [committedText], or `null` when nothing has completed.
 */
data class AiExplanationState(
    val gateEnabled: Boolean = true,
    val vehicleId: Long? = null,
    val phase: ExplanationPhase = ExplanationPhase.Idle,
    val streamingText: String = "",
    val committedText: String = "",
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /** Web `canStart = vehicleId != null`: the generate action is available only with a selected vehicle. */
    val canStart: Boolean get() = vehicleId != null

    /** True while a stream is open (drives the button's busy affordance + disables re-entry). */
    val isStreaming: Boolean get() = phase == ExplanationPhase.Streaming
}

/**
 * Opens a fresh generation: enter [ExplanationPhase.Streaming], clear the in-flight accumulator, and drop any
 * prior error. The last [AiExplanationState.committedText] is intentionally retained (not shown while
 * streaming) so a failed regenerate can fall back to last-known — the web clears its visible text the same way
 * at `start()`, surfacing the thinking indicator until the first delta.
 */
fun AiExplanationState.startGenerating(): AiExplanationState =
    copy(phase = ExplanationPhase.Streaming, streamingText = "", errorKind = null)

/** Reduces one parsed [AiStreamChunk] into the next state (delta accumulation / done / failure). */
fun AiExplanationState.onChunk(
    chunk: AiStreamChunk,
    nowMs: Long,
): AiExplanationState =
    when (chunk) {
        is AiStreamChunk.Delta -> copy(streamingText = streamingText + chunk.text)
        AiStreamChunk.Done -> markDone(nowMs)
        is AiStreamChunk.Failed -> markFailed(chunk.errorKind)
    }

/**
 * Commits the accumulated text as the explanation and stamps it for the freshness check. A blank result keeps
 * a blank [AiExplanationState.committedText] so the surface renders its friendly empty state rather than an
 * empty box.
 */
fun AiExplanationState.markDone(nowMs: Long): AiExplanationState =
    copy(phase = ExplanationPhase.Done, committedText = streamingText, fetchedAt = nowMs)

/** Marks the stream failed with the classified [kind]; the prior committed explanation is left intact. */
fun AiExplanationState.markFailed(kind: ErrorKind): AiExplanationState = copy(phase = ExplanationPhase.Failed, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the
 * web hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the
 * thinking indicator.
 */
fun AiExplanationState.finishIfStreaming(nowMs: Long): AiExplanationState =
    if (phase == ExplanationPhase.Streaming) markDone(nowMs) else this

/**
 * The render-ready classification of [AiExplanationState] — a closed set of mutually-exclusive surfaces the
 * view switches on, so every branch is exhaustively covered and unit-tested off-device. Maps the stream
 * lifecycle onto the P3 loading / empty / content / error / stale / offline contract.
 */
sealed interface ExplanationSurface {
    /** The AI feature is gated off — the whole surface collapses (web `withAiFeature` renders `null`). */
    data object Hidden : ExplanationSurface

    /** Resting/idle: the card with the Generate action, enabled only when [canStart] (web `canStart`). */
    data class Resting(
        val canStart: Boolean,
    ) : ExplanationSurface

    /** Streaming with no delta yet — the thinking indicator (the surface's loading state). */
    data object Working : ExplanationSurface

    /** Streaming with partial text — the explanation rendering live as it arrives. */
    data class Live(
        val text: String,
    ) : ExplanationSurface

    /** Completed with text — the explanation; [stale] flags a fetch older than the freshness window. */
    data class Ready(
        val text: String,
        val stale: Boolean,
    ) : ExplanationSurface

    /** Completed but blank — a friendly empty state (the model returned nothing). */
    data object Empty : ExplanationSurface

    /** Failed but a prior explanation exists — last-known kept visible; [offline] picks the chip/copy. */
    data class Cached(
        val text: String,
        val offline: Boolean,
    ) : ExplanationSurface

    /** Failed with no last-known — a QueryError-equivalent with retry; [offline] picks the recovery copy. */
    data class Failed(
        val offline: Boolean,
    ) : ExplanationSurface
}

/**
 * Selects the render-ready [ExplanationSurface] for [state]. Pure (no Compose/clock): the caller supplies
 * [nowMs] and the [windowMs] freshness budget so the staleness decision is deterministic and testable.
 */
fun classifyExplanation(
    state: AiExplanationState,
    nowMs: Long,
    windowMs: Long = EXPLANATION_FRESHNESS_WINDOW_MS,
): ExplanationSurface {
    if (!state.gateEnabled) return ExplanationSurface.Hidden
    return when (state.phase) {
        ExplanationPhase.Idle -> ExplanationSurface.Resting(state.canStart)
        ExplanationPhase.Streaming ->
            if (state.streamingText.isBlank()) {
                ExplanationSurface.Working
            } else {
                ExplanationSurface.Live(state.streamingText)
            }

        ExplanationPhase.Done ->
            if (state.committedText.isBlank()) {
                ExplanationSurface.Empty
            } else {
                ExplanationSurface.Ready(state.committedText, isStale(state.fetchedAt, nowMs, windowMs))
            }

        ExplanationPhase.Failed -> failedSurface(state)
    }
}

/** Failure -> last-known [ExplanationSurface.Cached] when a prior explanation exists, else a hard failure. */
private fun failedSurface(state: AiExplanationState): ExplanationSurface {
    val offline = state.errorKind == ErrorKind.Network
    return if (state.committedText.isNotBlank()) {
        ExplanationSurface.Cached(state.committedText, offline)
    } else {
        ExplanationSurface.Failed(offline)
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
    surface: ExplanationSurface,
    labels: ExplanationOutputLabels,
): String? =
    when (surface) {
        ExplanationSurface.Hidden, is ExplanationSurface.Resting -> null
        ExplanationSurface.Working, is ExplanationSurface.Live -> labels.working
        ExplanationSurface.Empty -> labels.empty
        is ExplanationSurface.Ready -> if (surface.stale) "${labels.stale}. ${surface.text}" else surface.text
        is ExplanationSurface.Cached -> "${if (surface.offline) labels.offline else labels.error}. ${surface.text}"
        is ExplanationSurface.Failed -> labels.error
    }

/** The localized announcement fragments [outputAccessibilityLabel] composes — resolved by the view from i18n. */
data class ExplanationOutputLabels(
    val working: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val error: String,
)
