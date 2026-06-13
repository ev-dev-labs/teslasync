// Pure, framework-free model + reducer + surface classifier for the AITCONarration shared surface — the native
// analogue of everything the web component derives around its stream
// (web/src/components/ai/AITCONarration.tsx → AIFeatureCard → AiOutputPanel, driven by useAiStream).
// No Compose, no Android UI, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web surface is `withAiFeature('tco-narration', InnerSection)`. InnerSection POSTs `{ vehicle_id }` to
// `/ai/analytics/tco/narrate` via useAiStream and feeds the accumulated delta text, lifecycle state, and error
// into AIFeatureCard. Unlike the sibling cost-forecast narrator there is NO optional `months` horizon — the TCO
// narrate request carries only the vehicle, so this model holds no request-input beyond [AiNarrationState.vehicleId]
// (web `haveInputs = numericVehicleId > 0` → the action's `canStart`). The HOC renders nothing when the AI feature
// is gated off (ai_mode off), so the canonical baseline this surface ships against is "gate off => nothing rendered"
// — reproduced here as [NarrationSurface.Hidden] (Honesty Covenant #9: documented, not silent). Every other state
// renders a non-blank surface as the P3 contract requires.
//
// The web InnerSection also passes an `emptyHint` ("Pick a vehicle above to enable Helix.") that AIFeatureCard
// renders under the description whenever `!canStart`. That hint is a header affordance (not an output state), so it
// is folded into [headerAccessibilityLabel] for TalkBack and rendered inline by the view; it never changes which
// [NarrationSurface] is drawn.
//
// The useAiStream lifecycle (idle -> streaming -> done | error) is mapped onto the P3 state vocabulary:
//   loading  => Streaming with no delta yet ([NarrationSurface.Working], a thinking indicator)
//   empty    => Idle ([NarrationSurface.Resting], the resting card inviting a narrate) or a blank Done
//   content  => Live (streaming partial text) / Ready (completed narration)
//   error    => Failed (no last-known) — a QueryError-equivalent with retry
//   stale    => Ready with a fetch older than the freshness window (a stale chip + manual regenerate)
//   offline  => Cached (a network failure that keeps the last-known narration + an offline chip + retry)
// Unlike a cache-then-network feed there is no automatic background refresh: re-running an LLM generation is an
// explicit, billable action, so the stale surface invites a manual regenerate rather than auto-refreshing
// (documented divergence from the templated "auto-refresh", Honesty Covenant #9).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling AICostForecastNarration / AIAnomalyExplanations surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aitconarration

import io.teslasync.android.data.ErrorKind

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, vehicle id, or any
 * generated text, so a diagnostics line can never leak the operator's fleet state or the model output.
 */
const val AI_TCO_NARRATION_SLUG: String = "AITCONarration"

/**
 * How long a completed narration is considered fresh before the surface flags it stale and invites a manual
 * regenerate. Five minutes mirrors the app's live-data staleness budget; it is generous because an LLM
 * narration of a total-cost-of-ownership envelope does not churn second-to-second.
 */
const val NARRATION_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

/** The useAiStream lifecycle, narrowed to what this surface reacts to (idle -> streaming -> done | failed). */
enum class NarrationPhase {
    /** No generation requested yet — the resting card with the Explain action (web `state === 'idle'`). */
    Idle,

    /** A stream is open; delta text accumulates until a terminal frame (web `state === 'streaming'`). */
    Streaming,

    /** The stream closed successfully — the accumulated text is the narration (web `state === 'done'`). */
    Done,

    /** The stream ended in a terminal error frame or threw (web `state === 'error'`). */
    Failed,
}

/**
 * One parsed frame of the narrate stream — the native narrowing of the web `AiStreamEvent` union that this
 * surface consumes. Delta frames accumulate text; [Done] closes the stream successfully; [Failed] carries the
 * classified transport/HTTP failure so the render boundary can localize it (never the raw provider message).
 */
sealed interface AiNarrationChunk {
    /** A `delta` frame — a chunk of generated prose appended to the accumulator (web `delta.text`). */
    data class Delta(
        val text: String,
    ) : AiNarrationChunk

    /** The terminal `done` frame — the stream finished cleanly. */
    data object Done : AiNarrationChunk

