// Pure, framework-free model + reducer + surface classifier for the AISpeedProfileInsights shared surface —
// the native analogue of everything the web component derives around its stream
// (web/src/components/ai/AISpeedProfileInsights.tsx → AIFeatureCard → AiOutputPanel, driven by useAiStream).
// No Compose, no Android UI, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web surface is `withAiFeature('speed-profile-insights', InnerSection)`. InnerSection POSTs an empty body
// to `/ai/drives/{driveID}/speed-profile/insights` via useAiStream and feeds the accumulated delta text,
// lifecycle state, and error into AIFeatureCard. The HOC renders nothing when the AI feature is gated off
// (ai_mode off), so the canonical baseline this surface ships against is "gate off => nothing rendered" —
// reproduced here as [InsightsSurface.Hidden] (Honesty Covenant #9: documented, not silent). Every other state
// renders a non-blank surface as the P3 contract requires.
//
// The useAiStream lifecycle (idle -> streaming -> done | error) is mapped onto the P3 state vocabulary:
//   loading  => Streaming with no delta yet ([InsightsSurface.Working], a thinking indicator)
//   empty    => Idle ([InsightsSurface.Resting], the resting card inviting a generate) or a blank Done
//   content  => Live (streaming partial text) / Ready (completed insights narrative)
//   error    => Failed (no last-known) — a QueryError-equivalent with retry
//   stale    => Ready with a fetch older than the freshness window (a stale chip + manual regenerate)
//   offline  => Cached (a network failure that keeps the last-known narrative + an offline chip + retry)
// Unlike a cache-then-network feed there is no automatic background refresh: re-running an LLM generation is
// an explicit, billable action, so the stale surface invites a manual regenerate rather than auto-refreshing
// (documented divergence from the templated "auto-refresh", Honesty Covenant #9). The web body carries no
// analysis window (`body: {}`), so unlike the sibling AIAnomalyExplanations there is no days parameter — the
// insights narrative is derived from the single drive identified by [SpeedProfileInsightsState.driveId].
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/AISpeedProfileInsights — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen is illegal in a package identifier), so the package intentionally diverges
// from the path — exactly as the sibling AIDriveCoaching / AIMLChargingCurveClustering surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aispeedprofileinsights

import io.teslasync.android.data.ErrorKind

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, drive id, or any
 * generated text, so a diagnostics line can never leak the operator's fleet state or the model output.
 */
const val AI_SPEED_PROFILE_INSIGHTS_SLUG: String = "AISpeedProfileInsights"

/**
 * How long a completed insights narrative is considered fresh before the surface flags it stale and invites a
 * manual regenerate. Five minutes mirrors the app's live-data staleness budget; it is generous because an LLM
 * narration of a single past drive's speed regime does not churn second-to-second.
 */
const val INSIGHTS_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

/** The useAiStream lifecycle, narrowed to what this surface reacts to (idle -> streaming -> done | failed). */
enum class InsightsPhase {
    /** No generation requested yet — the resting card with the Generate action (web `state === 'idle'`). */
    Idle,

    /** A stream is open; delta text accumulates until a terminal frame (web `state === 'streaming'`). */
    Streaming,

    /** The stream closed successfully — the accumulated text is the narrative (web `state === 'done'`). */
    Done,

    /** The stream ended in a terminal error frame or threw (web `state === 'error'`). */
    Failed,
}

/**
 * One parsed frame of the insights stream — the native narrowing of the web `AiStreamEvent` union that this
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
 * The immutable surface state the [AISpeedProfileInsightsViewModel] exposes. It carries the AI feature gate
 * (web `withAiFeature`), the selected drive (web InnerSection's `driveId` prop -> `canStart`), the stream
 * [phase], the in-flight [streamingText] accumulator, the last committed narrative ([committedText], kept
 * across a failed regenerate so an offline surface can still show last-known), the classified [errorKind], and
 * the completion [fetchedAt] stamp used for the freshness check.
 *
 * @property gateEnabled whether the AI feature is on (web `useAiEnabled('speed-profile-insights')`).
 * @property driveId the active drive (web prop); `null`/blank => the generate action is disabled.
 * @property phase the stream lifecycle phase.
 * @property streamingText the delta accumulator for the in-flight stream (web useAiStream `text`).
 * @property committedText the last successfully completed narrative, preserved for the offline surface.
 * @property errorKind the classification of the most recent failure, or `null`.
 * @property fetchedAt epoch-millis stamp of [committedText], or `null` when nothing has completed.
 */
data class SpeedProfileInsightsState(
    val gateEnabled: Boolean = true,
    val driveId: String? = null,
    val phase: InsightsPhase = InsightsPhase.Idle,
    val streamingText: String = "",
    val committedText: String = "",
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /** Web `canStart = !!driveId`: the generate action is available only with a non-empty drive id. */
    val canStart: Boolean get() = !driveId.isNullOrEmpty()

    /** True while a stream is open (drives the button's busy affordance + disables re-entry). */
    val isStreaming: Boolean get() = phase == InsightsPhase.Streaming
}

/**
 * Opens a fresh generation: enter [InsightsPhase.Streaming], clear the in-flight accumulator, and drop any
 * prior error. The last [SpeedProfileInsightsState.committedText] is intentionally retained (not shown while
 * streaming) so a failed regenerate can fall back to last-known — the web clears its visible text the same way
 * at `start()`, surfacing the thinking indicator until the first delta.
 */
