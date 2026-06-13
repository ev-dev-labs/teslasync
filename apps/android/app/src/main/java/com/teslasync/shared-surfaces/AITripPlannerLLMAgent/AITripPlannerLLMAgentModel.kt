// Pure, framework-free model + reducer + surface classifier for the AITripPlannerLLMAgent shared surface — the
// native analogue of everything the web component derives around its stream
// (web/src/components/ai/AITripPlannerLLMAgent.tsx → AIFeatureCard → AiOutputPanel, driven by useAiStream).
// No Compose, no Android UI, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web surface is `withAiFeature('trip-planner-llm-agent', InnerSection)`. InnerSection memoises a rich
// request body (vehicle id + origin/destination corridor + SoC envelope + speed factor) and POSTs it to
// `/ai/trips/plan/draft` via useAiStream, feeding the accumulated delta text, lifecycle state, and error into
// AIFeatureCard. The HOC renders nothing when the AI feature is gated off (ai_mode off), so the canonical
// baseline this surface ships against is "gate off => nothing rendered" — reproduced here as
// [TripPlanSurface.Hidden] (Honesty Covenant #9: documented, not silent). Every other state renders a
// non-blank surface as the P3 contract requires.
//
// The useAiStream lifecycle (idle -> streaming -> done | error) is mapped onto the P3 state vocabulary:
//   loading  => Streaming with no delta yet ([TripPlanSurface.Working], a thinking indicator)
//   empty    => Idle ([TripPlanSurface.Resting], the resting card inviting a draft) or a blank Done
//   content  => Live (streaming partial draft) / Ready (completed plan narrative)
//   error    => Failed (no last-known) — a QueryError-equivalent with retry
//   stale    => Ready with a draft older than the freshness window (a stale chip + manual re-draft)
//   offline  => Cached (a network failure that keeps the last-known draft + an offline chip + retry)
// Unlike a cache-then-network feed there is no automatic background refresh: re-running an LLM draft is an
// explicit, billable action, so the stale surface invites a manual re-draft rather than auto-refreshing
// (documented divergence from the templated "auto-refresh", Honesty Covenant #9).
//
// Unlike the single-input sibling AISpeedProfileInsights (web `canStart = !!driveId`), this surface gates on
// THREE inputs — `canStart = !!vehicleId && origin != null && destination != null` — and carries the full
// request body the web `useMemo` builds, including the web defaults (current_soc ?? 80, charge_limit_soc ?? 90,
// min_arrival_soc ?? 20, speed_factor ?? 1.0). Those defaults live in [TripPlanInputs.toDraftRequest] so they
// are reduced + unit-tested off-device exactly as the web body is.
//
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations. `InvalidPackageDeclaration`
// is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/AITripPlannerLLMAgent — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the
// path — exactly as the sibling AISpeedProfileInsights / AIDriveCoaching surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aitripplannerllmagent

import io.teslasync.android.data.ErrorKind

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, vehicle id,
 * coordinates, or any generated text, so a diagnostics line can never leak the operator's fleet state or the
 * model output.
 */
const val AI_TRIP_PLANNER_LLM_AGENT_SLUG: String = "AITripPlannerLLMAgent"

/**
 * How long a completed plan draft is considered fresh before the surface flags it stale and invites a manual
 * re-draft. Five minutes mirrors the app's live-data staleness budget; it is generous because an LLM-drafted
 * corridor plan does not churn second-to-second, and re-drafting is an explicit billable action.
 */
const val TRIP_PLAN_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

/** Web body default for `current_soc` when the host supplies none (`current_soc ?? 80`). */
const val DEFAULT_CURRENT_SOC: Double = 80.0

/** Web body default for `charge_limit_soc` when the host supplies none (`charge_limit_soc ?? 90`). */
const val DEFAULT_CHARGE_LIMIT_SOC: Double = 90.0

/** Web body default for `min_arrival_soc` when the host supplies none (`min_arrival_soc ?? 20`). */
const val DEFAULT_MIN_ARRIVAL_SOC: Double = 20.0

