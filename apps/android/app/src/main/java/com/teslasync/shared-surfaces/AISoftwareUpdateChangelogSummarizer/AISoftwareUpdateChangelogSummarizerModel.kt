// Pure, framework-free model + reducer + surface classifier for the AISoftwareUpdateChangelogSummarizer shared
// surface — the native analogue of everything the web component derives around its stream
// (web/src/components/ai/AISoftwareUpdateChangelogSummarizer.tsx → AIFeatureCard → AiOutputPanel, driven by
// useAiStream). No Compose, no Android UI, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer (ADR-002).
//
// The web surface is `withAiFeature('software-update-changelog-summarizer', InnerSection)`. InnerSection POSTs
// { vehicle_id } to `/ai/software-updates/summarize` via useAiStream and feeds the accumulated delta text,
// lifecycle state, and error into AIFeatureCard. The HOC renders nothing when the AI feature is gated off
// (ai_mode off / the per-feature toggle off), so the canonical baseline this surface ships against is
// "gate off => nothing rendered" — reproduced here as [SummarySurface.Hidden] (Honesty Covenant #9: documented,
// not silent). Every other state renders a non-blank surface as the P3 contract requires.
//
// The useAiStream lifecycle (idle -> streaming -> done | error) is mapped onto the P3 state vocabulary:
//   loading  => Streaming with no delta yet ([SummarySurface.Working], a thinking indicator)
//   empty    => Idle ([SummarySurface.Resting], the resting card inviting a summarize) or a blank Done
//   content  => Live (streaming partial text) / Ready (completed summary)
//   error    => Failed (no last-known) — a QueryError-equivalent with retry
//   stale    => Ready with a fetch older than the freshness window (a stale chip + manual regenerate)
//   offline  => Cached (a network failure that keeps the last-known summary + an offline chip + retry)
// Unlike a cache-then-network feed there is no automatic background refresh: re-running an LLM generation is an
// explicit, billable action, so the stale surface invites a manual regenerate rather than auto-refreshing
// (documented divergence from the templated "auto-refresh", Honesty Covenant #9).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling AIDigestNarration / AICostForecastNarration surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aisoftwareupdatechangelogsummarizer

import io.teslasync.android.data.ErrorKind

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, vehicle id, or any
 * generated text, so a diagnostics line can never leak the operator's fleet state or the model output.
 */
const val AI_SOFTWARE_UPDATE_CHANGELOG_SUMMARIZER_SLUG: String = "AISoftwareUpdateChangelogSummarizer"

/**
 * How long a completed summary is considered fresh before the surface flags it stale and invites a manual
 * regenerate. Five minutes mirrors the app's live-data staleness budget; it is generous because an LLM recap of
 * a firmware-update history does not churn second-to-second.
 */
const val CHANGELOG_SUMMARY_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

/** The useAiStream lifecycle, narrowed to what this surface reacts to (idle -> streaming -> done | failed). */
enum class SummaryPhase {
    /** No generation requested yet — the resting card with the Summarize action (web `state === 'idle'`). */
    Idle,

    /** A stream is open; delta text accumulates until a terminal frame (web `state === 'streaming'`). */
    Streaming,

    /** The stream closed successfully — the accumulated text is the summary (web `state === 'done'`). */
    Done,

    /** The stream ended in a terminal error frame or threw (web `state === 'error'`). */
    Failed,
}

/**
 * One parsed frame of the summarize stream — the native narrowing of the web `AiStreamEvent` union this surface
 * consumes. Delta frames accumulate text; [Done] closes the stream successfully; [Failed] carries the classified
 * transport/HTTP failure so the render boundary can localize it (never the raw provider message).
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
 * The immutable surface state the [AISoftwareUpdateChangelogSummarizerViewModel] exposes. It carries the AI
 * feature gate (web `withAiFeature`), the selected vehicle (web InnerSection's `vehicleId` prop -> `haveInputs`),
 * the stream [phase], the in-flight [streamingText] accumulator, the last committed summary ([committedText],
 * kept across a failed regenerate so an offline surface can still show last-known), the classified [errorKind],
 * and the completion [fetchedAt] stamp used for the freshness check.
 *
 * @property gateEnabled whether the AI feature is on (web `useAiEnabled('software-update-changelog-summarizer')`).
 * @property vehicleId the active vehicle (web prop); `null` => the summarize action is disabled.
 * @property phase the stream lifecycle phase.
 * @property streamingText the delta accumulator for the in-flight stream (web useAiStream `text`).
 * @property committedText the last successfully completed summary, preserved for the offline surface.
 * @property errorKind the classification of the most recent failure, or `null`.
 * @property fetchedAt epoch-millis stamp of [committedText], or `null` when nothing has completed.
 */
