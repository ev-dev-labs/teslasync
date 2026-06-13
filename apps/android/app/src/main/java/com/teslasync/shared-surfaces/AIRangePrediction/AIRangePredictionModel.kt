// Pure, framework-free model + reducer + surface classifier for the AIRangePrediction shared surface — the
// native analogue of everything the web component derives around its stream
// (web/src/components/ai/AIRangePrediction.tsx → AIFeatureCard → AiOutputPanel, driven by useAiStream).
// No Compose, no Android UI, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web surface is `withAiFeature('range-prediction-model', InnerSection)`. InnerSection POSTs
// { vehicle_id, days: 14 } to `/ai/ml/range/train` via useAiStream and feeds the accumulated delta text,
// lifecycle state, and error into AIFeatureCard. The narration walks the operator through the per-bucket
// (temp_bucket × speed_bucket) learned Wh/km envelope train_range_model returns; the AI is read-only narration
// over the learned envelope (ADR-015 §I3 + §I8 propose-only contract). Unlike the sibling cost-forecast
// narration, `days` is a fixed 14-day learning window in the web (not a user-facing prop), so it is always sent
// (never omitted) — see [normalizeDays]; the trainer clamps the upper bound at mlrange.MaxDays=30, mirrored by
// [RANGE_MODEL_MAX_DAYS] so a wider window is capped before the request leaves the device. The HOC renders
// nothing when the AI feature is gated off (ai_mode off), reproduced as [RangeModelSurface.Hidden] (Honesty
// Covenant #9: documented, not silent). Every other state renders a non-blank surface as the P3 contract
// requires.
//
// The useAiStream lifecycle (idle -> streaming -> done | error) is mapped onto the P3 state vocabulary:
//   loading  => Streaming with no delta yet ([RangeModelSurface.Working], a thinking indicator)
//   empty    => Idle ([RangeModelSurface.Resting], the resting card inviting a train) or a blank Done
//   content  => Live (streaming partial text) / Ready (completed narration)
//   error    => Failed (no last-known) — a QueryError-equivalent with retry
//   stale    => Ready with a fetch older than the freshness window (a stale chip + manual re-train)
//   offline  => Cached (a network failure that keeps the last-known narration + an offline chip + retry)
// Re-training an LLM range model is an explicit, billable action, so the stale surface invites a manual
// re-train rather than auto-refreshing (documented divergence from the templated "auto-refresh", Honesty
// Covenant #9).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling AICostForecastNarration / AIAlertTuningSuggestions surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.airangeprediction

import io.teslasync.android.data.ErrorKind

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, vehicle id, or any
 * generated text, so a diagnostics line can never leak the operator's fleet state or the model output.
 */
const val AI_RANGE_PREDICTION_SLUG: String = "AIRangePrediction"

/**
 * The fixed learning window the web InnerSection sends (`days: 14`): wide enough to capture a representative
 * weekly cadence (commuting + weekend long drives), narrow enough that a recent owner-behaviour change (new
 * commute, summer→winter) is reflected in the learned per-bucket Wh/km within a couple of weeks. The web pins
 * this literal with no UI control, so it is the default the surface trains over.
 */
const val RANGE_MODEL_TRAINING_DAYS: Int = 14

/**
 * The trainer's upper bound (`mlrange.MaxDays`): the server silently caps wider windows. Mirrored here so
 * [normalizeDays] caps the request before it leaves the device, keeping the client honest about what the
 * backend will actually train over.
 */
const val RANGE_MODEL_MAX_DAYS: Int = 30

/**
 * How long a completed narration is considered fresh before the surface flags it stale and invites a manual
 * re-train. Five minutes mirrors the app's live-data staleness budget; it is generous because a narration of
 * a learned range envelope does not churn second-to-second.
 */
const val RANGE_MODEL_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

/** The useAiStream lifecycle, narrowed to what this surface reacts to (idle -> streaming -> done | failed). */
enum class RangeModelPhase {
    /** No training requested yet — the resting card with the Train action (web `state === 'idle'`). */
    Idle,

    /** A stream is open; delta text accumulates until a terminal frame (web `state === 'streaming'`). */
    Streaming,

    /** The stream closed successfully — the accumulated text is the narration (web `state === 'done'`). */
    Done,

    /** The stream ended in a terminal error frame or threw (web `state === 'error'`). */
    Failed,
}

