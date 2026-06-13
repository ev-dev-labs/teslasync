// Pure, framework-free model + reducer + surface classifier for the AIFeedbackQueueTriage shared surface —
// the native analogue of everything the web component derives around its stream
// (web/src/components/ai/AIFeedbackQueueTriage.tsx → AIFeatureCard → AiOutputPanel, driven by useAiStream).
// No Compose, no Android UI, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web surface is `withAiFeature('feedback-queue-triage', InnerSection)`. InnerSection POSTs the in-scope
// `{feedback_id}` to `/ai/feedback/triage/draft` via useAiStream and feeds the accumulated delta text,
// lifecycle state, and error into AIFeatureCard. Its `canStart` is the web `haveFeedback` guard —
// `typeof feedbackId === 'number' && Number.isFinite(feedbackId) && feedbackId > 0` — so an absent or
// non-positive row id disables "Suggest triage". The HOC renders nothing when the AI feature is gated off
// (ai_mode off), so the canonical baseline this surface ships against is "gate off => nothing rendered" —
// reproduced here as [TriageSurface.Hidden] (Honesty Covenant #9: documented, not silent). Every other state
// renders a non-blank surface as the P3 contract requires.
//
// Propose-only baseline (web safety contract, verbatim from the source header): this advisor NEVER persists.
// The proposed status/category/priority is informational; the operator's deterministic manual triage controls
// (Status select, GitHub URL, Save, Forward) remain the sole write path via useUpdateFeedback(). This model
// therefore carries no mutation — it only reduces the draft stream onto a render contract.
//
// The useAiStream lifecycle (idle -> streaming -> done | error) is mapped onto the P3 state vocabulary:
//   loading  => Streaming with no delta yet ([TriageSurface.Working], a thinking indicator)
//   empty    => Idle ([TriageSurface.Resting], the resting card inviting a suggest) or a blank Done
//   content  => Live (streaming partial text) / Ready (completed proposal)
//   error    => Failed (no last-known) — a QueryError-equivalent with retry
//   stale    => Ready with a draft older than the freshness window (a stale chip + manual re-suggest)
//   offline  => Cached (a network failure that keeps the last-known proposal + an offline chip + retry)
// Unlike a cache-then-network feed there is no automatic background refresh: re-running an LLM draft is an
// explicit, billable action, so the stale surface invites a manual re-suggest rather than auto-refreshing
// (documented divergence from the templated "auto-refresh", Honesty Covenant #9).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling AIChargingDiagnosis / AIAnomalyExplanations surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aifeedbackqueuetriage

import io.teslasync.android.data.ErrorKind

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no feedback id, reporter
 * envelope, or any generated text, so a diagnostics line can never leak the operator's queue or the model output.
 */
const val AI_FEEDBACK_QUEUE_TRIAGE_SLUG: String = "AIFeedbackQueueTriage"

/**
 * How long a completed triage draft is considered fresh before the surface flags it stale and invites a manual
 * re-suggest. Five minutes mirrors the app's live-data staleness budget; it is generous because an LLM triage
 * proposal for a single feedback row does not churn second-to-second.
 */
const val TRIAGE_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

/** The useAiStream lifecycle, narrowed to what this surface reacts to (idle -> streaming -> done | failed). */
enum class TriagePhase {
    /** No draft requested yet — the resting card with the Suggest action (web `state === 'idle'`). */
    Idle,

    /** A stream is open; delta text accumulates until a terminal frame (web `state === 'streaming'`). */
    Streaming,

    /** The stream closed successfully — the accumulated text is the proposal (web `state === 'done'`). */
    Done,

    /** The stream ended in a terminal error frame or threw (web `state === 'error'`). */
    Failed,
}

/**
 * One parsed frame of the draft stream — the native narrowing of the web `AiStreamEvent` union that this
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
 * The immutable surface state the [AIFeedbackQueueTriageViewModel] exposes. It carries the AI feature gate
 * (web `withAiFeature`), the selected feedback row (web InnerSection's `feedbackId` prop -> `canStart`), the
 * stream [phase], the in-flight [streamingText] accumulator, the last committed proposal ([committedText],
 * kept across a failed re-suggest so an offline surface can still show last-known), the classified [errorKind],
 * and the completion [fetchedAt] stamp used for the freshness check.
 *
 * @property gateEnabled whether the AI feature is on (web `useAiEnabled('feedback-queue-triage')`).
 * @property feedbackId the active feedback row id (web prop); `null`/non-positive => the suggest action is off.
 * @property phase the stream lifecycle phase.
 * @property streamingText the delta accumulator for the in-flight stream (web useAiStream `text`).
 * @property committedText the last successfully completed proposal, preserved for the offline surface.
 * @property errorKind the classification of the most recent failure, or `null`.
 * @property fetchedAt epoch-millis stamp of [committedText], or `null` when nothing has completed.
 */
data class AiTriageState(
    val gateEnabled: Boolean = true,
    val feedbackId: Long? = null,
    val phase: TriagePhase = TriagePhase.Idle,
    val streamingText: String = "",
    val committedText: String = "",
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /**
     * Web `canStart = haveFeedback` (`typeof feedbackId === 'number' && Number.isFinite(feedbackId) &&
     * feedbackId > 0`): the suggest action is available only with a finite, positive row id. A Kotlin [Long]
     * is always finite, so the guard reduces to a non-null, positive id.
     */
    val canStart: Boolean get() = feedbackId != null && feedbackId > 0

    /** True while a stream is open (drives the button's busy affordance + disables re-entry). */
    val isStreaming: Boolean get() = phase == TriagePhase.Streaming
}

