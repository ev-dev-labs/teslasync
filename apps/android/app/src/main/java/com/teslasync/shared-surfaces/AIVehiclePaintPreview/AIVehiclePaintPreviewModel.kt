// Pure, framework-free model + reducer + surface classifier for the AIVehiclePaintPreview shared surface — the
// native analogue of everything the web component derives around its stream
// (web/src/components/ai/AIVehiclePaintPreview.tsx → AIFeatureCard → AiOutputPanel, driven by useAiStream).
// No Compose, no Android UI, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web surface is `withAiFeature('vehicle-paint-preview', InnerSection)`. InnerSection POSTs an optional
// `{ style_hint }` body to `/ai/vehicles/{vehicleID}/paint-preview/draft` via useAiStream (the vehicle id rides
// in the URL path, never the body) and feeds the accumulated delta text, lifecycle state, and error into
// AIFeatureCard. Helix drafts a propose-only paint-color image prompt grounded in the vehicle's redacted
// read-only context (model, trim, current exterior color); the draft is never applied — the operator reviews
// the proposed prompt, then uses the deterministic Color setting to apply it (ADR-015 propose-only contract).
// The HOC renders nothing when the AI feature is gated off (ai_mode off), reproduced as
// [PaintPreviewSurface.Hidden] (Honesty Covenant #9: documented, not silent). Every other state renders a
// non-blank surface as the P3 contract requires.
//
// The useAiStream lifecycle (idle -> streaming -> done | error) is mapped onto the P3 state vocabulary:
//   loading  => Streaming with no delta yet ([PaintPreviewSurface.Working], a thinking indicator)
//   empty    => Idle ([PaintPreviewSurface.Resting], the resting card inviting a draft) or a blank Done
//   content  => Live (streaming partial text) / Ready (completed image-prompt narration)
//   error    => Failed (no last-known) — a QueryError-equivalent with retry
//   stale    => Ready with a draft older than the freshness window (a stale chip + manual re-draft)
//   offline  => Cached (a network failure that keeps the last-known draft + an offline chip + retry)
// Drafting a paint preview is an explicit, billable LLM action, so the stale surface invites a manual re-draft
// rather than auto-refreshing (documented divergence from the templated "auto-refresh", Honesty Covenant #9).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling AIRangePrediction / AICostForecastNarration surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aivehiclepaintpreview

import io.teslasync.android.data.ErrorKind

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, vehicle id, style
 * hint, or any generated text, so a diagnostics line can never leak the operator's fleet state or the draft.
 */
const val AI_VEHICLE_PAINT_PREVIEW_SLUG: String = "AIVehiclePaintPreview"

/**
 * The backend handler's cap on the optional style hint (`The handler caps this at 80 characters`, per the web
 * source). Mirrored here so [normalizeStyleHint] clamps the hint before the request leaves the device, keeping
 * the client honest about what the backend will actually read — the same parity-with-honesty mirroring the
 * sibling AIRangePrediction applies to its server-side `days` cap.
 */
const val PAINT_PREVIEW_STYLE_HINT_MAX_CHARS: Int = 80

/**
 * How long a completed draft is considered fresh before the surface flags it stale and invites a manual
 * re-draft. Five minutes mirrors the app's live-data staleness budget; it is generous because a drafted image
 * prompt does not churn second-to-second.
 */
const val PAINT_PREVIEW_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

/** The relative path the draft stream is opened against — the native mirror of the web `useAiStream` url. */
private const val PAINT_PREVIEW_PATH_PREFIX: String = "/ai/vehicles/"
private const val PAINT_PREVIEW_PATH_SUFFIX: String = "/paint-preview/draft"

/** The JSON body field carrying the optional style hint (snake_case, matching the Go handler's tag). */
const val PAINT_PREVIEW_STYLE_HINT_FIELD: String = "style_hint"

/** The useAiStream lifecycle, narrowed to what this surface reacts to (idle -> streaming -> done | failed). */
enum class PaintPreviewPhase {
    /** No draft requested yet — the resting card with the Preview action (web `state === 'idle'`). */
    Idle,

