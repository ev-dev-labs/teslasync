// Pure, framework-free model + reducer + surface classifier for the AIChargingDiagnosis shared surface —
// the native analogue of everything the web component derives around its stream
// (web/src/components/ai/AIChargingDiagnosis.tsx → AIFeatureCard → AiOutputPanel, driven by useAiStream).
// No Compose, no Android UI, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web surface is `withAiFeature('charging-diagnosis', InnerSection)`. InnerSection POSTs an empty body
// to `/ai/charging/{sessionID}/diagnose` via useAiStream and feeds the accumulated delta text, lifecycle
// state, and error into AIFeatureCard. Its `canStart` is `!!sessionId` (a string id; empty/absent disables
// Generate). The HOC renders nothing when the AI feature is gated off (ai_mode off), so the canonical
// baseline this surface ships against is "gate off => nothing rendered" — reproduced here as
// [DiagnosisSurface.Hidden] (Honesty Covenant #9: documented, not silent). Every other state renders a
// non-blank surface as the P3 contract requires.
//
// The useAiStream lifecycle (idle -> streaming -> done | error) is mapped onto the P3 state vocabulary:
//   loading  => Streaming with no delta yet ([DiagnosisSurface.Working], a thinking indicator)
//   empty    => Idle ([DiagnosisSurface.Resting], the resting card inviting a generate) or a blank Done
//   content  => Live (streaming partial text) / Ready (completed diagnosis)
//   error    => Failed (no last-known) — a QueryError-equivalent with retry
//   stale    => Ready with a fetch older than the freshness window (a stale chip + manual regenerate)
//   offline  => Cached (a network failure that keeps the last-known diagnosis + an offline chip + retry)
// Unlike a cache-then-network feed there is no automatic background refresh: re-running an LLM generation is
// an explicit, billable action, so the stale surface invites a manual regenerate rather than auto-refreshing
// (documented divergence from the templated "auto-refresh", Honesty Covenant #9).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling AIAnomalyExplanations / AnomalyInlineRow surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aichargingdiagnosis

import io.teslasync.android.data.ErrorKind

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, session id, or any
 * generated text, so a diagnostics line can never leak the operator's fleet state or the model output.
 */
const val AI_CHARGING_DIAGNOSIS_SLUG: String = "AIChargingDiagnosis"

/**
 * How long a completed diagnosis is considered fresh before the surface flags it stale and invites a manual
 * regenerate. Five minutes mirrors the app's live-data staleness budget; it is generous because an LLM
 * narration of a single charging session does not churn second-to-second.
 */
const val DIAGNOSIS_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

/** The useAiStream lifecycle, narrowed to what this surface reacts to (idle -> streaming -> done | failed). */
enum class DiagnosisPhase {
    /** No generation requested yet — the resting card with the Generate action (web `state === 'idle'`). */
    Idle,

    /** A stream is open; delta text accumulates until a terminal frame (web `state === 'streaming'`). */
    Streaming,

    /** The stream closed successfully — the accumulated text is the diagnosis (web `state === 'done'`). */
    Done,

    /** The stream ended in a terminal error frame or threw (web `state === 'error'`). */
    Failed,
}

/**
 * One parsed frame of the diagnose stream — the native narrowing of the web `AiStreamEvent` union that this
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
 * The immutable surface state the [AIChargingDiagnosisViewModel] exposes. It carries the AI feature gate
 * (web `withAiFeature`), the selected charging session (web InnerSection's `sessionId` prop -> `canStart`),
 * the stream [phase], the in-flight [streamingText] accumulator, the last committed diagnosis ([committedText],
 * kept across a failed regenerate so an offline surface can still show last-known), the classified [errorKind],
 * and the completion [fetchedAt] stamp used for the freshness check.
 *
 * @property gateEnabled whether the AI feature is on (web `useAiEnabled('charging-diagnosis')`).
 * @property sessionId the active charging session (web prop); `null`/empty => the generate action is disabled.
 * @property phase the stream lifecycle phase.
 * @property streamingText the delta accumulator for the in-flight stream (web useAiStream `text`).
 * @property committedText the last successfully completed diagnosis, preserved for the offline surface.
 * @property errorKind the classification of the most recent failure, or `null`.
 * @property fetchedAt epoch-millis stamp of [committedText], or `null` when nothing has completed.
 */
data class AiDiagnosisState(
    val gateEnabled: Boolean = true,
    val sessionId: String? = null,
    val phase: DiagnosisPhase = DiagnosisPhase.Idle,
    val streamingText: String = "",
    val committedText: String = "",
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /** Web `canStart = !!sessionId`: the generate action is available only with a non-empty session id. */
    val canStart: Boolean get() = !sessionId.isNullOrEmpty()

    /** True while a stream is open (drives the button's busy affordance + disables re-entry). */
    val isStreaming: Boolean get() = phase == DiagnosisPhase.Streaming
}

/**
 * Opens a fresh generation: enter [DiagnosisPhase.Streaming], clear the in-flight accumulator, and drop any
 * prior error. The last [AiDiagnosisState.committedText] is intentionally retained (not shown while streaming)
 * so a failed regenerate can fall back to last-known — the web clears its visible text the same way at
 * `start()`, surfacing the thinking indicator until the first delta.
 */
fun AiDiagnosisState.startGenerating(): AiDiagnosisState = copy(phase = DiagnosisPhase.Streaming, streamingText = "", errorKind = null)