/**
 * One parsed frame of the train stream — the native narrowing of the web `AiStreamEvent` union that this
 * surface consumes. Delta frames accumulate text; [Done] closes the stream successfully; [Failed] carries the
 * classified transport/HTTP failure so the render boundary can localize it (never the raw provider message).
 */
sealed interface RangeModelChunk {
    /** A `delta` frame — a chunk of generated prose appended to the accumulator (web `delta.text`). */
    data class Delta(
        val text: String,
    ) : RangeModelChunk

    /** The terminal `done` frame — the stream finished cleanly. */
    data object Done : RangeModelChunk

    /** A terminal `error` frame — carries the [ErrorKind] the UI maps to localized recovery copy. */
    data class Failed(
        val errorKind: ErrorKind,
    ) : RangeModelChunk
}

/**
 * The immutable surface state the [AIRangePredictionViewModel] exposes. It carries the AI feature gate
 * (web `withAiFeature`), the selected vehicle (web InnerSection's `vehicleId` prop -> `canStart`), the stream
 * [phase], the in-flight [streamingText] accumulator, the last committed narration ([committedText], kept
 * across a failed re-train so an offline surface can still show last-known), the classified [errorKind], and
 * the completion [fetchedAt] stamp used for the freshness check.
 *
 * The training-window `days` is intentionally NOT part of this render state — it is a request input that never
 * changes what is drawn (the surface looks identical for any window), so the view-model holds it separately
 * and threads it into the train request. Keeping it out of the surface state preserves a clean
 * render-state/request-input separation.
 *
 * @property gateEnabled whether the AI feature is on (web `useAiEnabled('range-prediction-model')`).
 * @property vehicleId the active vehicle (web prop); `null` => the train action is disabled.
 * @property phase the stream lifecycle phase.
 * @property streamingText the delta accumulator for the in-flight stream (web useAiStream `text`).
 * @property committedText the last successfully completed narration, preserved for the offline surface.
 * @property errorKind the classification of the most recent failure, or `null`.
 * @property fetchedAt epoch-millis stamp of [committedText], or `null` when nothing has completed.
 */
data class RangeModelState(
    val gateEnabled: Boolean = true,
    val vehicleId: Long? = null,
    val phase: RangeModelPhase = RangeModelPhase.Idle,
    val streamingText: String = "",
    val committedText: String = "",
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /** Web `canStart={vehicleId != null}`: the train action is available only with a selected vehicle. */
    val canStart: Boolean get() = vehicleId != null

    /** True while a stream is open (drives the button's busy affordance + disables re-entry). */
    val isStreaming: Boolean get() = phase == RangeModelPhase.Streaming
}

/**
 * Resolves the training window for a request. The web pins `days: 14` with no control, so an absent value
 * falls back to [RANGE_MODEL_TRAINING_DAYS]; any value is clamped to `[1, RANGE_MODEL_MAX_DAYS]` so the client
 * never asks the trainer for a window it will silently cap (mlrange.MaxDays). Unlike the sibling cost-forecast
 * `months`, the result is always a positive int — the web sends `days` unconditionally.
 */
fun normalizeDays(days: Int?): Int = (days ?: RANGE_MODEL_TRAINING_DAYS).coerceIn(1, RANGE_MODEL_MAX_DAYS)

/**
 * Opens a fresh training run: enter [RangeModelPhase.Streaming], clear the in-flight accumulator, and drop any
 * prior error. The last [RangeModelState.committedText] is intentionally retained (not shown while streaming)
 * so a failed re-train can fall back to last-known — the web clears its visible text the same way at
 * `start()`, surfacing the thinking indicator until the first delta.
 */
fun RangeModelState.startTraining(): RangeModelState = copy(phase = RangeModelPhase.Streaming, streamingText = "", errorKind = null)

/** Reduces one parsed [RangeModelChunk] into the next state (delta accumulation / done / failure). */
fun RangeModelState.onChunk(
    chunk: RangeModelChunk,
    nowMs: Long,
): RangeModelState =
    when (chunk) {
        is RangeModelChunk.Delta -> copy(streamingText = streamingText + chunk.text)
        RangeModelChunk.Done -> markDone(nowMs)
        is RangeModelChunk.Failed -> markFailed(chunk.errorKind)
    }

/**
 * Commits the accumulated text as the narration and stamps it for the freshness check. A blank result keeps a
 * blank [RangeModelState.committedText] so the surface renders its friendly empty state rather than an empty
 * box.
 */
