// Pure, framework-free model + reducer + surface classifier for the AIPredictiveMaintenance shared surface —
// the native analogue of everything the web component derives around its stream
// (web/src/components/ai/AIPredictiveMaintenance.tsx → AIFeatureCard → AiOutputPanel, driven by useAiStream).
// No Compose, no Android UI, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web surface is `withAiFeature('predictive-maintenance', InnerSection)`. InnerSection POSTs the in-scope
// `{ vehicle_id }` body to `/ai/maintenance/predict` via useAiStream and feeds the accumulated delta text,
// lifecycle state, and error into AIFeatureCard. The HOC renders nothing when the AI feature is gated off (the
// ai_mode off contract, ADR-015), so the canonical baseline this surface ships against is "gate off => nothing
// rendered" — reproduced here as [MaintenanceSurface.Hidden] (Honesty Covenant #9: documented, not silent).
// Every other state renders a non-blank surface as the P3 contract requires.
//
// The useAiStream lifecycle (idle -> streaming -> done | error) is mapped onto the P3 state vocabulary:
//   loading  => Streaming with no delta yet ([MaintenanceSurface.Working], a thinking indicator)
//   empty    => Idle ([MaintenanceSurface.Resting], the resting card inviting a generate) or a blank Done
//   content  => Live (streaming partial text) / Ready (completed maintenance narrative)
//   error    => Failed (no last-known) — a QueryError-equivalent with retry
//   stale    => Ready with a completion older than the freshness window (a stale chip + manual regenerate)
//   offline  => Cached (a network failure that keeps the last-known narrative + an offline chip + retry)
// Unlike a cache-then-network feed there is no automatic background refresh: re-running an LLM generation is an
// explicit, billable action, so the stale surface invites a manual regenerate rather than auto-refreshing
// (documented divergence from the templated "auto-refresh", Honesty Covenant #9). The web `canStart` is the
// in-scope vehicle gate (`typeof vehicleId === 'number' && Number.isFinite(vehicleId) && vehicleId > 0`),
// reproduced as [AiMaintenanceState.canStart]; without it the generate action is disabled and the web
// `emptyHint` ("Select a vehicle first.") is surfaced.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling AIDriveCoaching / AIAnomalyExplanations surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aipredictivemaintenance

import io.teslasync.android.data.ErrorKind

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, vehicle id, or any
 * generated text, so a diagnostics line can never leak the operator's fleet state or the model output.
 */
const val AI_PREDICTIVE_MAINTENANCE_SLUG: String = "AIPredictiveMaintenance"

/**
 * How long a completed maintenance narrative is considered fresh before the surface flags it stale and invites
 * a manual regenerate. Five minutes mirrors the app's live-data staleness budget; it is generous because an
 * LLM narration of the deterministic maintenance envelope does not churn second-to-second.
 */
const val MAINTENANCE_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

/** The useAiStream lifecycle, narrowed to what this surface reacts to (idle -> streaming -> done | failed). */
enum class MaintenancePhase {
    /** No generation requested yet — the resting card with the Predict action (web `state === 'idle'`). */
    Idle,

    /** A stream is open; delta text accumulates until a terminal frame (web `state === 'streaming'`). */
    Streaming,

    /** The stream closed successfully — the accumulated text is the narrative (web `state === 'done'`). */
    Done,

    /** The stream ended in a terminal error frame or threw (web `state === 'error'`). */
    Failed,
}

/**
 * One parsed frame of the predict stream — the native narrowing of the web `AiStreamEvent` union that this
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
 * The immutable surface state the [AIPredictiveMaintenanceViewModel] exposes. It carries the AI feature gate
 * (web `withAiFeature`), the in-scope vehicle (web InnerSection's `vehicleId` prop -> `canStart`), the stream
 * [phase], the in-flight [streamingText] accumulator, the last committed narrative ([committedText], kept
 * across a failed regenerate so an offline surface can still show last-known), the classified [errorKind], and
 * the completion [fetchedAt] stamp used for the freshness check.
 *
 * @property gateEnabled whether the AI feature is on (web `useAiEnabled('predictive-maintenance')`).
 * @property vehicleId the in-scope vehicle (web prop); `null`/non-positive => the predict action is disabled.
 * @property phase the stream lifecycle phase.
 * @property streamingText the delta accumulator for the in-flight stream (web useAiStream `text`).
 * @property committedText the last successfully completed narrative, preserved for the offline surface.
 * @property errorKind the classification of the most recent failure, or `null`.
 * @property fetchedAt epoch-millis stamp of [committedText], or `null` when nothing has completed.
 */