    /** A stream is open; delta text accumulates until a terminal frame (web `state === 'streaming'`). */
    Streaming,

    /** The stream closed successfully — the accumulated text is the drafted prompt (web `state === 'done'`). */
    Done,

    /** The stream ended in a terminal error frame or threw (web `state === 'error'`). */
    Failed,
}

/**
 * One parsed frame of the draft stream — the native narrowing of the web `AiStreamEvent` union that this
 * surface consumes. Delta frames accumulate text; [Done] closes the stream successfully; [Failed] carries the
 * classified transport/HTTP failure so the render boundary can localize it (never the raw provider message).
 */
sealed interface PaintPreviewChunk {
    /** A `delta` frame — a chunk of generated prose appended to the accumulator (web `delta.text`). */
    data class Delta(
        val text: String,
    ) : PaintPreviewChunk

    /** The terminal `done` frame — the stream finished cleanly. */
    data object Done : PaintPreviewChunk

    /** A terminal `error` frame — carries the [ErrorKind] the UI maps to localized recovery copy. */
    data class Failed(
        val errorKind: ErrorKind,
    ) : PaintPreviewChunk
}

/**
 * The immutable surface state the [AIVehiclePaintPreviewViewModel] exposes. It carries the AI feature gate
 * (web `withAiFeature`), the selected vehicle (web InnerSection's `vehicleId` prop -> `canStart`), the stream
 * [phase], the in-flight [streamingText] accumulator, the last committed draft ([committedText], kept across a
 * failed re-draft so an offline surface can still show last-known), the classified [errorKind], and the
 * completion [fetchedAt] stamp used for the freshness check.
 *
 * The optional `style_hint` is intentionally NOT part of this render state — it is a request input that never
 * changes what is drawn (the card looks identical with or without a hint), so the view-model holds it
 * separately and threads it into the draft request. Keeping it out of the surface state preserves a clean
 * render-state/request-input separation, mirroring how the sibling AIRangePrediction holds its `days` window.
 *
 * @property gateEnabled whether the AI feature is on (web `useAiEnabled('vehicle-paint-preview')`).
 * @property vehicleId the active vehicle (web prop); a value `<= 0` (or `null`) => the draft action is disabled.
 * @property phase the stream lifecycle phase.
 * @property streamingText the delta accumulator for the in-flight stream (web useAiStream `text`).
 * @property committedText the last successfully completed draft, preserved for the offline surface.
 * @property errorKind the classification of the most recent failure, or `null`.
 * @property fetchedAt epoch-millis stamp of [committedText], or `null` when nothing has completed.
 */
data class PaintPreviewState(
    val gateEnabled: Boolean = true,
    val vehicleId: Long? = null,
    val phase: PaintPreviewPhase = PaintPreviewPhase.Idle,
    val streamingText: String = "",
    val committedText: String = "",
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /**
     * Web `haveInputs = numericVehicleId > 0`: the draft action is available only with a real selected vehicle.
     * The web treats a non-finite or `<= 0` id as "no vehicle" (the button stays disabled and the no-vehicle
     * hint shows), reproduced here by requiring a positive id.
     */
    val canStart: Boolean get() = (vehicleId ?: 0L) > 0L

    /** True while a stream is open (drives the button's busy affordance + disables re-entry). */
    val isStreaming: Boolean get() = phase == PaintPreviewPhase.Streaming
}

/**
 * Resolves the optional style hint for a request — the native mirror of the web `body` memo
 * (`if (styleHint.trim() !== '') payload.style_hint = styleHint.trim()`). Trims the raw input; a blank or
 * absent hint resolves to `null` so the request body omits `style_hint` entirely (exactly as the web omits the
 * key). A non-blank hint is clamped to [PAINT_PREVIEW_STYLE_HINT_MAX_CHARS] so the client never asks the
 * handler to read past the cap it enforces.
 */
fun normalizeStyleHint(raw: String?): String? {
    val trimmed = raw?.trim().orEmpty()
    if (trimmed.isEmpty()) return null
    return trimmed.take(PAINT_PREVIEW_STYLE_HINT_MAX_CHARS)
}