fun SpeedProfileInsightsState.startGenerating(): SpeedProfileInsightsState =
    copy(phase = InsightsPhase.Streaming, streamingText = "", errorKind = null)

/** Reduces one parsed [AiStreamChunk] into the next state (delta accumulation / done / failure). */
fun SpeedProfileInsightsState.onChunk(
    chunk: AiStreamChunk,
    nowMs: Long,
): SpeedProfileInsightsState =
    when (chunk) {
        is AiStreamChunk.Delta -> copy(streamingText = streamingText + chunk.text)
        AiStreamChunk.Done -> markDone(nowMs)
        is AiStreamChunk.Failed -> markFailed(chunk.errorKind)
    }

/**
 * Commits the accumulated text as the narrative and stamps it for the freshness check. A blank result keeps a
 * blank [SpeedProfileInsightsState.committedText] so the surface renders its friendly empty state rather than
 * an empty box.
 */
fun SpeedProfileInsightsState.markDone(nowMs: Long): SpeedProfileInsightsState =
    copy(phase = InsightsPhase.Done, committedText = streamingText, fetchedAt = nowMs)

/** Marks the stream failed with the classified [kind]; the prior committed narrative is left intact. */
fun SpeedProfileInsightsState.markFailed(kind: ErrorKind): SpeedProfileInsightsState = copy(phase = InsightsPhase.Failed, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the
 * web hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the
 * thinking indicator.
 */
fun SpeedProfileInsightsState.finishIfStreaming(nowMs: Long): SpeedProfileInsightsState =
    if (phase == InsightsPhase.Streaming) markDone(nowMs) else this

/**
 * The render-ready classification of [SpeedProfileInsightsState] — a closed set of mutually-exclusive surfaces
 * the view switches on, so every branch is exhaustively covered and unit-tested off-device. Maps the stream
 * lifecycle onto the P3 loading / empty / content / error / stale / offline contract.
 */
sealed interface InsightsSurface {
    /** The AI feature is gated off — the whole surface collapses (web `withAiFeature` renders `null`). */
    data object Hidden : InsightsSurface

    /** Resting/idle: the card with the Generate action, enabled only when [canStart] (web `canStart`). */
    data class Resting(
        val canStart: Boolean,
    ) : InsightsSurface

    /** Streaming with no delta yet — the thinking indicator (the surface's loading state). */
    data object Working : InsightsSurface

    /** Streaming with partial text — the narrative rendering live as it arrives. */
    data class Live(
        val text: String,
    ) : InsightsSurface

    /** Completed with text — the narrative; [stale] flags a fetch older than the freshness window. */
    data class Ready(
        val text: String,
        val stale: Boolean,
    ) : InsightsSurface

    /** Completed but blank — a friendly empty state (the model returned nothing). */
    data object Empty : InsightsSurface

    /** Failed but a prior narrative exists — last-known kept visible; [offline] picks the chip/copy. */
    data class Cached(
        val text: String,
        val offline: Boolean,
    ) : InsightsSurface

    /** Failed with no last-known — a QueryError-equivalent with retry; [offline] picks the recovery copy. */
    data class Failed(
        val offline: Boolean,
    ) : InsightsSurface
}

/**
 * Selects the render-ready [InsightsSurface] for [state]. Pure (no Compose/clock): the caller supplies [nowMs]
 * and the [windowMs] freshness budget so the staleness decision is deterministic and testable.
 */
fun classifyInsights(
    state: SpeedProfileInsightsState,
    nowMs: Long,
    windowMs: Long = INSIGHTS_FRESHNESS_WINDOW_MS,
): InsightsSurface {
    if (!state.gateEnabled) return InsightsSurface.Hidden
    return when (state.phase) {
        InsightsPhase.Idle -> InsightsSurface.Resting(state.canStart)
        InsightsPhase.Streaming ->
            if (state.streamingText.isBlank()) {
                InsightsSurface.Working
            } else {
                InsightsSurface.Live(state.streamingText)
            }

        InsightsPhase.Done ->
            if (state.committedText.isBlank()) {
                InsightsSurface.Empty
            } else {
                InsightsSurface.Ready(state.committedText, isStale(state.fetchedAt, nowMs, windowMs))
            }

        InsightsPhase.Failed -> failedSurface(state)
    }
}

/** Failure -> last-known [InsightsSurface.Cached] when a prior narrative exists, else a hard failure. */
private fun failedSurface(state: SpeedProfileInsightsState): InsightsSurface {
    val offline = state.errorKind == ErrorKind.Network
    return if (state.committedText.isNotBlank()) {
        InsightsSurface.Cached(state.committedText, offline)
    } else {
        InsightsSurface.Failed(offline)
    }
}

/** True when a completed narrative stamped at [fetchedAt] is older than [windowMs] relative to [nowMs]. */
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
    surface: InsightsSurface,
    labels: InsightsOutputLabels,
): String? =
    when (surface) {
        InsightsSurface.Hidden, is InsightsSurface.Resting -> null
        InsightsSurface.Working, is InsightsSurface.Live -> labels.working
        InsightsSurface.Empty -> labels.empty
        is InsightsSurface.Ready -> if (surface.stale) "${labels.stale}. ${surface.text}" else surface.text
        is InsightsSurface.Cached -> "${if (surface.offline) labels.offline else labels.error}. ${surface.text}"
        is InsightsSurface.Failed -> labels.error
    }

/** The localized announcement fragments [outputAccessibilityLabel] composes — resolved by the view from i18n. */
data class InsightsOutputLabels(
    val working: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val error: String,
)
