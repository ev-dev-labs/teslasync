// Pure, framework-free model + reducer + surface classifier for the AINLAlertBuilder shared surface — the
// native analogue of everything the web component derives around its stream
// (web/src/components/ai/AINLAlertBuilder.tsx → AIFeatureCard → AiOutputPanel, driven by useAiStream).
// No Compose, no Android UI, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web surface is `withAiFeature('nl-alert-builder', InnerSection)`. InnerSection holds a free-text
// prompt in local state, POSTs { vehicle_id, prompt } to `/ai/alerts/rules/draft` via useAiStream, and
// feeds the accumulated delta text, lifecycle state, and error into AIFeatureCard while rendering the prompt
// Textarea as the card's input slot. The web `canStart = vehicleId != null && prompt.trim().length > 0`
// gates the Draft action; that exact predicate is reproduced as [AiAlertDraftState.canStart]. The HOC
// renders nothing when the AI feature is gated off (ai_mode off), so the canonical baseline this surface
// ships against is "gate off => nothing rendered" — reproduced here as [DraftSurface.Hidden] (Honesty
// Covenant #9: documented, not silent). Every other state renders a non-blank surface as the P3 contract
// requires.
//
// The useAiStream lifecycle (idle -> streaming -> done | error) is mapped onto the P3 state vocabulary:
//   loading  => Streaming with no delta yet ([DraftSurface.Working], a thinking indicator)
//   empty    => Idle ([DraftSurface.Resting], the resting card inviting a draft) or a blank Done
//   content  => Live (streaming partial draft) / Ready (completed AlertRule draft)
//   error    => Failed (no last-known) — a QueryError-equivalent with retry
//   stale    => Ready with a draft older than the freshness window (a stale chip + manual re-draft)
//   offline  => Cached (a network failure that keeps the last-known draft + an offline chip + retry)
// Re-running an LLM draft is an explicit, billable action, so the stale surface invites a manual re-draft
// rather than auto-refreshing (documented divergence from the templated "auto-refresh", Honesty Covenant #9).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling AICostForecastNarration / AIAnomalyExplanations surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainlalertbuilder

import io.teslasync.android.data.ErrorKind

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, vehicle id, or any
 * prompt/draft text, so a diagnostics line can never leak the operator's fleet state or the model output.
 */
const val AI_NL_ALERT_BUILDER_SLUG: String = "AINLAlertBuilder"

/**
 * How long a completed draft is considered fresh before the surface flags it stale and invites a manual
 * re-draft. Five minutes mirrors the app's live-data staleness budget; it is generous because a drafted
 * AlertRule does not churn second-to-second.
 */
const val DRAFT_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

/** The useAiStream lifecycle, narrowed to what this surface reacts to (idle -> streaming -> done | failed). */
enum class DraftPhase {
    /** No draft requested yet — the resting card with the Draft action (web `state === 'idle'`). */
    Idle,

    /** A stream is open; delta text accumulates until a terminal frame (web `state === 'streaming'`). */
    Streaming,

    /** The stream closed successfully — the accumulated text is the AlertRule draft (web `state === 'done'`). */
    Done,

    /** The stream ended in a terminal error frame or threw (web `state === 'error'`). */
    Failed,
}

/**
 * One parsed frame of the draft stream — the native narrowing of the web `AiStreamEvent` union that this
 * surface consumes. Delta frames accumulate text; [Done] closes the stream successfully; [Failed] carries the
 * classified transport/HTTP failure so the render boundary can localize it (never the raw provider message).
 */
sealed interface AiDraftChunk {
    /** A `delta` frame — a chunk of the drafted AlertRule appended to the accumulator (web `delta.text`). */
    data class Delta(
        val text: String,
    ) : AiDraftChunk

    /** The terminal `done` frame — the stream finished cleanly. */
    data object Done : AiDraftChunk

    /** A terminal `error` frame — carries the [ErrorKind] the UI maps to localized recovery copy. */
    data class Failed(
        val errorKind: ErrorKind,
    ) : AiDraftChunk
}