/** Web body default for `speed_factor` when the host supplies none (`speed_factor ?? 1.0`). */
const val DEFAULT_SPEED_FACTOR: Double = 1.0

/**
 * A corridor endpoint — the native analogue of the web `TripLocationLike` ({ lat, lng, name? }). [name]
 * defaults to the empty string, mirroring the web `name ?? ''` fallback the request body applies.
 */
data class TripLocation(
    val lat: Double,
    val lng: Double,
    val name: String = "",
)

/**
 * The host-supplied planning inputs — the native analogue of the web InnerSection props. All are optional so
 * the surface can render its resting/disabled state before the host has resolved a vehicle + corridor (web
 * `canStart`); the SoC envelope + speed factor fall back to the web defaults when building the request body.
 *
 * @property vehicleId the active vehicle (web `vehicleId`); `null`/`0` => the draft action is disabled.
 * @property origin the corridor start (web `origin`); `null` => the draft action is disabled.
 * @property destination the corridor end (web `destination`); `null` => the draft action is disabled.
 * @property currentSoc starting state-of-charge %, or `null` to use [DEFAULT_CURRENT_SOC].
 * @property chargeLimitSoc charge-limit %, or `null` to use [DEFAULT_CHARGE_LIMIT_SOC].
 * @property minArrivalSoc minimum arrival %, or `null` to use [DEFAULT_MIN_ARRIVAL_SOC].
 * @property speedFactor speed multiplier, or `null` to use [DEFAULT_SPEED_FACTOR].
 */
data class TripPlanInputs(
    val vehicleId: Long? = null,
    val origin: TripLocation? = null,
    val destination: TripLocation? = null,
    val currentSoc: Double? = null,
    val chargeLimitSoc: Double? = null,
    val minArrivalSoc: Double? = null,
    val speedFactor: Double? = null,
) {
    /**
     * Web `canStart = !!vehicleId && origin != null && destination != null`: the draft action is available only
     * with a present (non-zero) vehicle id AND both corridor endpoints. `0` is treated as absent to mirror the
     * web `!!vehicleId` truthiness check.
     */
    val canStart: Boolean
        get() = vehicleId != null && vehicleId != 0L && origin != null && destination != null
}

/**
 * The fully-resolved draft request — the native analogue of the web `useMemo` body POSTed to
 * `/ai/trips/plan/draft`. Every nullable input has been collapsed to a concrete value, applying the same
 * fallbacks the web body does, so the production [AITripPlannerLLMAgentSource] adapter can serialize it
 * directly without re-deriving defaults.
 */
data class TripPlanDraftRequest(
    val vehicleId: Long,
    val origin: TripLocation,
    val destination: TripLocation,
    val currentSoc: Double,
    val chargeLimitSoc: Double,
    val minArrivalSoc: Double,
    val speedFactor: Double,
)

/**
 * Builds the concrete [TripPlanDraftRequest] from the host inputs, applying the web body's exact fallbacks
 * (`vehicle_id: numericVehicleId || 0`, `origin/destination: { lat:0, lng:0, name:'' }` when null, and the SoC
 * + speed-factor `??` defaults). Pure + unit-tested so the request shape stays bit-faithful to the web body.
 */
fun TripPlanInputs.toDraftRequest(): TripPlanDraftRequest =
    TripPlanDraftRequest(
        vehicleId = vehicleId ?: 0L,
        origin = origin ?: TripLocation(0.0, 0.0, ""),
        destination = destination ?: TripLocation(0.0, 0.0, ""),
        currentSoc = currentSoc ?: DEFAULT_CURRENT_SOC,
        chargeLimitSoc = chargeLimitSoc ?: DEFAULT_CHARGE_LIMIT_SOC,
        minArrivalSoc = minArrivalSoc ?: DEFAULT_MIN_ARRIVAL_SOC,
        speedFactor = speedFactor ?: DEFAULT_SPEED_FACTOR,
    )

