// Pure, framework-free model + reducer + surface classifier for the AILifetimeStatsQA shared surface —
// the native analogue of everything the web component derives around its stream
// (web/src/components/ai/AILifetimeStatsQA.tsx → AIFeatureCard → AiOutputPanel, driven by useAiStream).
// No Compose, no Android UI, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web surface is `withAiFeature('lifetime-stats-qa', InnerSection)`. InnerSection POSTs
// { vehicle_id, question } to `/ai/analytics/lifetime/qa` via useAiStream and feeds the accumulated delta
// text, lifecycle state, and error into AIFeatureCard, with a Textarea prompt rendered as the inputSlot.
// The [AiQaState.question] is the user's free-text query, capped at [MAX_QUESTION_CHARS] (the web `maxLength`
// mirror of the backend's aiLifetimeStatsQAMaxQuestionChars cap), and the Ask action is enabled only when a
// vehicle is in scope AND the trimmed question is non-empty and within the cap — the native analogue of the
// web `canStart={haveVehicle && haveQuestion}`. The HOC renders nothing when the AI feature is gated off
// (ai_mode off), so the canonical baseline this surface ships against is "gate off => nothing rendered",
// reproduced here as [QaSurface.Hidden] (Honesty Covenant #9: documented, not silent). Every other state
// renders a non-blank surface as the P3 contract requires.
//
// The useAiStream lifecycle (idle -> streaming -> done | error) is mapped onto the P3 state vocabulary:
//   loading  => Streaming with no delta yet ([QaSurface.Working], a thinking indicator)
//   empty    => Idle ([QaSurface.Resting], the resting card with the question form) or a blank Done
//   content  => Live (streaming partial answer) / Ready (completed answer)
//   error    => Failed (no last-known) — a QueryError-equivalent with retry
//   stale    => Ready with a fetch older than the freshness window (a stale chip + manual re-ask)
//   offline  => Cached (a network failure that keeps the last-known answer + an offline chip + retry)
// Re-running an LLM answer is an explicit, billable action, so the stale surface invites a manual re-ask
// rather than auto-refreshing (documented divergence from the templated "auto-refresh", Honesty Covenant #9).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling AICostForecastNarration / AIAnomalyExplanations surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ailifetimestatsqa

import io.teslasync.android.data.ErrorKind

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, vehicle id, or any
 * question/answer text, so a diagnostics line can never leak the operator's fleet state or the model output.
 */
const val AI_LIFETIME_STATS_QA_SLUG: String = "AILifetimeStatsQA"

/**
 * The maximum question length the Ask action will submit — the native mirror of the web `MaxQuestionChars`
 * constant, which itself mirrors the backend handler's `aiLifetimeStatsQAMaxQuestionChars` cap so a
 * parser-rejection 400 never reaches the user. Keep these in sync with the web + backend constants.
 */
const val MAX_QUESTION_CHARS: Int = 1024

/**
 * How long a completed answer is considered fresh before the surface flags it stale and invites a manual
 * re-ask. Five minutes mirrors the app's live-data staleness budget; it is generous because an LLM answer
 * grounded in all-time stats does not churn second-to-second.
 */
const val QA_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

/** The useAiStream lifecycle, narrowed to what this surface reacts to (idle -> streaming -> done | failed). */
enum class QaPhase {
    /** No question submitted yet — the resting card with the question form (web `state === 'idle'`). */
    Idle,

    /** A stream is open; delta text accumulates until a terminal frame (web `state === 'streaming'`). */
    Streaming,

    /** The stream closed successfully — the accumulated text is the answer (web `state === 'done'`). */
    Done,

    /** The stream ended in a terminal error frame or threw (web `state === 'error'`). */
    Failed,
}

/**
 * One parsed frame of the answer stream — the native narrowing of the web `AiStreamEvent` union this surface
 * consumes. Delta frames accumulate text; [Done] closes the stream successfully; [Failed] carries the
 * classified transport/HTTP failure so the render boundary can localize it (never the raw provider message).
 */
sealed interface AiQaChunk {
    /** A `delta` frame — a chunk of generated answer appended to the accumulator (web `delta.text`). */
    data class Delta(
        val text: String,
    ) : AiQaChunk

    /** The terminal `done` frame — the stream finished cleanly. */
    data object Done : AiQaChunk

    /** A terminal `error` frame — carries the [ErrorKind] the UI maps to localized recovery copy. */
    data class Failed(
        val errorKind: ErrorKind,
    ) : AiQaChunk
}