/**
 * The immutable surface state the [io.teslasync.android.sharedsurfaces.ainlalertbuilder.AINLAlertBuilderViewModel]
 * exposes. It carries the AI feature gate (web `withAiFeature`), the selected vehicle and the live prompt
 * (web InnerSection's `vehicleId` prop + `useState` prompt -> `canStart`), the stream [phase], the in-flight
 * [streamingText] accumulator, the last committed draft ([committedText], kept across a failed re-draft so an
 * offline surface can still show last-known), the classified [errorKind], and the completion [fetchedAt] stamp
 * used for the freshness check.
 *
 * @property gateEnabled whether the AI feature is on (web `useAiEnabled('nl-alert-builder')`).
 * @property vehicleId the active vehicle (web prop); `null` => the Draft action is disabled.
 * @property prompt the live free-text prompt (web `prompt` state) bound to the input slot; drives `canStart`.
 * @property phase the stream lifecycle phase.
 * @property streamingText the delta accumulator for the in-flight stream (web useAiStream `text`).
 * @property committedText the last successfully completed draft, preserved for the offline surface.
 * @property errorKind the classification of the most recent failure, or `null`.
 * @property fetchedAt epoch-millis stamp of [committedText], or `null` when nothing has completed.
 */
data class AiAlertDraftState(
    val gateEnabled: Boolean = true,
    val vehicleId: Long? = null,
    val prompt: String = "",
    val phase: DraftPhase = DraftPhase.Idle,
    val streamingText: String = "",
    val committedText: String = "",
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /** Web `canStart = vehicleId != null && prompt.trim().length > 0`: a vehicle AND a non-blank prompt. */
    val canStart: Boolean get() = vehicleId != null && prompt.isNotBlank()

    /** True while a stream is open (drives the button's busy affordance + disables re-entry). */
    val isStreaming: Boolean get() = phase == DraftPhase.Streaming
}

/** Binds the live prompt from the input slot (web `setPrompt`); a request input that also drives `canStart`. */
fun AiAlertDraftState.withPrompt(prompt: String): AiAlertDraftState = copy(prompt = prompt)

/**
 * Opens a fresh draft: enter [DraftPhase.Streaming], clear the in-flight accumulator, and drop any prior
 * error. The last [AiAlertDraftState.committedText] is intentionally retained (not shown while streaming) so a
 * failed re-draft can fall back to last-known — the web clears its visible text the same way at `start()`,
 * surfacing the thinking indicator until the first delta.
 */
fun AiAlertDraftState.startDrafting(): AiAlertDraftState = copy(phase = DraftPhase.Streaming, streamingText = "", errorKind = null)

/** Reduces one parsed [AiDraftChunk] into the next state (delta accumulation / done / failure). */
fun AiAlertDraftState.onChunk(
    chunk: AiDraftChunk,
    nowMs: Long,
): AiAlertDraftState =
    when (chunk) {
        is AiDraftChunk.Delta -> copy(streamingText = streamingText + chunk.text)
        AiDraftChunk.Done -> markDone(nowMs)
        is AiDraftChunk.Failed -> markFailed(chunk.errorKind)
    }

/**
 * Commits the accumulated text as the draft and stamps it for the freshness check. A blank result keeps a
 * blank [AiAlertDraftState.committedText] so the surface renders its friendly empty state rather than an empty
 * box.
 */
fun AiAlertDraftState.markDone(nowMs: Long): AiAlertDraftState =
    copy(phase = DraftPhase.Done, committedText = streamingText, fetchedAt = nowMs)

