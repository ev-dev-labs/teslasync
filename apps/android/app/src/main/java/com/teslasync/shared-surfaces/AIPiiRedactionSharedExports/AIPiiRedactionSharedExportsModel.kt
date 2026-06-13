// Pure, framework-free model + reducer + surface classifier for the AIPiiRedactionSharedExports shared surface
// — the native analogue of everything the web component derives around its stream
// (web/src/components/ai/AIPiiRedactionSharedExports.tsx → AIFeatureCard → AiOutputPanel, driven by
// useAiStream). No Compose, no Android UI, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web surface is `withAiFeature('pii-redaction-shared-exports', InnerSection)`. InnerSection holds the
// chosen export_type in local state, POSTs { export_type } to `/ai/exports/redaction/draft` via useAiStream,
// and feeds the accumulated delta text, lifecycle state, and error into AIFeatureCard while rendering the
// export-type Select as the card's input slot. The web `canStart = exportType !== ''` gates the "Suggest
// redactions" action; that exact predicate is reproduced as [AiRedactionPlanState.canStart]. The HOC renders
// nothing when the AI feature is gated off (ai_mode off), so the canonical baseline this surface ships against
// is "gate off => nothing rendered" — reproduced here as [RedactionSurface.Hidden] (Honesty Covenant #9:
// documented, not silent). Every other state renders a non-blank surface as the P3 contract requires.
//
// The useAiStream lifecycle (idle -> streaming -> done | error) is mapped onto the P3 state vocabulary:
//   loading  => Streaming with no delta yet ([RedactionSurface.Working], a thinking indicator)
//   empty    => Idle ([RedactionSurface.Resting], the resting card inviting a plan) or a blank Done
//   content  => Live (streaming partial plan) / Ready (completed redaction plan)
//   error    => Failed (no last-known) — a QueryError-equivalent with retry
//   stale    => Ready with a plan older than the freshness window (a stale chip + manual re-plan)
//   offline  => Cached (a network failure that keeps the last-known plan + an offline chip + retry)
// Re-running an LLM plan is an explicit, billable action, so the stale surface invites a manual re-plan rather
// than auto-refreshing (documented divergence from the templated "auto-refresh", Honesty Covenant #9).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling AINLAlertBuilder / AICostForecastNarration surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aipiiredactionsharedexports

import io.teslasync.android.data.ErrorKind

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no export rows, plan text, or
 * any user content, so a diagnostics line can never leak the operator's data or the model output.
 */
const val AI_PII_REDACTION_SHARED_EXPORTS_SLUG: String = "AIPiiRedactionSharedExports"

/**
 * How long a completed plan is considered fresh before the surface flags it stale and invites a manual re-plan.
 * Five minutes mirrors the app's live-data staleness budget; it is generous because a redaction plan is keyed
 * to a static per-export-type PII catalog and does not churn second-to-second.
 */
const val REDACTION_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

/**
 * The canonical shared export types the redaction advisor can plan for — the native mirror of the web
 * `SHARED_EXPORT_TYPES` allow-set. Each [slug] is the exact English token the backend catalog gates on
 * (it MUST stay aligned with internal/ai/tools/export_redaction_plan.go:SharedExportTypes()); the visible
 * label is localized at the render boundary via the per-type i18n key, never from this enum.
 */
enum class SharedExportType(
    val slug: String,
) {
    Drives("drives"),
    Charging("charging"),
    Trips("trips"),
    Analytics("analytics"),
    Backup("backup"),
    Account("account"),
}

/**
 * The canonical export types in the web source's order — the list the Select renders. Backed by the enum's
 * declaration order so adding a type in one place keeps the option list and the allow-set in lock-step.
 */
val SHARED_EXPORT_TYPES: List<SharedExportType> = SharedExportType.entries.toList()

/** Resolves a canonical [SharedExportType] from its [slug], or `null` when the token is unknown/blank. */
fun sharedExportTypeForSlug(slug: String): SharedExportType? = SharedExportType.entries.firstOrNull { it.slug == slug }

/** The useAiStream lifecycle, narrowed to what this surface reacts to (idle -> streaming -> done | failed). */
enum class RedactionPhase {
    /** No plan requested yet — the resting card with the "Suggest redactions" action (web `state === 'idle'`). */
    Idle,

    /** A stream is open; delta text accumulates until a terminal frame (web `state === 'streaming'`). */
    Streaming,

    /** The stream closed successfully — the accumulated text is the redaction plan (web `state === 'done'`). */
    Done,

    /** The stream ended in a terminal error frame or threw (web `state === 'error'`). */
    Failed,
}