data class AiMaintenanceState(
    val gateEnabled: Boolean = true,
    val vehicleId: Long? = null,
    val phase: MaintenancePhase = MaintenancePhase.Idle,
    val streamingText: String = "",
    val committedText: String = "",
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /**
     * Web `haveScope = typeof vehicleId === 'number' && Number.isFinite(vehicleId) && vehicleId > 0`: the
     * predict action is available only with a positive in-scope vehicle id.
     */
    val canStart: Boolean get() = vehicleId != null && vehicleId > 0L

    /** True while a stream is open (drives the button's busy affordance + disables re-entry). */
    val isStreaming: Boolean get() = phase == MaintenancePhase.Streaming
}

/**
 * Opens a fresh generation: enter [MaintenancePhase.Streaming], clear the in-flight accumulator, and drop any
 * prior error. The last [AiMaintenanceState.committedText] is intentionally retained (not shown while
 * streaming) so a failed regenerate can fall back to last-known — the web clears its visible text the same way
 * at `start()`, surfacing the thinking indicator until the first delta.
 */
fun AiMaintenanceState.startGenerating(): AiMaintenanceState =
    copy(phase = MaintenancePhase.Streaming, streamingText = "", errorKind = null)

/** Reduces one parsed [AiStreamChunk] into the next state (delta accumulation / done / failure). */
fun AiMaintenanceState.onChunk(
    chunk: AiStreamChunk,
    nowMs: Long,
): AiMaintenanceState =
    when (chunk) {
        is AiStreamChunk.Delta -> copy(streamingText = streamingText + chunk.text)
        AiStreamChunk.Done -> markDone(nowMs)
        is AiStreamChunk.Failed -> markFailed(chunk.errorKind)
    }

/**
 * Commits the accumulated text as the narrative and stamps it for the freshness check. A blank result keeps a
 * blank [AiMaintenanceState.committedText] so the surface renders its friendly empty state rather than an empty
 * box.
 */
fun AiMaintenanceState.markDone(nowMs: Long): AiMaintenanceState =
    copy(phase = MaintenancePhase.Done, committedText = streamingText, fetchedAt = nowMs)