fun RangeModelState.markDone(nowMs: Long): RangeModelState =
    copy(phase = RangeModelPhase.Done, committedText = streamingText, fetchedAt = nowMs)

/** Marks the stream failed with the classified [kind]; the prior committed narration is left intact. */
fun RangeModelState.markFailed(kind: ErrorKind): RangeModelState = copy(phase = RangeModelPhase.Failed, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the
 * web hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the
 * thinking indicator.
 */
fun RangeModelState.finishIfStreaming(nowMs: Long): RangeModelState = if (phase == RangeModelPhase.Streaming) markDone(nowMs) else this

/**
 * The render-ready classification of [RangeModelState] — a closed set of mutually-exclusive surfaces the view
 * switches on, so every branch is exhaustively covered and unit-tested off-device. Maps the stream lifecycle
 * onto the P3 loading / empty / content / error / stale / offline contract.
 */
sealed interface RangeModelSurface {
    /** The AI feature is gated off — the whole surface collapses (web `withAiFeature` renders `null`). */
    data object Hidden : RangeModelSurface

    /** Resting/idle: the card with the Train action, enabled only when [canStart] (web `canStart`). */
    data class Resting(
        val canStart: Boolean,
    ) : RangeModelSurface

    /** Streaming with no delta yet — the thinking indicator (the surface's loading state). */
    data object Working : RangeModelSurface

    /** Streaming with partial text — the narration rendering live as it arrives. */
    data class Live(
        val text: String,
    ) : RangeModelSurface

    /** Completed with text — the narration; [stale] flags a fetch older than the freshness window. */
    data class Ready(
        val text: String,
        val stale: Boolean,
    ) : RangeModelSurface

    /** Completed but blank — a friendly empty state (the model returned nothing). */
    data object Empty : RangeModelSurface

    /** Failed but a prior narration exists — last-known kept visible; [offline] picks the chip/copy. */
    data class Cached(
        val text: String,
        val offline: Boolean,
    ) : RangeModelSurface

    /** Failed with no last-known — a QueryError-equivalent with retry; [offline] picks the recovery copy. */
    data class Failed(
        val offline: Boolean,
    ) : RangeModelSurface
}

/**
 * Selects the render-ready [RangeModelSurface] for [state]. Pure (no Compose/clock): the caller supplies
 * [nowMs] and the [windowMs] freshness budget so the staleness decision is deterministic and testable.
 */
fun classifyRangeModel(
    state: RangeModelState,
    nowMs: Long,
    windowMs: Long = RANGE_MODEL_FRESHNESS_WINDOW_MS,
): RangeModelSurface {
    if (!state.gateEnabled) return RangeModelSurface.Hidden
    return when (state.phase) {
        RangeModelPhase.Idle -> RangeModelSurface.Resting(state.canStart)
        RangeModelPhase.Streaming ->
            if (state.streamingText.isBlank()) {
                RangeModelSurface.Working
            } else {
                RangeModelSurface.Live(state.streamingText)
            }

        RangeModelPhase.Done ->
            if (state.committedText.isBlank()) {
                RangeModelSurface.Empty
            } else {
                RangeModelSurface.Ready(state.committedText, isStale(state.fetchedAt, nowMs, windowMs))
            }

        RangeModelPhase.Failed -> failedSurface(state)
    }
}

/** Failure -> last-known [RangeModelSurface.Cached] when a prior narration exists, else a hard failure. */
private fun failedSurface(state: RangeModelState): RangeModelSurface {
    val offline = state.errorKind == ErrorKind.Network
    return if (state.committedText.isNotBlank()) {
        RangeModelSurface.Cached(state.committedText, offline)
    } else {
        RangeModelSurface.Failed(offline)
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
    surface: RangeModelSurface,
    labels: RangeModelOutputLabels,
): String? =
    when (surface) {
        RangeModelSurface.Hidden, is RangeModelSurface.Resting -> null
        RangeModelSurface.Working, is RangeModelSurface.Live -> labels.working
        RangeModelSurface.Empty -> labels.empty
        is RangeModelSurface.Ready -> if (surface.stale) "${labels.stale}. ${surface.text}" else surface.text
        is RangeModelSurface.Cached -> "${if (surface.offline) labels.offline else labels.error}. ${surface.text}"
        is RangeModelSurface.Failed -> labels.error
    }

/** The localized announcement fragments [outputAccessibilityLabel] composes — resolved by the view from i18n. */
data class RangeModelOutputLabels(
    val working: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val error: String,
)