/** Reduces one parsed [AiStreamChunk] into the next state (delta accumulation / done / failure). */
fun AiDiagnosisState.onChunk(
    chunk: AiStreamChunk,
    nowMs: Long,
): AiDiagnosisState =
    when (chunk) {
        is AiStreamChunk.Delta -> copy(streamingText = streamingText + chunk.text)
        AiStreamChunk.Done -> markDone(nowMs)
        is AiStreamChunk.Failed -> markFailed(chunk.errorKind)
    }

/**
 * Commits the accumulated text as the diagnosis and stamps it for the freshness check. A blank result keeps a
 * blank [AiDiagnosisState.committedText] so the surface renders its friendly empty state rather than an empty
 * box.
 */
fun AiDiagnosisState.markDone(nowMs: Long): AiDiagnosisState =
    copy(phase = DiagnosisPhase.Done, committedText = streamingText, fetchedAt = nowMs)

/** Marks the stream failed with the classified [kind]; the prior committed diagnosis is left intact. */
fun AiDiagnosisState.markFailed(kind: ErrorKind): AiDiagnosisState = copy(phase = DiagnosisPhase.Failed, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the
 * web hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the
 * thinking indicator.
 */
fun AiDiagnosisState.finishIfStreaming(nowMs: Long): AiDiagnosisState = if (phase == DiagnosisPhase.Streaming) markDone(nowMs) else this

/**
 * The render-ready classification of [AiDiagnosisState] — a closed set of mutually-exclusive surfaces the view
 * switches on, so every branch is exhaustively covered and unit-tested off-device. Maps the stream lifecycle
 * onto the P3 loading / empty / content / error / stale / offline contract.
 */
sealed interface DiagnosisSurface {
    /** The AI feature is gated off — the whole surface collapses (web `withAiFeature` renders `null`). */
    data object Hidden : DiagnosisSurface

    /** Resting/idle: the card with the Generate action, enabled only when [canStart] (web `canStart`). */
    data class Resting(
        val canStart: Boolean,
    ) : DiagnosisSurface

    /** Streaming with no delta yet — the thinking indicator (the surface's loading state). */
    data object Working : DiagnosisSurface

    /** Streaming with partial text — the diagnosis rendering live as it arrives. */
    data class Live(
        val text: String,
    ) : DiagnosisSurface

    /** Completed with text — the diagnosis; [stale] flags a fetch older than the freshness window. */
    data class Ready(
        val text: String,
        val stale: Boolean,
    ) : DiagnosisSurface

    /** Completed but blank — a friendly empty state (the model returned nothing). */
    data object Empty : DiagnosisSurface

    /** Failed but a prior diagnosis exists — last-known kept visible; [offline] picks the chip/copy. */
    data class Cached(
        val text: String,
        val offline: Boolean,
    ) : DiagnosisSurface

    /** Failed with no last-known — a QueryError-equivalent with retry; [offline] picks the recovery copy. */
    data class Failed(
        val offline: Boolean,
    ) : DiagnosisSurface
}

/**
 * Selects the render-ready [DiagnosisSurface] for [state]. Pure (no Compose/clock): the caller supplies
 * [nowMs] and the [windowMs] freshness budget so the staleness decision is deterministic and testable.
 */
fun classifyDiagnosis(
    state: AiDiagnosisState,
    nowMs: Long,
    windowMs: Long = DIAGNOSIS_FRESHNESS_WINDOW_MS,
): DiagnosisSurface {
    if (!state.gateEnabled) return DiagnosisSurface.Hidden
    return when (state.phase) {
        DiagnosisPhase.Idle -> DiagnosisSurface.Resting(state.canStart)
        DiagnosisPhase.Streaming ->
            if (state.streamingText.isBlank()) {
                DiagnosisSurface.Working
            } else {
                DiagnosisSurface.Live(state.streamingText)
            }

        DiagnosisPhase.Done ->
            if (state.committedText.isBlank()) {
                DiagnosisSurface.Empty
            } else {
                DiagnosisSurface.Ready(state.committedText, isStale(state.fetchedAt, nowMs, windowMs))
            }

        DiagnosisPhase.Failed -> failedSurface(state)
    }
}

/** Failure -> last-known [DiagnosisSurface.Cached] when a prior diagnosis exists, else a hard failure. */
private fun failedSurface(state: AiDiagnosisState): DiagnosisSurface {
    val offline = state.errorKind == ErrorKind.Network
    return if (state.committedText.isNotBlank()) {
        DiagnosisSurface.Cached(state.committedText, offline)
    } else {
        DiagnosisSurface.Failed(offline)
    }
}

/** True when a completed diagnosis stamped at [fetchedAt] is older than [windowMs] relative to [nowMs]. */
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
    surface: DiagnosisSurface,
    labels: DiagnosisOutputLabels,
): String? =
    when (surface) {
        DiagnosisSurface.Hidden, is DiagnosisSurface.Resting -> null
        DiagnosisSurface.Working, is DiagnosisSurface.Live -> labels.working
        DiagnosisSurface.Empty -> labels.empty
        is DiagnosisSurface.Ready -> if (surface.stale) "${labels.stale}. ${surface.text}" else surface.text
        is DiagnosisSurface.Cached -> "${if (surface.offline) labels.offline else labels.error}. ${surface.text}"
        is DiagnosisSurface.Failed -> labels.error
    }

/** The localized announcement fragments [outputAccessibilityLabel] composes — resolved by the view from i18n. */
data class DiagnosisOutputLabels(
    val working: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val error: String,
)