/** Marks the stream failed with the classified [kind]; the prior committed narrative is left intact. */
fun AiMaintenanceState.markFailed(kind: ErrorKind): AiMaintenanceState = copy(phase = MaintenancePhase.Failed, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the
 * web hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the
 * thinking indicator.
 */
fun AiMaintenanceState.finishIfStreaming(nowMs: Long): AiMaintenanceState =
    if (phase == MaintenancePhase.Streaming) markDone(nowMs) else this

/**
 * The render-ready classification of [AiMaintenanceState] — a closed set of mutually-exclusive surfaces the
 * view switches on, so every branch is exhaustively covered and unit-tested off-device. Maps the stream
 * lifecycle onto the P3 loading / empty / content / error / stale / offline contract.
 */
sealed interface MaintenanceSurface {
    /** The AI feature is gated off — the whole surface collapses (web `withAiFeature` renders `null`). */
    data object Hidden : MaintenanceSurface

    /**
     * Resting/idle: the card with the Predict action, enabled only when [canStart] (web `canStart`). When
     * [canStart] is false the view surfaces the web `emptyHint` ("Select a vehicle first.").
     */
    data class Resting(
        val canStart: Boolean,
    ) : MaintenanceSurface

    /** Streaming with no delta yet — the thinking indicator (the surface's loading state). */
    data object Working : MaintenanceSurface

    /** Streaming with partial text — the narrative rendering live as it arrives. */
    data class Live(
        val text: String,
    ) : MaintenanceSurface

    /** Completed with text — the narrative; [stale] flags a completion older than the freshness window. */
    data class Ready(
        val text: String,
        val stale: Boolean,
    ) : MaintenanceSurface

    /** Completed but blank — a friendly empty state (the model returned nothing). */
    data object Empty : MaintenanceSurface

    /** Failed but a prior narrative exists — last-known kept visible; [offline] picks the chip/copy. */
    data class Cached(
        val text: String,
        val offline: Boolean,
    ) : MaintenanceSurface

    /** Failed with no last-known — a QueryError-equivalent with retry; [offline] picks the recovery copy. */
    data class Failed(
        val offline: Boolean,
    ) : MaintenanceSurface
}

/**
 * Selects the render-ready [MaintenanceSurface] for [state]. Pure (no Compose/clock): the caller supplies
 * [nowMs] and the [windowMs] freshness budget so the staleness decision is deterministic and testable.
 */
fun classifyMaintenance(
    state: AiMaintenanceState,
    nowMs: Long,
    windowMs: Long = MAINTENANCE_FRESHNESS_WINDOW_MS,
): MaintenanceSurface {
    if (!state.gateEnabled) return MaintenanceSurface.Hidden
    return when (state.phase) {
        MaintenancePhase.Idle -> MaintenanceSurface.Resting(state.canStart)
        MaintenancePhase.Streaming ->
            if (state.streamingText.isBlank()) {
                MaintenanceSurface.Working
            } else {
                MaintenanceSurface.Live(state.streamingText)
            }

        MaintenancePhase.Done ->
            if (state.committedText.isBlank()) {
                MaintenanceSurface.Empty
            } else {
                MaintenanceSurface.Ready(state.committedText, isStale(state.fetchedAt, nowMs, windowMs))
            }

        MaintenancePhase.Failed -> failedSurface(state)
    }
}

/** Failure -> last-known [MaintenanceSurface.Cached] when a prior narrative exists, else a hard failure. */
private fun failedSurface(state: AiMaintenanceState): MaintenanceSurface {
    val offline = state.errorKind == ErrorKind.Network
    return if (state.committedText.isNotBlank()) {
        MaintenanceSurface.Cached(state.committedText, offline)
    } else {
        MaintenanceSurface.Failed(offline)
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
 * title, the "Helix" badge, the description, and — when the action is disabled — the empty hint as one block).
 * Kept pure so TalkBack-label presence is unit-tested without a Compose host. [hint] is appended only when the
 * vehicle scope is missing, mirroring the web `{!canStart && emptyHint}` render. The hint is space-joined
 * after the description (which already carries its own terminal punctuation) so TalkBack reads two clean
 * sentences rather than a doubled period.
 */
fun headerAccessibilityLabel(
    title: String,
    badge: String,
    description: String,
    hint: String? = null,
): String =
    if (hint != null) {
        "$title ($badge). $description $hint"
    } else {
        "$title ($badge). $description"
    }

/**
 * Builds the accessibility description for the output region per [surface] from already-localized parts, or
 * `null` when the output region carries no announcement (the resting/hidden surfaces, whose card chrome is
 * announced instead). Pure so the per-state a11y labels are unit-tested off-device.
 */
fun outputAccessibilityLabel(
    surface: MaintenanceSurface,
    labels: MaintenanceOutputLabels,
): String? =
    when (surface) {
        MaintenanceSurface.Hidden, is MaintenanceSurface.Resting -> null
        MaintenanceSurface.Working, is MaintenanceSurface.Live -> labels.working
        MaintenanceSurface.Empty -> labels.empty
        is MaintenanceSurface.Ready -> if (surface.stale) "${labels.stale}. ${surface.text}" else surface.text
        is MaintenanceSurface.Cached -> "${if (surface.offline) labels.offline else labels.error}. ${surface.text}"
        is MaintenanceSurface.Failed -> labels.error
    }

/** The localized announcement fragments [outputAccessibilityLabel] composes — resolved by the view from i18n. */
data class MaintenanceOutputLabels(
    val working: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val error: String,
)