/**
 * Builds the draft endpoint path for [vehicleId] — the native mirror of the web url
 * `/ai/vehicles/${numericVehicleId}/paint-preview/draft`. The shared SSE client prepends `/api/v1`, so this is
 * the post-prefix path the host adapter opens the stream against; co-located here so the wire route is pinned
 * by a unit test against the backend's `/ai/vehicles/{vehicleID}/paint-preview/draft` handler.
 */
fun paintPreviewDraftPath(vehicleId: Long): String = "$PAINT_PREVIEW_PATH_PREFIX$vehicleId$PAINT_PREVIEW_PATH_SUFFIX"

/**
 * Builds the request body the host adapter POSTs — the native mirror of the web `body` payload. Returns an
 * empty map when [styleHint] is `null` (the web omits the `style_hint` key for a blank hint) and a single
 * `style_hint` entry otherwise. Pass the already-resolved hint from [normalizeStyleHint].
 */
fun paintPreviewRequestBody(styleHint: String?): Map<String, String> =
    if (styleHint == null) emptyMap() else mapOf(PAINT_PREVIEW_STYLE_HINT_FIELD to styleHint)

/**
 * Opens a fresh draft run: enter [PaintPreviewPhase.Streaming], clear the in-flight accumulator, and drop any
 * prior error. The last [PaintPreviewState.committedText] is intentionally retained (not shown while streaming)
 * so a failed re-draft can fall back to last-known — the web clears its visible text the same way at
 * `start()`, surfacing the thinking indicator until the first delta.
 */
fun PaintPreviewState.startDrafting(): PaintPreviewState = copy(phase = PaintPreviewPhase.Streaming, streamingText = "", errorKind = null)

/** Reduces one parsed [PaintPreviewChunk] into the next state (delta accumulation / done / failure). */
fun PaintPreviewState.onChunk(
    chunk: PaintPreviewChunk,
    nowMs: Long,
): PaintPreviewState =
    when (chunk) {
        is PaintPreviewChunk.Delta -> copy(streamingText = streamingText + chunk.text)
        PaintPreviewChunk.Done -> markDone(nowMs)
        is PaintPreviewChunk.Failed -> markFailed(chunk.errorKind)
    }

/**
 * Commits the accumulated text as the drafted prompt and stamps it for the freshness check. A blank result
 * keeps a blank [PaintPreviewState.committedText] so the surface renders its friendly empty body rather than an
 * empty box.
 */
fun PaintPreviewState.markDone(nowMs: Long): PaintPreviewState =
    copy(phase = PaintPreviewPhase.Done, committedText = streamingText, fetchedAt = nowMs)