/**
 * The immutable surface state the [AILifetimeStatsQAViewModel] exposes. It carries the AI feature gate (web
 * `withAiFeature`), the selected vehicle (web InnerSection's `vehicleId` prop), the in-progress [question]
 * input (web `useState('')` + Textarea), the stream [phase], the in-flight [streamingText] accumulator, the
 * last committed answer ([committedText], kept across a failed re-ask so an offline surface can still show
 * last-known), the classified [errorKind], and the completion [fetchedAt] stamp used for the freshness check.
 *
 * @property gateEnabled whether the AI feature is on (web `useAiEnabled('lifetime-stats-qa')`).
 * @property vehicleId the active vehicle (web prop); `null` => the Ask action is disabled.
 * @property question the raw question input, already capped to [MAX_QUESTION_CHARS] by [capQuestion].
 * @property phase the stream lifecycle phase.
 * @property streamingText the delta accumulator for the in-flight stream (web useAiStream `text`).
 * @property committedText the last successfully completed answer, preserved for the offline surface.
 * @property errorKind the classification of the most recent failure, or `null`.
 * @property fetchedAt epoch-millis stamp of [committedText], or `null` when nothing has completed.
 */
data class AiQaState(
    val gateEnabled: Boolean = true,
    val vehicleId: Long? = null,
    val question: String = "",
    val phase: QaPhase = QaPhase.Idle,
    val streamingText: String = "",
    val committedText: String = "",
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /** Web `trimmedQuestion = question.trim()` — the value actually submitted + validated. */
    val trimmedQuestion: String get() = question.trim()

    /** Web `haveVehicle = Number.isFinite(numericVehicleId) && numericVehicleId > 0`. */
    val haveVehicle: Boolean get() = vehicleId != null

    /** Web `haveQuestion = trimmed.length > 0 && trimmed.length <= MaxQuestionChars`. */
    val haveQuestion: Boolean get() = trimmedQuestion.isNotEmpty() && trimmedQuestion.length <= MAX_QUESTION_CHARS

    /** Web `canStart={haveVehicle && haveQuestion}`: the Ask action is available only with both inputs. */
    val canStart: Boolean get() = haveVehicle && haveQuestion

    /** True while a stream is open (drives the button's busy affordance + disables re-entry). */
    val isStreaming: Boolean get() = phase == QaPhase.Streaming
}

/**
 * Mirrors the web Textarea `maxLength={MaxQuestionChars}` hard input cap: a longer value is truncated to the
 * first [MAX_QUESTION_CHARS] characters so the state never holds an over-cap question (which would 400).
 */
fun capQuestion(value: String): String = if (value.length > MAX_QUESTION_CHARS) value.substring(0, MAX_QUESTION_CHARS) else value

/**
 * Opens a fresh ask: enter [QaPhase.Streaming], clear the in-flight accumulator, and drop any prior error.
 * The last [AiQaState.committedText] is intentionally retained (not shown while streaming) so a failed re-ask
 * can fall back to last-known — the web clears its visible text the same way at `start()`, surfacing the
 * thinking indicator until the first delta.
 */
fun AiQaState.startAsking(): AiQaState = copy(phase = QaPhase.Streaming, streamingText = "", errorKind = null)

/** Reduces one parsed [AiQaChunk] into the next state (delta accumulation / done / failure). */
fun AiQaState.onChunk(
    chunk: AiQaChunk,
    nowMs: Long,
): AiQaState =
    when (chunk) {
        is AiQaChunk.Delta -> copy(streamingText = streamingText + chunk.text)
        AiQaChunk.Done -> markDone(nowMs)
        is AiQaChunk.Failed -> markFailed(chunk.errorKind)
    }

/**
 * Commits the accumulated text as the answer and stamps it for the freshness check. A blank result keeps a
 * blank [AiQaState.committedText] so the surface renders its friendly empty state rather than an empty box.
 */
fun AiQaState.markDone(nowMs: Long): AiQaState = copy(phase = QaPhase.Done, committedText = streamingText, fetchedAt = nowMs)