/** The useAiStream lifecycle, narrowed to what this surface reacts to (idle -> streaming -> done | failed). */
enum class TripPlanPhase {
    /** No draft requested yet — the resting card with the Draft action (web `state === 'idle'`). */
    Idle,

    /** A stream is open; delta text accumulates until a terminal frame (web `state === 'streaming'`). */
    Streaming,

    /** The stream closed successfully — the accumulated text is the draft (web `state === 'done'`). */
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
 * The immutable surface state the [AITripPlannerLLMAgentViewModel] exposes. It carries the AI feature gate
 * (web `withAiFeature`), the planning [inputs] (web InnerSection props -> `canStart`), the stream [phase], the
 * in-flight [streamingText] accumulator, the last committed draft ([committedText], kept across a failed
 * re-draft so an offline surface can still show last-known), the classified [errorKind], and the completion
 * [fetchedAt] stamp used for the freshness check.
 *
 * @property gateEnabled whether the AI feature is on (web `useAiEnabled('trip-planner-llm-agent')`).
 * @property inputs the host planning inputs (web props); drives [canStart].
 * @property phase the stream lifecycle phase.
 * @property streamingText the delta accumulator for the in-flight stream (web useAiStream `text`).
 * @property committedText the last successfully completed draft, preserved for the offline surface.
 * @property errorKind the classification of the most recent failure, or `null`.
 * @property fetchedAt epoch-millis stamp of [committedText], or `null` when nothing has completed.
 */
data class TripPlanState(
    val gateEnabled: Boolean = true,
    val inputs: TripPlanInputs = TripPlanInputs(),
    val phase: TripPlanPhase = TripPlanPhase.Idle,
    val streamingText: String = "",
    val committedText: String = "",
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /** Web `canStart`: a present vehicle id AND both corridor endpoints. */
    val canStart: Boolean get() = inputs.canStart

    /** True while a stream is open (drives the button's busy affordance + disables re-entry). */
    val isStreaming: Boolean get() = phase == TripPlanPhase.Streaming
}

/**
 * Opens a fresh draft: enter [TripPlanPhase.Streaming], clear the in-flight accumulator, and drop any prior
 * error. The last [TripPlanState.committedText] is intentionally retained (not shown while streaming) so a
 * failed re-draft can fall back to last-known — the web clears its visible text the same way at `start()`,
 * surfacing the thinking indicator until the first delta.
 */
fun TripPlanState.startGenerating(): TripPlanState = copy(phase = TripPlanPhase.Streaming, streamingText = "", errorKind = null)

/** Reduces one parsed [AiStreamChunk] into the next state (delta accumulation / done / failure). */
fun TripPlanState.onChunk(
    chunk: AiStreamChunk,
    nowMs: Long,
): TripPlanState =
    when (chunk) {
        is AiStreamChunk.Delta -> copy(streamingText = streamingText + chunk.text)
        AiStreamChunk.Done -> markDone(nowMs)
        is AiStreamChunk.Failed -> markFailed(chunk.errorKind)
    }

/**
 * Commits the accumulated text as the draft and stamps it for the freshness check. A blank result keeps a
 * blank [TripPlanState.committedText] so the surface renders its friendly empty state rather than an empty box.
 */
fun TripPlanState.markDone(nowMs: Long): TripPlanState = copy(phase = TripPlanPhase.Done, committedText = streamingText, fetchedAt = nowMs)

/** Marks the stream failed with the classified [kind]; the prior committed draft is left intact. */
fun TripPlanState.markFailed(kind: ErrorKind): TripPlanState = copy(phase = TripPlanPhase.Failed, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the
 * web hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the
 * thinking indicator.
 */
fun TripPlanState.finishIfStreaming(nowMs: Long): TripPlanState = if (phase == TripPlanPhase.Streaming) markDone(nowMs) else this

/**
 * The render-ready classification of [TripPlanState] — a closed set of mutually-exclusive surfaces the view
 * switches on, so every branch is exhaustively covered and unit-tested off-device. Maps the stream lifecycle
 * onto the P3 loading / empty / content / error / stale / offline contract.
 */
sealed interface TripPlanSurface {
    /** The AI feature is gated off — the whole surface collapses (web `withAiFeature` renders `null`). */
    data object Hidden : TripPlanSurface

    /** Resting/idle: the card with the Draft action, enabled only when [canStart] (web `canStart`). */
    data class Resting(
        val canStart: Boolean,
    ) : TripPlanSurface

    /** Streaming with no delta yet — the thinking indicator (the surface's loading state). */
    data object Working : TripPlanSurface

    /** Streaming with partial text — the draft rendering live as it arrives. */
    data class Live(
        val text: String,
    ) : TripPlanSurface

    /** Completed with text — the draft; [stale] flags a draft older than the freshness window. */
    data class Ready(
        val text: String,
        val stale: Boolean,
    ) : TripPlanSurface

    /** Completed but blank — a friendly empty state (the model returned nothing). */
    data object Empty : TripPlanSurface

    /** Failed but a prior draft exists — last-known kept visible; [offline] picks the chip/copy. */
    data class Cached(
        val text: String,
        val offline: Boolean,
    ) : TripPlanSurface

    /** Failed with no last-known — a QueryError-equivalent with retry; [offline] picks the recovery copy. */
    data class Failed(
        val offline: Boolean,
    ) : TripPlanSurface
}

/**
 * Selects the render-ready [TripPlanSurface] for [state]. Pure (no Compose/clock): the caller supplies [nowMs]
 * and the [windowMs] freshness budget so the staleness decision is deterministic and testable.
 */
fun classifyTripPlan(
    state: TripPlanState,
    nowMs: Long,
    windowMs: Long = TRIP_PLAN_FRESHNESS_WINDOW_MS,
): TripPlanSurface {
    if (!state.gateEnabled) return TripPlanSurface.Hidden
    return when (state.phase) {
        TripPlanPhase.Idle -> TripPlanSurface.Resting(state.canStart)
        TripPlanPhase.Streaming ->
            if (state.streamingText.isBlank()) {
                TripPlanSurface.Working
            } else {
                TripPlanSurface.Live(state.streamingText)
            }

        TripPlanPhase.Done ->
            if (state.committedText.isBlank()) {
                TripPlanSurface.Empty
            } else {
                TripPlanSurface.Ready(state.committedText, isStale(state.fetchedAt, nowMs, windowMs))
            }

        TripPlanPhase.Failed -> failedSurface(state)
    }
}

/** Failure -> last-known [TripPlanSurface.Cached] when a prior draft exists, else a hard failure. */
private fun failedSurface(state: TripPlanState): TripPlanSurface {
    val offline = state.errorKind == ErrorKind.Network
    return if (state.committedText.isNotBlank()) {
        TripPlanSurface.Cached(state.committedText, offline)
    } else {
        TripPlanSurface.Failed(offline)
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
 * `null` when the output region carries no announcement (the resting/hidden surfaces, whose card chrome is
 * announced instead). Pure so the per-state a11y labels are unit-tested off-device.
 */
fun outputAccessibilityLabel(
    surface: TripPlanSurface,
    labels: TripPlanOutputLabels,
): String? =
    when (surface) {
        TripPlanSurface.Hidden, is TripPlanSurface.Resting -> null
        TripPlanSurface.Working, is TripPlanSurface.Live -> labels.working
        TripPlanSurface.Empty -> labels.empty
        is TripPlanSurface.Ready -> if (surface.stale) "${labels.stale}. ${surface.text}" else surface.text
        is TripPlanSurface.Cached -> "${if (surface.offline) labels.offline else labels.error}. ${surface.text}"
        is TripPlanSurface.Failed -> labels.error
    }

/** The localized announcement fragments [outputAccessibilityLabel] composes — resolved by the view from i18n. */
data class TripPlanOutputLabels(
    val working: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val error: String,
)
