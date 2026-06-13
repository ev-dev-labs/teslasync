// Pure, framework-free model + reducer + surface classifier for the AIRAGHelp shared surface — the native
// analogue of everything the web component derives around its stream
// (web/src/components/ai/AIRAGHelp.tsx → withAiFeature('rag-help', …) → AIFeatureCard → AiOutputPanel, driven
// by useAiStream). No Compose, no Android UI, no HTTP: every declaration here is unit-tested off-device in the
// :app:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web surface POSTs { prompt } to `/ai/help/query` via useAiStream and feeds the accumulated delta text,
// lifecycle state, and error into AIFeatureCard. Its action is gated on a non-empty prompt
// (web `canStart = prompt.trim().length > 0`) — the native difference from the sibling AIDigestNarration,
// whose action is gated on a selected vehicle. The HOC renders nothing when the AI feature is gated off
// (ai_mode off), so the canonical baseline this surface ships against is "gate off => nothing rendered" —
// reproduced here as [HelpAnswerSurface.Hidden] (Honesty Covenant #9: documented, not silent). Every other
// state renders a non-blank surface as the P3 contract requires.
//
// The useAiStream lifecycle (idle -> streaming -> done | error) is mapped onto the P3 state vocabulary:
//   loading  => Streaming with no delta yet ([HelpAnswerSurface.Working], a thinking indicator)
//   empty    => Idle ([HelpAnswerSurface.Resting], the resting card inviting a question) or a blank Done
//   content  => Live (streaming partial answer) / Ready (completed answer)
//   error    => Failed (no last-known) — a QueryError-equivalent with retry
//   stale    => Ready with a fetch older than the freshness window (a stale chip + manual re-ask)
//   offline  => Cached (a network failure that keeps the last-known answer + an offline chip + retry)
// Unlike a cache-then-network feed there is no automatic background refresh: re-running a RAG query is an
// explicit, billable LLM action, so the stale surface invites a manual re-ask rather than auto-refreshing
// (documented divergence from the templated "auto-refresh", Honesty Covenant #9). This mirrors the sibling
// AIDigestNarration surface so the two AI cards behave identically.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling AIDigestNarration / AIAnomalyExplanations surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.airaghelp

import io.teslasync.android.data.ErrorKind

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no prompt text, VIN, or any
 * generated answer, so a diagnostics line can never leak the operator's question or the model output.
 */
const val AI_RAG_HELP_SLUG: String = "AIRAGHelp"

/**
 * The AI-feature id this surface is gated behind (web `withAiFeature('rag-help', …)`). The host wires the
 * shared S8 AI-mode gate for this id into [AIRAGHelpSource.aiEnabled]; when off the surface collapses.
 */
const val RAG_HELP_FEATURE_ID: String = "rag-help"

/**
 * How long a completed answer is considered fresh before the surface flags it stale and invites a manual
 * re-ask. Five minutes mirrors the app's live-data staleness budget; it is generous because a RAG answer does
 * not churn second-to-second.
 */
const val RAG_HELP_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

/** The useAiStream lifecycle, narrowed to what this surface reacts to (idle -> streaming -> done | failed). */
enum class HelpAnswerPhase {
    /** No question asked yet — the resting card with the Ask action (web `state === 'idle'`). */
    Idle,

    /** A stream is open; delta text accumulates until a terminal frame (web `state === 'streaming'`). */
    Streaming,

    /** The stream closed successfully — the accumulated text is the answer (web `state === 'done'`). */
    Done,

    /** The stream ended in a terminal error frame or threw (web `state === 'error'`). */
    Failed,
}