data class ChangelogSummaryState(
    val gateEnabled: Boolean = true,
    val vehicleId: Long? = null,
    val phase: SummaryPhase = SummaryPhase.Idle,
    val streamingText: String = "",
    val committedText: String = "",
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /**
     * Web `haveInputs = numericVehicleId > 0`: the summarize action is available only with a selected vehicle.
     * Mirrors the handler-side `vehicle_id > 0` validation the web InnerSection echoes.
     */
    val canStart: Boolean get() = vehicleId != null && vehicleId > 0L

    /** True while a stream is open (drives the button's busy affordance + disables re-entry). */
    val isStreaming: Boolean get() = phase == SummaryPhase.Streaming
}

/**
 * Opens a fresh generation: enter [SummaryPhase.Streaming], clear the in-flight accumulator, and drop any prior
 * error. The last [ChangelogSummaryState.committedText] is intentionally retained (not shown while streaming) so
 * a failed regenerate can fall back to last-known — the web clears its visible text the same way at `start()`,
 * surfacing the thinking indicator until the first delta.
 */
fun ChangelogSummaryState.startGenerating(): ChangelogSummaryState =
    copy(phase = SummaryPhase.Streaming, streamingText = "", errorKind = null)

/** Reduces one parsed [AiStreamChunk] into the next state (delta accumulation / done / failure). */
fun ChangelogSummaryState.onChunk(
    chunk: AiStreamChunk,
    nowMs: Long,
): ChangelogSummaryState =
    when (chunk) {
        is AiStreamChunk.Delta -> copy(streamingText = streamingText + chunk.text)
        AiStreamChunk.Done -> markDone(nowMs)
        is AiStreamChunk.Failed -> markFailed(chunk.errorKind)
    }

/**
 * Commits the accumulated text as the summary and stamps it for the freshness check. A blank result keeps a
 * blank [ChangelogSummaryState.committedText] so the surface renders its friendly empty state rather than an
 * empty box.
 */
fun ChangelogSummaryState.markDone(nowMs: Long): ChangelogSummaryState =
    copy(phase = SummaryPhase.Done, committedText = streamingText, fetchedAt = nowMs)