/**
 * One parsed frame of the plan stream — the native narrowing of the web `AiStreamEvent` union that this surface
 * consumes. Delta frames accumulate text; [Done] closes the stream successfully; [Failed] carries the
 * classified transport/HTTP failure so the render boundary can localize it (never the raw provider message).
 */
sealed interface AiRedactionChunk {
    /** A `delta` frame — a chunk of the planned redactions appended to the accumulator (web `delta.text`). */
    data class Delta(
        val text: String,
    ) : AiRedactionChunk

    /** The terminal `done` frame — the stream finished cleanly. */
    data object Done : AiRedactionChunk

    /** A terminal `error` frame — carries the [ErrorKind] the UI maps to localized recovery copy. */
    data class Failed(
        val errorKind: ErrorKind,
    ) : AiRedactionChunk
}

/**
 * The immutable surface state the
 * [io.teslasync.android.sharedsurfaces.aipiiredactionsharedexports.AIPiiRedactionSharedExportsViewModel]
 * exposes. It carries the AI feature gate (web `withAiFeature`), the chosen export type (web InnerSection's
 * `exportType` state -> `canStart`), the stream [phase], the in-flight [streamingText] accumulator, the last
 * committed plan ([committedText], kept across a failed re-plan so an offline surface can still show
 * last-known), the classified [errorKind], and the completion [fetchedAt] stamp used for the freshness check.
 *
 * @property gateEnabled whether the AI feature is on (web `useAiEnabled('pii-redaction-shared-exports')`).
 * @property exportType the chosen canonical export-type slug (web `exportType` state); blank => action disabled.
 * @property phase the stream lifecycle phase.
 * @property streamingText the delta accumulator for the in-flight stream (web useAiStream `text`).
 * @property committedText the last successfully completed plan, preserved for the offline surface.
 * @property errorKind the classification of the most recent failure, or `null`.
 * @property fetchedAt epoch-millis stamp of [committedText], or `null` when nothing has completed.
 */
data class AiRedactionPlanState(
    val gateEnabled: Boolean = true,
    val exportType: String = "",
    val phase: RedactionPhase = RedactionPhase.Idle,
    val streamingText: String = "",
    val committedText: String = "",
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /** Web `canStart = exportType !== ''`: an export type must be chosen before Helix can plan. */
    val canStart: Boolean get() = exportType.isNotBlank()

    /** True while a stream is open (drives the button's busy affordance + disables re-entry). */
    val isStreaming: Boolean get() = phase == RedactionPhase.Streaming
}

/** Binds the chosen export type from the Select (web `setExportType`); the input that drives `canStart`. */
fun AiRedactionPlanState.withExportType(exportType: String): AiRedactionPlanState = copy(exportType = exportType)

/**
 * Opens a fresh plan: enter [RedactionPhase.Streaming], clear the in-flight accumulator, and drop any prior
 * error. The last [AiRedactionPlanState.committedText] is intentionally retained (not shown while streaming) so
 * a failed re-plan can fall back to last-known — the web clears its visible text the same way at `start()`,
 * surfacing the thinking indicator until the first delta.
 */
fun AiRedactionPlanState.startPlanning(): AiRedactionPlanState =
    copy(phase = RedactionPhase.Streaming, streamingText = "", errorKind = null)

/** Reduces one parsed [AiRedactionChunk] into the next state (delta accumulation / done / failure). */
fun AiRedactionPlanState.onChunk(
    chunk: AiRedactionChunk,
    nowMs: Long,
): AiRedactionPlanState =
    when (chunk) {
        is AiRedactionChunk.Delta -> copy(streamingText = streamingText + chunk.text)
        AiRedactionChunk.Done -> markDone(nowMs)
        is AiRedactionChunk.Failed -> markFailed(chunk.errorKind)
    }

/**
 * Commits the accumulated text as the plan and stamps it for the freshness check. A blank result keeps a blank
 * [AiRedactionPlanState.committedText] so the surface renders its friendly empty state rather than an empty box.
 */
fun AiRedactionPlanState.markDone(nowMs: Long): AiRedactionPlanState =
    copy(phase = RedactionPhase.Done, committedText = streamingText, fetchedAt = nowMs)