/** Marks the stream failed with the classified [kind]; the prior committed answer is left intact. */
fun AiQaState.markFailed(kind: ErrorKind): AiQaState = copy(phase = QaPhase.Failed, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the
 * web hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the
 * thinking indicator.
 */
fun AiQaState.finishIfStreaming(nowMs: Long): AiQaState = if (phase == QaPhase.Streaming) markDone(nowMs) else this

/**
 * The render-ready classification of [AiQaState] — a closed set of mutually-exclusive surfaces the view
 * switches on, so every branch is exhaustively covered and unit-tested off-device. Maps the stream lifecycle
 * onto the P3 loading / empty / content / error / stale / offline contract.
 */
sealed interface QaSurface {
    /** The AI feature is gated off — the whole surface collapses (web `withAiFeature` renders `null`). */
    data object Hidden : QaSurface

    /** Resting/idle: the card with the question form, the Ask action enabled only when [canStart]. */
    data class Resting(
        val canStart: Boolean,
    ) : QaSurface

    /** Streaming with no delta yet — the thinking indicator (the surface's loading state). */
    data object Working : QaSurface

    /** Streaming with partial text — the answer rendering live as it arrives. */
    data class Live(
        val text: String,
    ) : QaSurface

    /** Completed with text — the answer; [stale] flags a fetch older than the freshness window. */
    data class Ready(
        val text: String,
        val stale: Boolean,
    ) : QaSurface

    /** Completed but blank — a friendly empty state (the model returned nothing). */
    data object Empty : QaSurface

    /** Failed but a prior answer exists — last-known kept visible; [offline] picks the chip/copy. */
    data class Cached(
        val text: String,
        val offline: Boolean,
    ) : QaSurface

    /** Failed with no last-known — a QueryError-equivalent with retry; [offline] picks the recovery copy. */
    data class Failed(
        val offline: Boolean,
    ) : QaSurface
}

/**
 * Selects the render-ready [QaSurface] for [state]. Pure (no Compose/clock): the caller supplies [nowMs] and
 * the [windowMs] freshness budget so the staleness decision is deterministic and testable.
 */
fun classifyQa(
    state: AiQaState,
    nowMs: Long,
    windowMs: Long = QA_FRESHNESS_WINDOW_MS,
): QaSurface {
    if (!state.gateEnabled) return QaSurface.Hidden
    return when (state.phase) {
        QaPhase.Idle -> QaSurface.Resting(state.canStart)
        QaPhase.Streaming ->
            if (state.streamingText.isBlank()) {
                QaSurface.Working
            } else {
                QaSurface.Live(state.streamingText)
            }

        QaPhase.Done ->
            if (state.committedText.isBlank()) {
                QaSurface.Empty
            } else {
                QaSurface.Ready(state.committedText, isStale(state.fetchedAt, nowMs, windowMs))
            }

        QaPhase.Failed -> failedSurface(state)
    }
}

/** Failure -> last-known [QaSurface.Cached] when a prior answer exists, else a hard failure. */
private fun failedSurface(state: AiQaState): QaSurface {
    val offline = state.errorKind == ErrorKind.Network
    return if (state.committedText.isNotBlank()) {
        QaSurface.Cached(state.committedText, offline)
    } else {
        QaSurface.Failed(offline)
    }
}

/** True when a completed answer stamped at [fetchedAt] is older than [windowMs] relative to [nowMs]. */
fun isStale(
    fetchedAt: Long?,
    nowMs: Long,
    windowMs: Long,
): Boolean = fetchedAt != null && nowMs - fetchedAt > windowMs

/**
 * Builds the merged accessibility description for the card header from already-localized parts (web reads the
 * title, the "Helix" badge, and the description as one block). Kept pure so TalkBack-label presence is
 * unit-tested without a Compose host.
 */
fun headerAccessibilityLabel(
    title: String,
    badge: String,
    description: String,
): String = "$title ($badge). $description"

/**
 * Builds the accessibility description for the output region per [surface] from already-localized parts, or
 * `null` when the output region carries no announcement (the resting/hidden surfaces, whose card chrome and
 * question form are announced instead). Pure so the per-state a11y labels are unit-tested off-device.
 */
fun outputAccessibilityLabel(
    surface: QaSurface,
    labels: QaOutputLabels,
): String? =
    when (surface) {
        QaSurface.Hidden, is QaSurface.Resting -> null
        QaSurface.Working, is QaSurface.Live -> labels.working
        QaSurface.Empty -> labels.empty
        is QaSurface.Ready -> if (surface.stale) "${labels.stale}. ${surface.text}" else surface.text
        is QaSurface.Cached -> "${if (surface.offline) labels.offline else labels.error}. ${surface.text}"
        is QaSurface.Failed -> labels.error
    }

/** The localized announcement fragments [outputAccessibilityLabel] composes — resolved by the view from i18n. */
data class QaOutputLabels(
    val working: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val error: String,
)
