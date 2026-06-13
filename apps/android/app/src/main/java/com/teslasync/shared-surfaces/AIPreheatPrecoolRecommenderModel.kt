// Pure, framework-free model + reducer + surface classifier for the AIPreheatPrecoolRecommender shared
// surface — the native analogue of everything the web component derives around its stream
// (web/src/components/ai/AIPreheatPrecoolRecommender.tsx → AIFeatureCard → AiOutputPanel, driven by
// useAiStream). No Compose, no Android UI, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web surface is `withAiFeature('preheat-precool-recommender', InnerSection)`. InnerSection POSTs a
// climate body to `/ai/climate/schedule/draft` via useAiStream and feeds the accumulated delta text,
// lifecycle state, and error into AIFeatureCard. Unlike the single-id charging-diagnosis surface, its
// `canStart` is the conjunction of FOUR resolved inputs (web `haveInputs = haveVehicle && haveDepart &&
// haveCabin && haveOutside`): a positive vehicle id, a non-empty depart-by timestamp, a finite cabin
// temperature, and a finite outside temperature. The target cabin temperature defaults to 21 °C when the
// host has not supplied a finite value (web `target = … ? targetCabinTempC : 21`). The HOC renders nothing
// when the AI feature is gated off (ai_mode off), so the canonical baseline this surface ships against is
// "gate off => nothing rendered" — reproduced here as [DraftSurface.Hidden] (Honesty Covenant #9:
// documented, not silent). Every other state renders a non-blank surface as the P3 contract requires.
//
// The useAiStream lifecycle (idle -> streaming -> done | error) is mapped onto the P3 state vocabulary:
//   loading  => Streaming with no delta yet ([DraftSurface.Working], a thinking indicator)
//   empty    => Idle ([DraftSurface.Resting], the resting card inviting a draft) or a blank Done
//   content  => Live (streaming partial text) / Ready (completed draft schedule)
//   error    => Failed (no last-known) — a QueryError-equivalent with retry
//   stale    => Ready with a draft older than the freshness window (a stale chip + manual regenerate)
//   offline  => Cached (a network failure that keeps the last-known draft + an offline chip + retry)
// Re-running an LLM draft is an explicit, billable action (Helix never persists the schedule — it proposes
// one for the user to Apply on the canonical climate controls below), so the stale surface invites a manual
// regenerate rather than auto-refreshing (documented divergence from the templated "auto-refresh", Honesty
// Covenant #9).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling AIChargingDiagnosis / AIAnomalyExplanations surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aipreheatprecoolrecommender

import io.teslasync.android.data.ErrorKind

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, vehicle id,
 * timestamp, temperature, or generated text, so a diagnostics line can never leak the operator's fleet
 * state or the model output.
 */
const val AI_PREHEAT_PRECOOL_RECOMMENDER_SLUG: String = "AIPreheatPrecoolRecommender"

/**
 * How long a completed draft is considered fresh before the surface flags it stale and invites a manual
 * regenerate. Five minutes mirrors the app's live-data staleness budget; it is generous because a proposed
 * departure window does not churn second-to-second.
 */
const val DRAFT_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

/**
 * The default target cabin temperature in Celsius the draft is grounded against when the host has not
 * resolved a finite value — the web `target = … ? targetCabinTempC : 21` fallback (a comfortable cabin).
 */
const val DEFAULT_TARGET_CABIN_TEMP_C: Double = 21.0

/** The useAiStream lifecycle, narrowed to what this surface reacts to (idle -> streaming -> done | failed). */
enum class DraftPhase {
    /** No draft requested yet — the resting card with the Draft action (web `state === 'idle'`). */
    Idle,

    /** A stream is open; delta text accumulates until a terminal frame (web `state === 'streaming'`). */
    Streaming,

    /** The stream closed successfully — the accumulated text is the proposed schedule (web `'done'`). */
    Done,

    /** The stream ended in a terminal error frame or threw (web `state === 'error'`). */
    Failed,
}