    /** A terminal `error` frame — carries the [ErrorKind] the UI maps to localized recovery copy. */
    data class Failed(
        val errorKind: ErrorKind,
    ) : AiNarrationChunk
}

/**
 * The immutable surface state the [AITCONarrationViewModel] exposes. It carries the AI feature gate
 * (web `withAiFeature`), the selected vehicle (web InnerSection's `vehicleId` prop -> `canStart`), the stream
 * [phase], the in-flight [streamingText] accumulator, the last committed narration ([committedText], kept across
 * a failed regenerate so an offline surface can still show last-known), the classified [errorKind], and the
 * completion [fetchedAt] stamp used for the freshness check.
 *
 * @property gateEnabled whether the AI feature is on (web `useAiEnabled('tco-narration')`).
 * @property vehicleId the active vehicle (web prop); `null` => the explain action is disabled + the hint shows.
 * @property phase the stream lifecycle phase.
 * @property streamingText the delta accumulator for the in-flight stream (web useAiStream `text`).
 * @property committedText the last successfully completed narration, preserved for the offline surface.
 * @property errorKind the classification of the most recent failure, or `null`.
 * @property fetchedAt epoch-millis stamp of [committedText], or `null` when nothing has completed.
 */
data class AiNarrationState(
    val gateEnabled: Boolean = true,
    val vehicleId: Long? = null,
    val phase: NarrationPhase = NarrationPhase.Idle,
    val streamingText: String = "",
    val committedText: String = "",
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /** Web `haveInputs = numericVehicleId > 0`: the explain action is available only with a selected vehicle. */
    val canStart: Boolean get() = vehicleId != null

    /** True while a stream is open (drives the button's busy affordance + disables re-entry). */
    val isStreaming: Boolean get() = phase == NarrationPhase.Streaming
}

/**
 * Opens a fresh generation: enter [NarrationPhase.Streaming], clear the in-flight accumulator, and drop any prior
 * error. The last [AiNarrationState.committedText] is intentionally retained (not shown while streaming) so a
 * failed regenerate can fall back to last-known — the web clears its visible text the same way at `start()`,
 * surfacing the thinking indicator until the first delta.
 */
fun AiNarrationState.startGenerating(): AiNarrationState = copy(phase = NarrationPhase.Streaming, streamingText = "", errorKind = null)

/** Reduces one parsed [AiNarrationChunk] into the next state (delta accumulation / done / failure). */
fun AiNarrationState.onChunk(
    chunk: AiNarrationChunk,
    nowMs: Long,
): AiNarrationState =
    when (chunk) {
        is AiNarrationChunk.Delta -> copy(streamingText = streamingText + chunk.text)
        AiNarrationChunk.Done -> markDone(nowMs)
        is AiNarrationChunk.Failed -> markFailed(chunk.errorKind)
    }

/**
 * Commits the accumulated text as the narration and stamps it for the freshness check. A blank result keeps a
 * blank [AiNarrationState.committedText] so the surface renders its friendly empty state rather than an empty box.
 */
fun AiNarrationState.markDone(nowMs: Long): AiNarrationState =
    copy(phase = NarrationPhase.Done, committedText = streamingText, fetchedAt = nowMs)