/** Marks the stream failed with the classified [kind]; the prior committed draft is left intact. */
fun PaintPreviewState.markFailed(kind: ErrorKind): PaintPreviewState = copy(phase = PaintPreviewPhase.Failed, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the
 * web hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the
 * thinking indicator.
 */
fun PaintPreviewState.finishIfStreaming(nowMs: Long): PaintPreviewState =
    if (phase == PaintPreviewPhase.Streaming) markDone(nowMs) else this

/**
 * The render-ready classification of [PaintPreviewState] — a closed set of mutually-exclusive surfaces the view
 * switches on, so every branch is exhaustively covered and unit-tested off-device. Maps the stream lifecycle
 * onto the P3 loading / empty / content / error / stale / offline contract.
 */
sealed interface PaintPreviewSurface {
    /** The AI feature is gated off — the whole surface collapses (web `withAiFeature` renders `null`). */
    data object Hidden : PaintPreviewSurface

    /** Resting/idle: the card with the Preview action, enabled only when [canStart] (web `canStart`). */
    data class Resting(
        val canStart: Boolean,
    ) : PaintPreviewSurface

    /** Streaming with no delta yet — the thinking indicator (the surface's loading state). */
    data object Working : PaintPreviewSurface

    /** Streaming with partial text — the drafted prompt rendering live as it arrives. */
    data class Live(
        val text: String,
    ) : PaintPreviewSurface

    /** Completed with text — the drafted prompt; [stale] flags a draft older than the freshness window. */
    data class Ready(
        val text: String,
        val stale: Boolean,
    ) : PaintPreviewSurface

    /** Completed but blank — a friendly empty body (the model returned nothing). */
    data object Empty : PaintPreviewSurface

    /** Failed but a prior draft exists — last-known kept visible; [offline] picks the chip/copy. */
    data class Cached(
        val text: String,
        val offline: Boolean,
    ) : PaintPreviewSurface

    /** Failed with no last-known — a QueryError-equivalent with retry; [offline] picks the recovery copy. */
    data class Failed(
        val offline: Boolean,
    ) : PaintPreviewSurface
}

/**
 * Selects the render-ready [PaintPreviewSurface] for [state]. Pure (no Compose/clock): the caller supplies
 * [nowMs] and the [windowMs] freshness budget so the staleness decision is deterministic and testable.
 */
fun classifyPaintPreview(
    state: PaintPreviewState,
    nowMs: Long,
    windowMs: Long = PAINT_PREVIEW_FRESHNESS_WINDOW_MS,
): PaintPreviewSurface {
    if (!state.gateEnabled) return PaintPreviewSurface.Hidden
    return when (state.phase) {
        PaintPreviewPhase.Idle -> PaintPreviewSurface.Resting(state.canStart)
        PaintPreviewPhase.Streaming ->
            if (state.streamingText.isBlank()) {
                PaintPreviewSurface.Working
            } else {
                PaintPreviewSurface.Live(state.streamingText)
            }

        PaintPreviewPhase.Done ->
            if (state.committedText.isBlank()) {
                PaintPreviewSurface.Empty
            } else {
                PaintPreviewSurface.Ready(state.committedText, isStale(state.fetchedAt, nowMs, windowMs))
            }

        PaintPreviewPhase.Failed -> failedSurface(state)
    }
}

/** Failure -> last-known [PaintPreviewSurface.Cached] when a prior draft exists, else a hard failure. */
private fun failedSurface(state: PaintPreviewState): PaintPreviewSurface {
    val offline = state.errorKind == ErrorKind.Network
    return if (state.committedText.isNotBlank()) {
        PaintPreviewSurface.Cached(state.committedText, offline)
    } else {
        PaintPreviewSurface.Failed(offline)
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
 * title, the "Helix" badge, and the description as one block, plus the no-vehicle hint when no vehicle is
 * selected). A blank [hint] is omitted. Kept pure so TalkBack-label presence is unit-tested without a Compose
 * host.
 */
fun headerAccessibilityLabel(
    title: String,
    badge: String,
    description: String,
    hint: String? = null,
): String {
    val base = "$title ($badge). $description"
    return if (hint.isNullOrBlank()) base else "$base $hint"
}

/**
 * Builds the accessibility description for the output region per [surface] from already-localized parts, or
 * `null` when the output region carries no announcement (the resting/hidden surfaces, whose card chrome is
 * announced instead). Pure so the per-state a11y labels are unit-tested off-device.
 */
fun outputAccessibilityLabel(
    surface: PaintPreviewSurface,
    labels: PaintPreviewOutputLabels,
): String? =
    when (surface) {
        PaintPreviewSurface.Hidden, is PaintPreviewSurface.Resting -> null
        PaintPreviewSurface.Working, is PaintPreviewSurface.Live -> labels.working
        PaintPreviewSurface.Empty -> labels.empty
        is PaintPreviewSurface.Ready -> if (surface.stale) "${labels.stale}. ${surface.text}" else surface.text
        is PaintPreviewSurface.Cached -> "${if (surface.offline) labels.offline else labels.error}. ${surface.text}"
        is PaintPreviewSurface.Failed -> labels.error
    }

/** The localized announcement fragments [outputAccessibilityLabel] composes — resolved by the view from i18n. */
data class PaintPreviewOutputLabels(
    val working: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val error: String,
)