/**
 * One parsed frame of the draft stream — the native narrowing of the web `AiStreamEvent` union this surface
 * consumes. Delta frames accumulate text; [Done] closes the stream successfully; [Failed] carries the
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
 * The deterministic draft request payload — the native analogue of the web POST body InnerSection builds
 * via `useMemo` and posts at `start()`. Every field is non-optional because the projection
 * ([PreheatDraftInputs.toRequestBody]) resolves the web optionals to the same zero / empty-string / default
 * fallbacks the handler-side parser expects.
 *
 * @property vehicleId the numeric vehicle id (web `vehicle_id`), `0` when the host has not resolved one.
 * @property departBy the RFC3339 departure timestamp (web `depart_by`), `""` when unresolved.
 * @property currentCabinTempC the latest cabin temperature in Celsius (web `current_cabin_temp_c`), `0.0`
 *   when unresolved or non-finite.
 * @property outsideTempC the latest outside temperature in Celsius (web `outside_temp_c`), `0.0` when
 *   unresolved or non-finite.
 * @property targetCabinTempC the target cabin temperature in Celsius (web `target_cabin_temp_c`), defaulting
 *   to [DEFAULT_TARGET_CABIN_TEMP_C].
 */
data class PreheatDraftBody(
    val vehicleId: Long,
    val departBy: String,
    val currentCabinTempC: Double,
    val outsideTempC: Double,
    val targetCabinTempC: Double,
)

/**
 * The host-supplied inputs the parent ClimateControlPage threads into the surface — the native analogue of
 * InnerSection's props. All are optional because the active-vehicle context, the latest telemetry, and the
 * departure time may be unresolved at first paint; the surface still renders (the AI gate has already passed)
 * but the Draft action stays disabled until every required input is present, mirroring the web `canStart`.
 *
 * @property vehicleId the active vehicle id (web `vehicleId`); a positive value is required for [canStart].
 * @property departBy the RFC3339 departure timestamp (web `departBy`); non-empty is required for [canStart].
 * @property currentCabinTempC the latest cabin temperature in Celsius (web `currentCabinTempC`); a finite
 *   value is required for [canStart].
 * @property outsideTempC the latest outside temperature in Celsius (web `outsideTempC`); a finite value is
 *   required for [canStart].
 * @property targetCabinTempC the target cabin temperature in Celsius (web `targetCabinTempC`); optional —
 *   resolves to [DEFAULT_TARGET_CABIN_TEMP_C] when absent or non-finite, and never gates [canStart].
 */
data class PreheatDraftInputs(
    val vehicleId: Long? = null,
    val departBy: String? = null,
    val currentCabinTempC: Double? = null,
    val outsideTempC: Double? = null,
    val targetCabinTempC: Double? = null,
) {
    /** Web `haveVehicle = Number.isFinite(numericVehicleId) && numericVehicleId > 0`. */
    val haveVehicle: Boolean get() = vehicleId != null && vehicleId > 0L

    /** Web `haveDepart = typeof departBy === 'string' && departBy.length > 0`. */
    val haveDepart: Boolean get() = !departBy.isNullOrEmpty()

    /** Web `haveCabin = typeof currentCabinTempC === 'number' && Number.isFinite(currentCabinTempC)`. */
    val haveCabin: Boolean get() = currentCabinTempC != null && currentCabinTempC.isFinite()

    /** Web `haveOutside = typeof outsideTempC === 'number' && Number.isFinite(outsideTempC)`. */
    val haveOutside: Boolean get() = outsideTempC != null && outsideTempC.isFinite()

    /** Web `haveInputs = haveVehicle && haveDepart && haveCabin && haveOutside`: the Draft action gate. */
    val canStart: Boolean get() = haveVehicle && haveDepart && haveCabin && haveOutside

    /** Web `target = (finite) ? targetCabinTempC : 21`: the resolved target grounded into the draft body. */
    val resolvedTargetTempC: Double
        get() = targetCabinTempC?.takeIf { it.isFinite() } ?: DEFAULT_TARGET_CABIN_TEMP_C

    /**
     * Projects the inputs onto the deterministic [PreheatDraftBody] the stream posts — the native analogue
     * of the web `useMemo` body, resolving each absent / non-finite input to the same fallback the handler
     * parser expects (`0` vehicle id, `""` depart-by, `0.0` temperatures, [DEFAULT_TARGET_CABIN_TEMP_C]
     * target). Mirrors the web body exactly: the vehicle id and temperatures are passed through without the
     * `> 0` guard (that guard only gates [canStart]), so the projection is a pure value mapping.
     */
    fun toRequestBody(): PreheatDraftBody =
        PreheatDraftBody(
            vehicleId = vehicleId ?: 0L,
            departBy = departBy ?: "",
            currentCabinTempC = currentCabinTempC.orZeroWhenNotFinite(),
            outsideTempC = outsideTempC.orZeroWhenNotFinite(),
            targetCabinTempC = resolvedTargetTempC,
        )
}

