// Pure, framework-free model + reducer + surface classifier for the AILearnedAnomalyBaselines shared surface —
// the native analogue of everything the web component derives around its stream
// (web/src/components/ai/AILearnedAnomalyBaselines.tsx → AIFeatureCard, driven by useAiStream).
// No Compose, no Android UI, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web surface is `withAiFeature('learned-per-vehicle-anomaly-baselines', InnerSection)`. InnerSection POSTs
// { vehicle_id, days: 14 } to `/ai/ml/anomaly-baselines/train` via useAiStream and feeds the accumulated delta
// text, lifecycle state, and error into AIFeatureCard. Unlike the sibling cost-forecast surface (whose `months`
// horizon is optional and omitted when unset), `days` is ALWAYS sent — the web hardcodes the 14-day learning
// window — so it is modelled here as a non-null request input defaulting to [ANOMALY_BASELINE_DEFAULT_DAYS] and
// normalised positive by [normalizeDays] (the trainer clamps anything above [ANOMALY_BASELINE_MAX_DAYS]=30
// server-side, mirrored in the web comment, so it is intentionally NOT clamped here — Honesty Covenant #9:
// documented, not silent). The HOC renders nothing when the AI feature is gated off (ai_mode off), so the
// canonical baseline this surface ships against is "gate off => nothing rendered" — reproduced here as
// [BaselineSurface.Hidden]. Every other state renders a non-blank surface as the P3 contract requires.
//
// The useAiStream lifecycle (idle -> streaming -> done | error) is mapped onto the P3 state vocabulary:
//   loading  => Streaming with no delta yet ([BaselineSurface.Working], a thinking indicator)
//   empty    => Idle ([BaselineSurface.Resting], the resting card inviting a train) or a blank Done
//   content  => Live (streaming partial text) / Ready (completed narration)
//   error    => Failed (no last-known) — a QueryError-equivalent with retry
//   stale    => Ready with a fetch older than the freshness window (a stale chip + manual retrain)
//   offline  => Cached (a network failure that keeps the last-known narration + an offline chip + retry)
// Re-running an LLM training pass is an explicit, billable action, so the stale surface invites a manual
// retrain rather than auto-refreshing (documented divergence from the templated "auto-refresh", Covenant #9).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling AICostForecastNarration / AIAlertTuningSuggestions surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ailearnedanomalybaselines

import io.teslasync.android.data.ErrorKind

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, vehicle id, or any
 * generated text, so a diagnostics line can never leak the operator's fleet state or the model output.
 */
const val AI_LEARNED_ANOMALY_BASELINES_SLUG: String = "AILearnedAnomalyBaselines"

/**
 * The learning window the web hardcodes in the train request body (`days: 14`). Wide enough to capture a
 * representative weekly cadence, narrow enough that a recent owner-behaviour change is reflected within a
 * couple of weeks. Documented here so callers know the default the surface threads when no override is given.
 */
const val ANOMALY_BASELINE_DEFAULT_DAYS: Int = 14

/**
 * The trainer's server-side upper bound (`anomaly.MaxDays`): wider windows are silently capped server-side
 * (per the web source comment). Documented for callers; the client deliberately does NOT clamp to it so the
 * request stays byte-for-byte faithful to whatever horizon was asked for (Honesty Covenant #9).
 */
const val ANOMALY_BASELINE_MAX_DAYS: Int = 30

/**
 * How long a completed training narration is considered fresh before the surface flags it stale and invites a
 * manual retrain. Five minutes mirrors the app's live-data staleness budget; it is generous because an LLM
 * narration of a learned envelope does not churn second-to-second.
 */
const val BASELINE_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

/** The useAiStream lifecycle, narrowed to what this surface reacts to (idle -> streaming -> done | failed). */
enum class TrainingPhase {
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
sealed interface AiBaselineChunk {
    /** A `delta` frame — a chunk of generated prose appended to the accumulator (web `delta.text`). */
    data class Delta(
        val text: String,
    ) : AiBaselineChunk

    /** The terminal `done` frame — the stream finished cleanly. */
    data object Done : AiBaselineChunk