/** Marks the stream failed with the classified [kind]; the prior committed draft is left intact. */
fun AiAlertDraftState.markFailed(kind: ErrorKind): AiAlertDraftState = copy(phase = DraftPhase.Failed, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the
 * web hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the
 * thinking indicator.
 */
fun AiAlertDraftState.finishIfStreaming(nowMs: Long): AiAlertDraftState = if (phase == DraftPhase.Streaming) markDone(nowMs) else this

/**
 * The render-ready classification of [AiAlertDraftState] — a closed set of mutually-exclusive surfaces the
 * view switches on, so every branch is exhaustively covered and unit-tested off-device. Maps the stream
 * lifecycle onto the P3 loading / empty / content / error / stale / offline contract.
 */
sealed interface DraftSurface {
    /** The AI feature is gated off — the whole surface collapses (web `withAiFeature` renders `null`). */
    data object Hidden : DraftSurface

    /** Resting/idle: the card with the Draft action, enabled only when [canStart] (web `canStart`). */
    data class Resting(
        val canStart: Boolean,
    ) : DraftSurface

    /** Streaming with no delta yet — the thinking indicator (the surface's loading state). */
    data object Working : DraftSurface

    /** Streaming with partial text — the AlertRule draft rendering live as it arrives. */
    data class Live(
        val text: String,
    ) : DraftSurface

    /** Completed with text — the draft; [stale] flags a fetch older than the freshness window. */
    data class Ready(
        val text: String,
        val stale: Boolean,
    ) : DraftSurface

    /** Completed but blank — a friendly empty state (the model returned nothing). */
    data object Empty : DraftSurface

    /** Failed but a prior draft exists — last-known kept visible; [offline] picks the chip/copy. */
    data class Cached(
        val text: String,
        val offline: Boolean,
    ) : DraftSurface

    /** Failed with no last-known — a QueryError-equivalent with retry; [offline] picks the recovery copy. */
    data class Failed(
        val offline: Boolean,
    ) : DraftSurface
}

/**
 * Selects the render-ready [DraftSurface] for [state]. Pure (no Compose/clock): the caller supplies [nowMs]
 * and the [windowMs] freshness budget so the staleness decision is deterministic and testable.
 */
fun classifyDraft(
    state: AiAlertDraftState,
    nowMs: Long,
    windowMs: Long = DRAFT_FRESHNESS_WINDOW_MS,
): DraftSurface {
    if (!state.gateEnabled) return DraftSurface.Hidden
    return when (state.phase) {
        DraftPhase.Idle -> DraftSurface.Resting(state.canStart)
        DraftPhase.Streaming ->
            if (state.streamingText.isBlank()) {
                DraftSurface.Working
            } else {
                DraftSurface.Live(state.streamingText)
            }

        DraftPhase.Done ->
            if (state.committedText.isBlank()) {
                DraftSurface.Empty
            } else {
                DraftSurface.Ready(state.committedText, isStale(state.fetchedAt, nowMs, windowMs))
            }

        DraftPhase.Failed -> failedSurface(state)
    }
}

/** Failure -> last-known [DraftSurface.Cached] when a prior draft exists, else a hard failure. */
private fun failedSurface(state: AiAlertDraftState): DraftSurface {
    val offline = state.errorKind == ErrorKind.Network
    return if (state.committedText.isNotBlank()) {
        DraftSurface.Cached(state.committedText, offline)
    } else {
        DraftSurface.Failed(offline)
    }
}

/** True when a completed draft stamped at [fetchedAt] is older than [windowMs] relative to [nowMs]. */
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
 * Builds the accessibility description for the prompt input from already-localized parts — the field carries
 * no visible label (web renders only the input hint), so TalkBack announces the field's purpose ([label]) plus
 * the example hint. Pure so the interactive element's label presence is unit-tested off-device.
 */
fun promptInputAccessibilityLabel(
    label: String,
    hint: String,
): String = "$label. $hint"

/**
 * Builds the accessibility description for the output region per [surface] from already-localized parts, or
 * `null` when the output region carries no announcement (the resting/hidden surfaces, whose card chrome is
 * announced instead). Pure so the per-state a11y labels are unit-tested off-device.
 */
fun outputAccessibilityLabel(
    surface: DraftSurface,
    labels: DraftOutputLabels,
): String? =
    when (surface) {
        DraftSurface.Hidden, is DraftSurface.Resting -> null
        DraftSurface.Working, is DraftSurface.Live -> labels.working
        DraftSurface.Empty -> labels.empty
        is DraftSurface.Ready -> if (surface.stale) "${labels.stale}. ${surface.text}" else surface.text
        is DraftSurface.Cached -> "${if (surface.offline) labels.offline else labels.error}. ${surface.text}"
        is DraftSurface.Failed -> labels.error
    }

/** The localized announcement fragments [outputAccessibilityLabel] composes — resolved by the view from i18n. */
data class DraftOutputLabels(
    val working: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val error: String,
)