/** Marks the stream failed with the classified [kind]; the prior committed summary is left intact. */
fun ChangelogSummaryState.markFailed(kind: ErrorKind): ChangelogSummaryState = copy(phase = SummaryPhase.Failed, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the web
 * hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the
 * thinking indicator.
 */
fun ChangelogSummaryState.finishIfStreaming(nowMs: Long): ChangelogSummaryState =
    if (phase == SummaryPhase.Streaming) markDone(nowMs) else this

/**
 * The render-ready classification of [ChangelogSummaryState] — a closed set of mutually-exclusive surfaces the
 * view switches on, so every branch is exhaustively covered and unit-tested off-device. Maps the stream
 * lifecycle onto the P3 loading / empty / content / error / stale / offline contract.
 */
sealed interface SummarySurface {
    /** The AI feature is gated off — the whole surface collapses (web `withAiFeature` renders `null`). */
    data object Hidden : SummarySurface

    /** Resting/idle: the card with the Summarize action, enabled only when [canStart] (web `haveInputs`). */
    data class Resting(
        val canStart: Boolean,
    ) : SummarySurface

    /** Streaming with no delta yet — the thinking indicator (the surface's loading state). */
    data object Working : SummarySurface

    /** Streaming with partial text — the summary rendering live as it arrives. */
    data class Live(
        val text: String,
    ) : SummarySurface

    /** Completed with text — the summary; [stale] flags a fetch older than the freshness window. */
    data class Ready(
        val text: String,
        val stale: Boolean,
    ) : SummarySurface

    /** Completed but blank — a friendly empty state (the model returned nothing). */
    data object Empty : SummarySurface

    /** Failed but a prior summary exists — last-known kept visible; [offline] picks the chip/copy. */
    data class Cached(
        val text: String,
        val offline: Boolean,
    ) : SummarySurface

    /** Failed with no last-known — a QueryError-equivalent with retry; [offline] picks the recovery copy. */
    data class Failed(
        val offline: Boolean,
    ) : SummarySurface
}

/**
 * Selects the render-ready [SummarySurface] for [state]. Pure (no Compose/clock): the caller supplies [nowMs]
 * and the [windowMs] freshness budget so the staleness decision is deterministic and testable.
 */
fun classifySummary(
    state: ChangelogSummaryState,
    nowMs: Long,
    windowMs: Long = CHANGELOG_SUMMARY_FRESHNESS_WINDOW_MS,
): SummarySurface {
    if (!state.gateEnabled) return SummarySurface.Hidden
    return when (state.phase) {
        SummaryPhase.Idle -> SummarySurface.Resting(state.canStart)
        SummaryPhase.Streaming ->
            if (state.streamingText.isBlank()) {
                SummarySurface.Working
            } else {
                SummarySurface.Live(state.streamingText)
            }

        SummaryPhase.Done ->
            if (state.committedText.isBlank()) {
                SummarySurface.Empty
            } else {
                SummarySurface.Ready(state.committedText, isStale(state.fetchedAt, nowMs, windowMs))
            }

        SummaryPhase.Failed -> failedSurface(state)
    }
}

/** Failure -> last-known [SummarySurface.Cached] when a prior summary exists, else a hard failure. */
private fun failedSurface(state: ChangelogSummaryState): SummarySurface {
    val offline = state.errorKind == ErrorKind.Network
    return if (state.committedText.isNotBlank()) {
        SummarySurface.Cached(state.committedText, offline)
    } else {
        SummarySurface.Failed(offline)
    }
}

/** True when a completed summary stamped at [fetchedAt] is older than [windowMs] relative to [nowMs]. */
fun isStale(
    fetchedAt: Long?,
    nowMs: Long,
    windowMs: Long,
): Boolean = fetchedAt != null && nowMs - fetchedAt > windowMs

/**
 * Builds the merged accessibility description for the card header from already-localized parts (web reads the
 * title, the "Helix" badge, the description, and — when no vehicle is selected — the empty hint as one block).
 * [noVehicleHint] is appended only when present (web renders it only while `!canStart`). Kept pure so
 * TalkBack-label presence is unit-tested without a Compose host.
 */
fun headerAccessibilityLabel(
    title: String,
    badge: String,
    description: String,
    noVehicleHint: String? = null,
): String {
    val base = "$title ($badge). $description"
    return if (noVehicleHint != null) "$base $noVehicleHint" else base
}

/**
 * Builds the accessibility description for the output region per [surface] from already-localized parts, or
 * `null` when the output region carries no announcement (the resting/hidden surfaces, whose card chrome is
 * announced instead). Pure so the per-state a11y labels are unit-tested off-device.
 */
fun outputAccessibilityLabel(
    surface: SummarySurface,
    labels: SummaryOutputLabels,
): String? =
    when (surface) {
        SummarySurface.Hidden, is SummarySurface.Resting -> null
        SummarySurface.Working, is SummarySurface.Live -> labels.working
        SummarySurface.Empty -> labels.empty
        is SummarySurface.Ready -> if (surface.stale) joinAnnouncement(labels.stale, surface.text) else surface.text
        is SummarySurface.Cached -> joinAnnouncement(if (surface.offline) labels.offline else labels.error, surface.text)
        is SummarySurface.Failed -> labels.error
    }

/**
 * Joins an announcement [prefix] (a status label) with a [body] into one TalkBack utterance. A prefix that
 * already ends in sentence punctuation ('.', '!', '?') is followed by a single space so the announcement never
 * doubles a period — the localized summary error is a full sentence, while the offline/stale chips are bare
 * words that take the inserted ". ".
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
data class SummaryOutputLabels(
    val working: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val error: String,
)