    /** A terminal `error` frame — carries the [ErrorKind] the UI maps to localized recovery copy. */
    data class Failed(
        val errorKind: ErrorKind,
    ) : AiBaselineChunk
}

/**
 * The immutable surface state the [AILearnedAnomalyBaselinesViewModel] exposes. It carries the AI feature gate
 * (web `withAiFeature`), the selected vehicle (web InnerSection's `vehicleId` prop -> `canStart`), the stream
 * [phase], the in-flight [streamingText] accumulator, the last committed narration ([committedText], kept
 * across a failed retrain so an offline surface can still show last-known), the classified [errorKind], and
 * the completion [fetchedAt] stamp used for the freshness check.
 *
 * The web `days` horizon is intentionally NOT part of this render state — it is a request input that never
 * changes what is drawn (the surface looks identical for any window), so the view-model holds it separately
 * and threads it into the train request. Keeping it out of the surface state preserves a clean
 * render-state/request-input separation.
 *
 * @property gateEnabled whether the AI feature is on (web `useAiEnabled('learned-per-vehicle-anomaly-baselines')`).
 * @property vehicleId the active vehicle (web prop); `null` => the train action is disabled.
 * @property phase the stream lifecycle phase.
 * @property streamingText the delta accumulator for the in-flight stream (web useAiStream `text`).
 * @property committedText the last successfully completed narration, preserved for the offline surface.
 * @property errorKind the classification of the most recent failure, or `null`.
 * @property fetchedAt epoch-millis stamp of [committedText], or `null` when nothing has completed.
 */
data class AiBaselineState(
    val gateEnabled: Boolean = true,
    val vehicleId: Long? = null,
    val phase: TrainingPhase = TrainingPhase.Idle,
    val streamingText: String = "",
    val committedText: String = "",
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /** Web `canStart = vehicleId != null`: the train action is available only with a selected vehicle. */
    val canStart: Boolean get() = vehicleId != null

    /** True while a stream is open (drives the button's busy affordance + disables re-entry). */
    val isStreaming: Boolean get() = phase == TrainingPhase.Streaming
}

/**
 * Normalises the learning window threaded into the train request. A non-positive window is coerced to
 * [ANOMALY_BASELINE_DEFAULT_DAYS] (the web always sends a positive `days: 14`, so a zero/negative override is
 * treated as "use the default" rather than sent verbatim). The upper bound is deliberately left unclamped —
 * the trainer caps it server-side at [ANOMALY_BASELINE_MAX_DAYS] (Honesty Covenant #9: documented, not silent).
 */
fun normalizeDays(days: Int): Int = if (days > 0) days else ANOMALY_BASELINE_DEFAULT_DAYS

/**
 * Opens a fresh training pass: enter [TrainingPhase.Streaming], clear the in-flight accumulator, and drop any
 * prior error. The last [AiBaselineState.committedText] is intentionally retained (not shown while streaming)
 * so a failed retrain can fall back to last-known — the web clears its visible text the same way at `start()`,
 * surfacing the thinking indicator until the first delta.
 */
fun AiBaselineState.startGenerating(): AiBaselineState = copy(phase = TrainingPhase.Streaming, streamingText = "", errorKind = null)

/** Reduces one parsed [AiBaselineChunk] into the next state (delta accumulation / done / failure). */
fun AiBaselineState.onChunk(
    chunk: AiBaselineChunk,
    nowMs: Long,
): AiBaselineState =
    when (chunk) {
        is AiBaselineChunk.Delta -> copy(streamingText = streamingText + chunk.text)
        AiBaselineChunk.Done -> markDone(nowMs)
        is AiBaselineChunk.Failed -> markFailed(chunk.errorKind)
    }

/**
 * Commits the accumulated text as the narration and stamps it for the freshness check. A blank result keeps a
 * blank [AiBaselineState.committedText] so the surface renders its friendly empty state rather than an empty
 * box.
 */
fun AiBaselineState.markDone(nowMs: Long): AiBaselineState =
    copy(phase = TrainingPhase.Done, committedText = streamingText, fetchedAt = nowMs)

/** Marks the stream failed with the classified [kind]; the prior committed narration is left intact. */
fun AiBaselineState.markFailed(kind: ErrorKind): AiBaselineState = copy(phase = TrainingPhase.Failed, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the
 * web hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the
 * thinking indicator.
 */
fun AiBaselineState.finishIfStreaming(nowMs: Long): AiBaselineState = if (phase == TrainingPhase.Streaming) markDone(nowMs) else this

/**
 * The render-ready classification of [AiBaselineState] — a closed set of mutually-exclusive surfaces the view
 * switches on, so every branch is exhaustively covered and unit-tested off-device. Maps the stream lifecycle
 * onto the P3 loading / empty / content / error / stale / offline contract.
 */
sealed interface BaselineSurface {
    /** The AI feature is gated off — the whole surface collapses (web `withAiFeature` renders `null`). */
    data object Hidden : BaselineSurface

    /** Resting/idle: the card with the Train action, enabled only when [canStart] (web `canStart`). */
    data class Resting(
        val canStart: Boolean,
    ) : BaselineSurface

    /** Streaming with no delta yet — the thinking indicator (the surface's loading state). */
    data object Working : BaselineSurface

    /** Streaming with partial text — the narration rendering live as it arrives. */
    data class Live(
        val text: String,
    ) : BaselineSurface

    /** Completed with text — the narration; [stale] flags a fetch older than the freshness window. */
    data class Ready(
        val text: String,
        val stale: Boolean,
    ) : BaselineSurface

    /** Completed but blank — a friendly empty state (the model returned nothing). */
    data object Empty : BaselineSurface

    /** Failed but a prior narration exists — last-known kept visible; [offline] picks the chip/copy. */
    data class Cached(
        val text: String,
        val offline: Boolean,
    ) : BaselineSurface

    /** Failed with no last-known — a QueryError-equivalent with retry; [offline] picks the recovery copy. */
    data class Failed(
        val offline: Boolean,
    ) : BaselineSurface
}

/**
 * Selects the render-ready [BaselineSurface] for [state]. Pure (no Compose/clock): the caller supplies [nowMs]
 * and the [windowMs] freshness budget so the staleness decision is deterministic and testable.
 */
fun classifyBaseline(
    state: AiBaselineState,
    nowMs: Long,
    windowMs: Long = BASELINE_FRESHNESS_WINDOW_MS,
): BaselineSurface {
    if (!state.gateEnabled) return BaselineSurface.Hidden
    return when (state.phase) {
        TrainingPhase.Idle -> BaselineSurface.Resting(state.canStart)
        TrainingPhase.Streaming ->
            if (state.streamingText.isBlank()) {
                BaselineSurface.Working
            } else {
                BaselineSurface.Live(state.streamingText)
            }

        TrainingPhase.Done ->
            if (state.committedText.isBlank()) {
                BaselineSurface.Empty
            } else {
                BaselineSurface.Ready(state.committedText, isStale(state.fetchedAt, nowMs, windowMs))
            }

        TrainingPhase.Failed -> failedSurface(state)
    }
}

/** Failure -> last-known [BaselineSurface.Cached] when a prior narration exists, else a hard failure. */
private fun failedSurface(state: AiBaselineState): BaselineSurface {
    val offline = state.errorKind == ErrorKind.Network
    return if (state.committedText.isNotBlank()) {
        BaselineSurface.Cached(state.committedText, offline)
    } else {
        BaselineSurface.Failed(offline)
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
    surface: BaselineSurface,
    labels: BaselineOutputLabels,
): String? =
    when (surface) {
        BaselineSurface.Hidden, is BaselineSurface.Resting -> null
        BaselineSurface.Working, is BaselineSurface.Live -> labels.working
        BaselineSurface.Empty -> labels.empty
        is BaselineSurface.Ready -> if (surface.stale) "${labels.stale}. ${surface.text}" else surface.text
        is BaselineSurface.Cached -> "${if (surface.offline) labels.offline else labels.error}. ${surface.text}"
        is BaselineSurface.Failed -> labels.error
    }

/** The localized announcement fragments [outputAccessibilityLabel] composes — resolved by the view from i18n. */
data class BaselineOutputLabels(
    val working: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val error: String,
)