/**
 * One parsed frame of the help-query stream — the native narrowing of the web `AiStreamEvent` union that this
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
 * The immutable surface state the [AIRAGHelpViewModel] exposes. It carries the AI feature gate
 * (web `withAiFeature`), the typed [prompt] (web InnerSection's `prompt` state -> `canStart`), the stream
 * [phase], the in-flight [streamingText] accumulator, the last committed answer ([committedText], kept across a
 * failed re-ask so an offline surface can still show last-known), the classified [errorKind], and the
 * completion [fetchedAt] stamp used for the freshness check.
 *
 * @property gateEnabled whether the AI feature is on (web `useAiEnabled('rag-help')`).
 * @property prompt the typed question (web `prompt` state); blank => the ask action is disabled.
 * @property phase the stream lifecycle phase.
 * @property streamingText the delta accumulator for the in-flight stream (web useAiStream `text`).
 * @property committedText the last successfully completed answer, preserved for the offline surface.
 * @property errorKind the classification of the most recent failure, or `null`.
 * @property fetchedAt epoch-millis stamp of [committedText], or `null` when nothing has completed.
 */
data class AiRagHelpState(
    val gateEnabled: Boolean = true,
    val prompt: String = "",
    val phase: HelpAnswerPhase = HelpAnswerPhase.Idle,
    val streamingText: String = "",
    val committedText: String = "",
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /** Web `canStart = prompt.trim().length > 0`: the ask action is available only with a non-blank prompt. */
    val canStart: Boolean get() = prompt.isNotBlank()

    /** True while a stream is open (drives the button's busy affordance + disables re-entry). */
    val isStreaming: Boolean get() = phase == HelpAnswerPhase.Streaming
}

/**
 * Opens a fresh question: enter [HelpAnswerPhase.Streaming], clear the in-flight accumulator, and drop any
 * prior error. The last [AiRagHelpState.committedText] is intentionally retained (not shown while streaming) so
 * a failed re-ask can fall back to last-known — the web clears its visible text the same way at `start()`,
 * surfacing the thinking indicator until the first delta.
 */
fun AiRagHelpState.startAsking(): AiRagHelpState = copy(phase = HelpAnswerPhase.Streaming, streamingText = "", errorKind = null)

/** Reduces one parsed [AiStreamChunk] into the next state (delta accumulation / done / failure). */
fun AiRagHelpState.onChunk(
    chunk: AiStreamChunk,
    nowMs: Long,
): AiRagHelpState =
    when (chunk) {
        is AiStreamChunk.Delta -> copy(streamingText = streamingText + chunk.text)
        AiStreamChunk.Done -> markDone(nowMs)
        is AiStreamChunk.Failed -> markFailed(chunk.errorKind)
    }

/**
 * Commits the accumulated text as the answer and stamps it for the freshness check. A blank result keeps a
 * blank [AiRagHelpState.committedText] so the surface renders its friendly empty state rather than an empty box.
 */
fun AiRagHelpState.markDone(nowMs: Long): AiRagHelpState =
    copy(phase = HelpAnswerPhase.Done, committedText = streamingText, fetchedAt = nowMs)