/** Web `Number.isFinite(x) ? x : 0`: a non-finite or absent value collapses to `0.0` in the request body. */
private fun Double?.orZeroWhenNotFinite(): Double = this?.takeIf { it.isFinite() } ?: 0.0

/**
 * The immutable surface state the [AIPreheatPrecoolRecommenderViewModel] exposes. It carries the AI feature
 * gate (web `withAiFeature`), the resolved host [inputs] (web InnerSection's props -> `canStart`), the stream
 * [phase], the in-flight [streamingText] accumulator, the last committed draft ([committedText], kept across
 * a failed regenerate so an offline surface can still show last-known), the classified [errorKind], and the
 * completion [fetchedAt] stamp used for the freshness check.
 *
 * @property gateEnabled whether the AI feature is on (web `useAiEnabled('preheat-precool-recommender')`).
 * @property inputs the resolved host inputs (web props); incomplete inputs disable the Draft action.
 * @property phase the stream lifecycle phase.
 * @property streamingText the delta accumulator for the in-flight stream (web useAiStream `text`).
 * @property committedText the last successfully completed draft, preserved for the offline surface.
 * @property errorKind the classification of the most recent failure, or `null`.
 * @property fetchedAt epoch-millis stamp of [committedText], or `null` when nothing has completed.
 */
data class PreheatDraftState(
    val gateEnabled: Boolean = true,
    val inputs: PreheatDraftInputs = PreheatDraftInputs(),
    val phase: DraftPhase = DraftPhase.Idle,
    val streamingText: String = "",
    val committedText: String = "",
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /** Web `canStart = haveInputs`: the Draft action is available only when every input is resolved. */
    val canStart: Boolean get() = inputs.canStart

    /** True while a stream is open (drives the button's busy affordance + disables re-entry). */
    val isStreaming: Boolean get() = phase == DraftPhase.Streaming
}

/**
 * Opens a fresh draft: enter [DraftPhase.Streaming], clear the in-flight accumulator, and drop any prior
 * error. The last [PreheatDraftState.committedText] is intentionally retained (not shown while streaming) so
 * a failed regenerate can fall back to last-known — the web clears its visible text the same way at
 * `start()`, surfacing the thinking indicator until the first delta.
 */
fun PreheatDraftState.startGenerating(): PreheatDraftState = copy(phase = DraftPhase.Streaming, streamingText = "", errorKind = null)

/** Reduces one parsed [AiStreamChunk] into the next state (delta accumulation / done / failure). */
fun PreheatDraftState.onChunk(
    chunk: AiStreamChunk,
    nowMs: Long,
): PreheatDraftState =
    when (chunk) {
        is AiStreamChunk.Delta -> copy(streamingText = streamingText + chunk.text)
        AiStreamChunk.Done -> markDone(nowMs)
        is AiStreamChunk.Failed -> markFailed(chunk.errorKind)
    }

/**
 * Commits the accumulated text as the draft and stamps it for the freshness check. A blank result keeps a
 * blank [PreheatDraftState.committedText] so the surface renders its friendly empty state rather than an
 * empty box.
 */
fun PreheatDraftState.markDone(nowMs: Long): PreheatDraftState =
    copy(phase = DraftPhase.Done, committedText = streamingText, fetchedAt = nowMs)

/** Marks the stream failed with the classified [kind]; the prior committed draft is left intact. */
fun PreheatDraftState.markFailed(kind: ErrorKind): PreheatDraftState = copy(phase = DraftPhase.Failed, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the
 * web hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the
 * thinking indicator.
 */
fun PreheatDraftState.finishIfStreaming(nowMs: Long): PreheatDraftState = if (phase == DraftPhase.Streaming) markDone(nowMs) else this

/**
 * The render-ready classification of [PreheatDraftState] — a closed set of mutually-exclusive surfaces the
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

    /** Streaming with partial text — the draft schedule rendering live as it arrives. */
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
    state: PreheatDraftState,
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
private fun failedSurface(state: PreheatDraftState): DraftSurface {
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