/** Marks the stream failed with the classified [kind]; the prior committed narration is left intact. */
fun AiNarrationState.markFailed(kind: ErrorKind): AiNarrationState = copy(phase = NarrationPhase.Failed, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the web
 * hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the thinking
 * indicator.
 */
fun AiNarrationState.finishIfStreaming(nowMs: Long): AiNarrationState = if (phase == NarrationPhase.Streaming) markDone(nowMs) else this

/**
 * The render-ready classification of [AiNarrationState] — a closed set of mutually-exclusive surfaces the view
 * switches on, so every branch is exhaustively covered and unit-tested off-device. Maps the stream lifecycle onto
 * the P3 loading / empty / content / error / stale / offline contract.
 */
sealed interface NarrationSurface {
    /** The AI feature is gated off — the whole surface collapses (web `withAiFeature` renders `null`). */
    data object Hidden : NarrationSurface

    /** Resting/idle: the card with the Explain action, enabled only when [canStart] (web `haveInputs`). */
    data class Resting(
        val canStart: Boolean,
    ) : NarrationSurface

    /** Streaming with no delta yet — the thinking indicator (the surface's loading state). */
    data object Working : NarrationSurface

    /** Streaming with partial text — the narration rendering live as it arrives. */
    data class Live(
        val text: String,
    ) : NarrationSurface

    /** Completed with text — the narration; [stale] flags a fetch older than the freshness window. */
    data class Ready(
        val text: String,
        val stale: Boolean,
    ) : NarrationSurface

    /** Completed but blank — a friendly empty state (the model returned nothing). */
    data object Empty : NarrationSurface

    /** Failed but a prior narration exists — last-known kept visible; [offline] picks the chip/copy. */
    data class Cached(
        val text: String,
        val offline: Boolean,
    ) : NarrationSurface

    /** Failed with no last-known — a QueryError-equivalent with retry; [offline] picks the recovery copy. */
    data class Failed(
        val offline: Boolean,
    ) : NarrationSurface
}

/**
 * Selects the render-ready [NarrationSurface] for [state]. Pure (no Compose/clock): the caller supplies [nowMs]
 * and the [windowMs] freshness budget so the staleness decision is deterministic and testable.
 */
fun classifyNarration(
    state: AiNarrationState,
    nowMs: Long,
    windowMs: Long = NARRATION_FRESHNESS_WINDOW_MS,
): NarrationSurface {
    if (!state.gateEnabled) return NarrationSurface.Hidden
    return when (state.phase) {
        NarrationPhase.Idle -> NarrationSurface.Resting(state.canStart)
        NarrationPhase.Streaming ->
            if (state.streamingText.isBlank()) {
                NarrationSurface.Working
            } else {
                NarrationSurface.Live(state.streamingText)
            }

        NarrationPhase.Done ->
            if (state.committedText.isBlank()) {
                NarrationSurface.Empty
            } else {
                NarrationSurface.Ready(state.committedText, isStale(state.fetchedAt, nowMs, windowMs))
            }

        NarrationPhase.Failed -> failedSurface(state)
    }
}

/** Failure -> last-known [NarrationSurface.Cached] when a prior narration exists, else a hard failure. */
private fun failedSurface(state: AiNarrationState): NarrationSurface {
    val offline = state.errorKind == ErrorKind.Network
    return if (state.committedText.isNotBlank()) {
        NarrationSurface.Cached(state.committedText, offline)
    } else {
        NarrationSurface.Failed(offline)
    }
}

/** True when a completed narration stamped at [fetchedAt] is older than [windowMs] relative to [nowMs]. */
fun isStale(
    fetchedAt: Long?,
    nowMs: Long,
    windowMs: Long,
): Boolean = fetchedAt != null && nowMs - fetchedAt > windowMs

/**
 * Builds the merged accessibility description for the card header from already-localized parts (web reads the
 * title, the "Helix" badge, and the description as one block). When the explain action is disabled the web also
 * renders the "Pick a vehicle…" hint inside the same header block, so a non-null [hint] is appended here so
 * TalkBack announces it too. Kept pure so the label is unit-tested without a Compose host.
 */
fun headerAccessibilityLabel(
    title: String,
    badge: String,
    description: String,
    hint: String? = null,
): String {
    val base = "$title ($badge). $description"
    return if (hint != null) "$base $hint" else base
}

/**
 * Builds the accessibility description for the output region per [surface] from already-localized parts, or `null`
 * when the output region carries no announcement (the resting/hidden surfaces, whose card chrome is announced
 * instead). Pure so the per-state a11y labels are unit-tested off-device.
 */
fun outputAccessibilityLabel(
    surface: NarrationSurface,
    labels: NarrationOutputLabels,
): String? =
    when (surface) {
        NarrationSurface.Hidden, is NarrationSurface.Resting -> null
        NarrationSurface.Working, is NarrationSurface.Live -> labels.working
        NarrationSurface.Empty -> labels.empty
        is NarrationSurface.Ready -> if (surface.stale) "${labels.stale}. ${surface.text}" else surface.text
        is NarrationSurface.Cached -> "${if (surface.offline) labels.offline else labels.error}. ${surface.text}"
        is NarrationSurface.Failed -> labels.error
    }

/** The localized announcement fragments [outputAccessibilityLabel] composes — resolved by the view from i18n. */
data class NarrationOutputLabels(
    val working: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val error: String,
)