/** Marks the stream failed with the classified [kind]; the prior committed plan is left intact. */
fun AiRedactionPlanState.markFailed(kind: ErrorKind): AiRedactionPlanState = copy(phase = RedactionPhase.Failed, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the
 * web hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the
 * thinking indicator.
 */
fun AiRedactionPlanState.finishIfStreaming(nowMs: Long): AiRedactionPlanState =
    if (phase == RedactionPhase.Streaming) markDone(nowMs) else this

/**
 * The render-ready classification of [AiRedactionPlanState] — a closed set of mutually-exclusive surfaces the
 * view switches on, so every branch is exhaustively covered and unit-tested off-device. Maps the stream
 * lifecycle onto the P3 loading / empty / content / error / stale / offline contract.
 */
sealed interface RedactionSurface {
    /** The AI feature is gated off — the whole surface collapses (web `withAiFeature` renders `null`). */
    data object Hidden : RedactionSurface

    /** Resting/idle: the card with the action, enabled only when [canStart] (web `canStart`). */
    data class Resting(
        val canStart: Boolean,
    ) : RedactionSurface

    /** Streaming with no delta yet — the thinking indicator (the surface's loading state). */
    data object Working : RedactionSurface

    /** Streaming with partial text — the redaction plan rendering live as it arrives. */
    data class Live(
        val text: String,
    ) : RedactionSurface

    /** Completed with text — the plan; [stale] flags a fetch older than the freshness window. */
    data class Ready(
        val text: String,
        val stale: Boolean,
    ) : RedactionSurface

    /** Completed but blank — a friendly empty state (the model returned nothing). */
    data object Empty : RedactionSurface

    /** Failed but a prior plan exists — last-known kept visible; [offline] picks the chip/copy. */
    data class Cached(
        val text: String,
        val offline: Boolean,
    ) : RedactionSurface

    /** Failed with no last-known — a QueryError-equivalent with retry; [offline] picks the recovery copy. */
    data class Failed(
        val offline: Boolean,
    ) : RedactionSurface
}

/**
 * Selects the render-ready [RedactionSurface] for [state]. Pure (no Compose/clock): the caller supplies [nowMs]
 * and the [windowMs] freshness budget so the staleness decision is deterministic and testable.
 */
fun classifyRedaction(
    state: AiRedactionPlanState,
    nowMs: Long,
    windowMs: Long = REDACTION_FRESHNESS_WINDOW_MS,
): RedactionSurface {
    if (!state.gateEnabled) return RedactionSurface.Hidden
    return when (state.phase) {
        RedactionPhase.Idle -> RedactionSurface.Resting(state.canStart)
        RedactionPhase.Streaming ->
            if (state.streamingText.isBlank()) {
                RedactionSurface.Working
            } else {
                RedactionSurface.Live(state.streamingText)
            }

        RedactionPhase.Done ->
            if (state.committedText.isBlank()) {
                RedactionSurface.Empty
            } else {
                RedactionSurface.Ready(state.committedText, isStale(state.fetchedAt, nowMs, windowMs))
            }

        RedactionPhase.Failed -> failedSurface(state)
    }
}

/** Failure -> last-known [RedactionSurface.Cached] when a prior plan exists, else a hard failure. */
private fun failedSurface(state: AiRedactionPlanState): RedactionSurface {
    val offline = state.errorKind == ErrorKind.Network
    return if (state.committedText.isNotBlank()) {
        RedactionSurface.Cached(state.committedText, offline)
    } else {
        RedactionSurface.Failed(offline)
    }
}

/** True when a completed plan stamped at [fetchedAt] is older than [windowMs] relative to [nowMs]. */
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
 * Builds the accessibility description for the export-type Select from already-localized parts — the field's
 * purpose ([label]) plus its empty-state hint, so TalkBack announces what the dropdown selects and what an
 * empty selection means (web reads the Select's `aria-label` + the empty option). Pure so the interactive
 * element's label presence is unit-tested off-device.
 */
fun exportTypeAccessibilityLabel(
    label: String,
    hint: String,
): String = "$label. $hint"

/**
 * Builds the accessibility description for the output region per [surface] from already-localized parts, or
 * `null` when the output region carries no announcement (the resting/hidden surfaces, whose card chrome is
 * announced instead). Pure so the per-state a11y labels are unit-tested off-device.
 */
fun outputAccessibilityLabel(
    surface: RedactionSurface,
    labels: RedactionOutputLabels,
): String? =
    when (surface) {
        RedactionSurface.Hidden, is RedactionSurface.Resting -> null
        RedactionSurface.Working, is RedactionSurface.Live -> labels.working
        RedactionSurface.Empty -> labels.empty
        is RedactionSurface.Ready -> if (surface.stale) "${labels.stale}. ${surface.text}" else surface.text
        is RedactionSurface.Cached -> "${if (surface.offline) labels.offline else labels.error}. ${surface.text}"
        is RedactionSurface.Failed -> labels.error
    }

/** The localized announcement fragments [outputAccessibilityLabel] composes — resolved by the view from i18n. */
data class RedactionOutputLabels(
    val working: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val error: String,
)