/** Marks the stream failed with the classified [kind]; the prior committed answer is left intact. */
fun AiRagHelpState.markFailed(kind: ErrorKind): AiRagHelpState = copy(phase = HelpAnswerPhase.Failed, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the
 * web hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the
 * thinking indicator.
 */
fun AiRagHelpState.finishIfStreaming(nowMs: Long): AiRagHelpState = if (phase == HelpAnswerPhase.Streaming) markDone(nowMs) else this

/**
 * The render-ready classification of [AiRagHelpState] — a closed set of mutually-exclusive surfaces the view
 * switches on, so every branch is exhaustively covered and unit-tested off-device. Maps the stream lifecycle
 * onto the P3 loading / empty / content / error / stale / offline contract.
 */
sealed interface HelpAnswerSurface {
    /** The AI feature is gated off — the whole surface collapses (web `withAiFeature` renders `null`). */
    data object Hidden : HelpAnswerSurface

    /** Resting/idle: the card with the Ask action, enabled only when [canStart] (web `canStart`). */
    data class Resting(
        val canStart: Boolean,
    ) : HelpAnswerSurface

    /** Streaming with no delta yet — the thinking indicator (the surface's loading state). */
    data object Working : HelpAnswerSurface

    /** Streaming with partial text — the answer rendering live as it arrives. */
    data class Live(
        val text: String,
    ) : HelpAnswerSurface

    /** Completed with text — the answer; [stale] flags a fetch older than the freshness window. */
    data class Ready(
        val text: String,
        val stale: Boolean,
    ) : HelpAnswerSurface

    /** Completed but blank — a friendly empty state (the model returned nothing). */
    data object Empty : HelpAnswerSurface

    /** Failed but a prior answer exists — last-known kept visible; [offline] picks the chip/copy. */
    data class Cached(
        val text: String,
        val offline: Boolean,
    ) : HelpAnswerSurface

    /** Failed with no last-known — a QueryError-equivalent with retry; [offline] picks the recovery copy. */
    data class Failed(
        val offline: Boolean,
    ) : HelpAnswerSurface
}

/**
 * Selects the render-ready [HelpAnswerSurface] for [state]. Pure (no Compose/clock): the caller supplies
 * [nowMs] and the [windowMs] freshness budget so the staleness decision is deterministic and testable.
 */
fun classifyHelpAnswer(
    state: AiRagHelpState,
    nowMs: Long,
    windowMs: Long = RAG_HELP_FRESHNESS_WINDOW_MS,
): HelpAnswerSurface {
    if (!state.gateEnabled) return HelpAnswerSurface.Hidden
    return when (state.phase) {
        HelpAnswerPhase.Idle -> HelpAnswerSurface.Resting(state.canStart)
        HelpAnswerPhase.Streaming ->
            if (state.streamingText.isBlank()) {
                HelpAnswerSurface.Working
            } else {
                HelpAnswerSurface.Live(state.streamingText)
            }

        HelpAnswerPhase.Done ->
            if (state.committedText.isBlank()) {
                HelpAnswerSurface.Empty
            } else {
                HelpAnswerSurface.Ready(state.committedText, isStale(state.fetchedAt, nowMs, windowMs))
            }

        HelpAnswerPhase.Failed -> failedSurface(state)
    }
}

/** Failure -> last-known [HelpAnswerSurface.Cached] when a prior answer exists, else a hard failure. */
private fun failedSurface(state: AiRagHelpState): HelpAnswerSurface {
    val offline = state.errorKind == ErrorKind.Network
    return if (state.committedText.isNotBlank()) {
        HelpAnswerSurface.Cached(state.committedText, offline)
    } else {
        HelpAnswerSurface.Failed(offline)
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
 * Builds the merged accessibility description for the prompt field from already-localized parts — the field
 * [label] and its example [hint] — so TalkBack announces the field's purpose and an example question. Pure so
 * the interactive input's a11y-label presence is unit-tested off-device.
 */
fun promptAccessibilityLabel(
    label: String,
    hint: String,
): String = "$label. $hint"

/**
 * Builds the accessibility description for the output region per [surface] from already-localized parts, or
 * `null` when the output region carries no announcement (the resting/hidden surfaces, whose card chrome is
 * announced instead). Pure so the per-state a11y labels are unit-tested off-device.
 */
fun outputAccessibilityLabel(
    surface: HelpAnswerSurface,
    labels: HelpOutputLabels,
): String? =
    when (surface) {
        HelpAnswerSurface.Hidden, is HelpAnswerSurface.Resting -> null
        HelpAnswerSurface.Working, is HelpAnswerSurface.Live -> labels.working
        HelpAnswerSurface.Empty -> labels.empty
        is HelpAnswerSurface.Ready -> if (surface.stale) joinAnnouncement(labels.stale, surface.text) else surface.text
        is HelpAnswerSurface.Cached -> joinAnnouncement(if (surface.offline) labels.offline else labels.error, surface.text)
        is HelpAnswerSurface.Failed -> labels.error
    }

/**
 * Joins an announcement [prefix] (a status label) with a [body] into one TalkBack utterance. A prefix that
 * already ends in sentence punctuation ('.', '!', '?') is followed by a single space so the announcement never
 * doubles a period — the localized answer error is a full sentence, while the offline/stale chips are bare
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
data class HelpOutputLabels(
    val working: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val error: String,
)