/**
 * Opens a fresh draft: enter [TriagePhase.Streaming], clear the in-flight accumulator, and drop any prior
 * error. The last [AiTriageState.committedText] is intentionally retained (not shown while streaming) so a
 * failed re-suggest can fall back to last-known — the web clears its visible text the same way at `start()`,
 * surfacing the thinking indicator until the first delta.
 */
fun AiTriageState.startDrafting(): AiTriageState = copy(phase = TriagePhase.Streaming, streamingText = "", errorKind = null)

/** Reduces one parsed [AiStreamChunk] into the next state (delta accumulation / done / failure). */
fun AiTriageState.onChunk(
    chunk: AiStreamChunk,
    nowMs: Long,
): AiTriageState =
    when (chunk) {
        is AiStreamChunk.Delta -> copy(streamingText = streamingText + chunk.text)
        AiStreamChunk.Done -> markDone(nowMs)
        is AiStreamChunk.Failed -> markFailed(chunk.errorKind)
    }

/**
 * Commits the accumulated text as the proposal and stamps it for the freshness check. A blank result keeps a
 * blank [AiTriageState.committedText] so the surface renders its friendly empty state rather than an empty box.
 */
fun AiTriageState.markDone(nowMs: Long): AiTriageState = copy(phase = TriagePhase.Done, committedText = streamingText, fetchedAt = nowMs)

/** Marks the stream failed with the classified [kind]; the prior committed proposal is left intact. */
fun AiTriageState.markFailed(kind: ErrorKind): AiTriageState = copy(phase = TriagePhase.Failed, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the
 * web hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the
 * thinking indicator.
 */
fun AiTriageState.finishIfStreaming(nowMs: Long): AiTriageState = if (phase == TriagePhase.Streaming) markDone(nowMs) else this

/**
 * The render-ready classification of [AiTriageState] — a closed set of mutually-exclusive surfaces the view
 * switches on, so every branch is exhaustively covered and unit-tested off-device. Maps the stream lifecycle
 * onto the P3 loading / empty / content / error / stale / offline contract.
 */
sealed interface TriageSurface {
    /** The AI feature is gated off — the whole surface collapses (web `withAiFeature` renders `null`). */
    data object Hidden : TriageSurface

    /** Resting/idle: the card with the Suggest action, enabled only when [canStart] (web `canStart`). */
    data class Resting(
        val canStart: Boolean,
    ) : TriageSurface

    /** Streaming with no delta yet — the thinking indicator (the surface's loading state). */
    data object Working : TriageSurface

    /** Streaming with partial text — the proposal rendering live as it arrives. */
    data class Live(
        val text: String,
    ) : TriageSurface

    /** Completed with text — the proposal; [stale] flags a draft older than the freshness window. */
    data class Ready(
        val text: String,
        val stale: Boolean,
    ) : TriageSurface

    /** Completed but blank — a friendly empty state (the model returned nothing). */
    data object Empty : TriageSurface

    /** Failed but a prior proposal exists — last-known kept visible; [offline] picks the chip/copy. */
    data class Cached(
        val text: String,
        val offline: Boolean,
    ) : TriageSurface

    /** Failed with no last-known — a QueryError-equivalent with retry; [offline] picks the recovery copy. */
    data class Failed(
        val offline: Boolean,
    ) : TriageSurface
}

/**
 * Selects the render-ready [TriageSurface] for [state]. Pure (no Compose/clock): the caller supplies [nowMs]
 * and the [windowMs] freshness budget so the staleness decision is deterministic and testable.
 */
fun classifyTriage(
    state: AiTriageState,
    nowMs: Long,
    windowMs: Long = TRIAGE_FRESHNESS_WINDOW_MS,
): TriageSurface {
    if (!state.gateEnabled) return TriageSurface.Hidden
    return when (state.phase) {
        TriagePhase.Idle -> TriageSurface.Resting(state.canStart)
        TriagePhase.Streaming ->
            if (state.streamingText.isBlank()) {
                TriageSurface.Working
            } else {
                TriageSurface.Live(state.streamingText)
            }

        TriagePhase.Done ->
            if (state.committedText.isBlank()) {
                TriageSurface.Empty
            } else {
                TriageSurface.Ready(state.committedText, isStale(state.fetchedAt, nowMs, windowMs))
            }

        TriagePhase.Failed -> failedSurface(state)
    }
}

/** Failure -> last-known [TriageSurface.Cached] when a prior proposal exists, else a hard failure. */
private fun failedSurface(state: AiTriageState): TriageSurface {
    val offline = state.errorKind == ErrorKind.Network
    return if (state.committedText.isNotBlank()) {
        TriageSurface.Cached(state.committedText, offline)
    } else {
        TriageSurface.Failed(offline)
    }
}

/** True when a completed proposal stamped at [fetchedAt] is older than [windowMs] relative to [nowMs]. */
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
    surface: TriageSurface,
    labels: TriageOutputLabels,
): String? =
    when (surface) {
        TriageSurface.Hidden, is TriageSurface.Resting -> null
        TriageSurface.Working, is TriageSurface.Live -> labels.working
        TriageSurface.Empty -> labels.empty
        is TriageSurface.Ready -> if (surface.stale) "${labels.stale}. ${surface.text}" else surface.text
        is TriageSurface.Cached -> "${if (surface.offline) labels.offline else labels.error}. ${surface.text}"
        is TriageSurface.Failed -> labels.error
    }

/** The localized announcement fragments [outputAccessibilityLabel] composes — resolved by the view from i18n. */
data class TriageOutputLabels(
    val working: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val error: String,
)
