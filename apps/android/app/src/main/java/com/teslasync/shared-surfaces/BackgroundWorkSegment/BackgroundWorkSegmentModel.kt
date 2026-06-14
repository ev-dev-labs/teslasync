// Pure, framework-free model + projection + diagnostics for the BackgroundWorkSegment shared surface — the
// native analogue of every decision the web source makes
// (web/src/components/layout/status-bar/BackgroundWorkSegment.tsx + its data hook
// web/src/hooks/useBackgroundJobs.ts) before it paints the footer status-bar segment. No Compose, no Android
// framework, no HTTP: every declaration here is exercised off-device in the :android:testReleaseUnitTest gate,
// keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): a footer status-bar
// segment that surfaces in-flight background work. Its sole data source is `useBackgroundJobs()`, which
// aggregates THREE independent signals into one sorted `jobs` list (each carrying an `id`, a `label`, a `kind`
// that selects the row icon, and an optional `description`):
//   1. EXPORT jobs    — the queued/processing rows of the cache-then-network `GET /export/jobs` feed
//                       (web `useExportJobs`), projected to `{ kind: 'export', label: file_name || type,
//                       description: status }`.
//   2. MUTATION work  — a single composite "Saving…" row while writes are in flight (web `useIsMutating`).
//   3. CUSTOM jobs    — ad-hoc long-running operations registered through the module-scoped `registerJob`
//                       store (web), each carrying a caller-localized label.
// The component renders the spinner + the count summary ("1 task" / "{{count}} tasks"), and — when opened — a
// "Running" popover listing every job (icon by kind, label, optional description, a per-row spinner). The web
// hides the whole segment when nothing runs (`if (!hasJobs) return null`).
//
// How that maps onto the native shared state-holder layer (P1/S8, ADR-002): the export signal binds the
// Charging-sibling Exports domain feed through [BackgroundExportsSource] (an `ExportsStore.exportJobs()`
// adapter in production), whose cache-then-network [io.teslasync.shared.core.data.repo.Resource] is projected
// onto the shared [io.teslasync.android.data.UiState] (loading / content / empty / stale / offline / error).
// The mutation + custom signals — which on the web are derived from a global TanStack query cache the native
// platform has no equivalent of — are sourced honestly through the module-scoped [BackgroundJobRegistry]
// (BackgroundWorkSegmentSource.kt): any native write-path registers a [BackgroundJobKind.Mutation] /
// [BackgroundJobKind.Custom] job there, exactly as the web `registerJob` store works. [foldBackgroundWork]
// merges the two into the [BackgroundWorkState] the composable renders.
//
// Honest state coverage (covenant: no parity shortcuts, never a blank box): unlike the web hook — which
// swallows the export feed's loading/error/offline lifecycle and simply shows nothing until a job exists —
// the native S8 binding surfaces every state the P3 contract mandates. When there is renderable work the
// segment shows the running list (with a stale / offline chip when the cached export rows are aged); a first
// load with nothing yet is [WorkPhase.Loading]; a hard export-feed failure with no cache and no registered
// work is [WorkPhase.Error] with a retry affordance; a resolved-empty feed with no registered work is
// [WorkPhase.Empty], rendered as a friendly idle chip rather than a hidden surface.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/BackgroundWorkSegment — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.backgroundworksegment

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.exports.ExportJobSummary

/**
 * Canonical registry metadata for the BackgroundWorkSegment surface. The diagnostics [SLUG] is emitted with
 * the one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates
 * (`BackgroundWorkSegment`); [ID] is the stable `viewModel` key prefix the host binds the segment with.
 */
object BackgroundWorkSegmentRegistration {
    /** Stable surface id (also the `viewModel` key prefix the host binds the segment with). */
    const val ID: String = "background-work-segment"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "BackgroundWorkSegment"
}

/**
 * The kind of background work a row represents — the native mirror of the web `BackgroundJobKind`
 * (`'export' | 'mutation' | 'custom'`). Each maps 1:1 to the row glyph the web `KIND_ICON` map selects
 * (export → FileDown, mutation → Save, custom → Sparkles).
 */
enum class BackgroundJobKind {
    /** A queued/processing CSV/account export from the `GET /export/jobs` feed (web `'export'` → FileDown). */
    Export,

    /** Composite in-flight write work, e.g. a settings save (web `'mutation'` → Save). */
    Mutation,

    /** An ad-hoc long-running operation registered through [BackgroundJobRegistry] (web `'custom'` → Sparkles). */
    Custom,
}

/**
 * The progress detail of an export row — the semantic form of the web `description: status === 'queued' ?
 * 'Queued' : 'Processing'`. Carried as an enum (not a literal string) so the model stays framework-free and
 * the localized word is resolved at the render boundary (the codebase's "view resolves strings" convention).
 * [None] is the no-detail case used by mutation / custom rows whose human-readable [BackgroundJob.description]
 * is already supplied by the caller.
 */
enum class ExportProgress {
    /** No structured progress detail; any [BackgroundJob.description] literal is rendered verbatim. */
    None,

    /** The export is queued, awaiting a worker (web `status === 'queued'` → "Queued"). */
    Queued,

    /** The export is actively being produced (web `status === 'processing'` → "Processing"). */
    Processing,
}

/**
 * One in-flight background job — the native port of the web `BackgroundJob`. [label] / [description] are
 * already-localized display strings for mutation / custom rows (the web contract: "already i18n'd by the
 * caller") and raw server data (file name / type) for export rows; either may be blank, in which case the
 * view resolves a localized [kind]-based default so a row is never empty. [detail] carries the semantic
 * export progress the view localizes; it is [ExportProgress.None] for non-export rows.
 *
 * @property id stable, de-duplication id (web `id`); export ids are namespaced `export:{jobId}`.
 * @property kind the work kind selecting the row glyph (web `kind`).
 * @property startedAtIso ISO-8601 start stamp used to sort the list oldest-first (web `startedAt`).
 * @property label the row title — caller-localized (mutation/custom) or server data (export); blank ⇒ default.
 * @property description an optional caller-localized secondary line (web `description`); export rows use [detail].
 * @property detail the semantic export progress the view localizes; [ExportProgress.None] for other kinds.
 */
data class BackgroundJob(
    val id: String,
    val kind: BackgroundJobKind,
    val startedAtIso: String,
    val label: String? = null,
    val description: String? = null,
    val detail: ExportProgress = ExportProgress.None,
)

/**
 * The primary surface the segment renders, derived once in [foldBackgroundWork] so the composable only
 * switches on it. Mirrors the platform [io.teslasync.android.data.UiPhase] but is named for this surface so
 * the view never re-derives the contract.
 */
enum class WorkPhase {
    /** A first export-feed load is in flight and there is nothing (cached or registered) to show yet. */
    Loading,

    /** There is renderable background work — the running list (web `hasJobs` → the segment + popover). */
    Content,

    /** The feed resolved with no active work and nothing is registered — the friendly idle surface. */
    Empty,

    /** A hard export-feed failure with no cache and no registered work — the error surface with retry. */
    Error,
}

/**
 * The immutable, render-ready state the segment paints — the fold of the export feed's [UiState] and the
 * [BackgroundJobRegistry]'s live jobs. PII-free: it carries only the work rows' titles/kinds (no payloads,
 * no vehicle ids beyond what a caller put in a label). The composable resolves strings + colors from it and
 * never re-derives the contract.
 *
 * @property phase the primary surface to render.
 * @property jobs the merged, oldest-first running list (export ⊕ mutation ⊕ custom).
 * @property stale whether the cached export rows are aged / served offline (never shown as live).
 * @property refreshing whether a background export refresh is running over existing rows.
 * @property offline whether aged cached rows are shown because a refresh failed (the "last known" surface).
 * @property errorKind the classification of the most recent export-feed failure, or `null` when there is none.
 * @property httpStatus the HTTP status when [errorKind] is [ErrorKind.Http], else `null`.
 */
data class BackgroundWorkState(
    val phase: WorkPhase,
    val jobs: List<BackgroundJob>,
    val stale: Boolean = false,
    val refreshing: Boolean = false,
    val offline: Boolean = false,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
) {
    /** How many jobs are running (the web `count`; drives the "1 task" / "{{count}} tasks" summary). */
    val count: Int get() = jobs.size

    /** Convenience flag — true iff at least one job is running (the web `hasJobs`). */
    val hasJobs: Boolean get() = jobs.isNotEmpty()

    companion object {
        /** The initial, pre-collection state: a first load with nothing cached or registered. */
        fun loading(): BackgroundWorkState = BackgroundWorkState(WorkPhase.Loading, emptyList())
    }
}

/** The export-feed statuses the web `activeExportJobs` keeps (`queued` / `processing`); all others are dropped. */
private const val STATUS_QUEUED = "queued"
private const val STATUS_PROCESSING = "processing"

/** Namespacing prefix for export job ids so they never collide with registered mutation / custom ids. */
private const val EXPORT_ID_PREFIX = "export:"

/**
 * Projects the raw `GET /export/jobs` summary rows onto the active background-work rows — the native port of
 * the web `activeExportJobs`. Keeps only the queued / processing rows (the web filter), namespaces each id,
 * and resolves the label from the server data (`file_name`, falling back to the export `type`; the view
 * localizes a generic default if both are blank). The status becomes the semantic [ExportProgress] the view
 * localizes — never an English literal baked into the model.
 */
fun List<ExportJobSummary>.toActiveBackgroundJobs(): List<BackgroundJob> =
    asSequence()
        .filter { it.status == STATUS_QUEUED || it.status == STATUS_PROCESSING }
        .map { summary ->
            BackgroundJob(
                id = EXPORT_ID_PREFIX + summary.id,
                kind = BackgroundJobKind.Export,
                startedAtIso = summary.createdAt,
                label = summary.fileName?.takeUnless { it.isBlank() } ?: summary.type.takeUnless { it.isBlank() },
                detail = if (summary.status == STATUS_QUEUED) ExportProgress.Queued else ExportProgress.Processing,
            )
        }.toList()

/**
 * Carries the cache-then-network [Resource] of raw export summaries through to a [Resource] of active
 * background-work rows 1:1, preserving every cache / freshness / error flag — the native mirror of the web
 * feed staying a live query while its rows are re-shaped. Mapped per-variant (rather than via a generic
 * `map`) so the `Resource → UiState` freshness contract keeps working unchanged downstream.
 */
fun Resource<List<ExportJobSummary>>.toActiveBackgroundResource(): Resource<List<BackgroundJob>> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(
                cached = cached?.toActiveBackgroundJobs(),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = data.toActiveBackgroundJobs(),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = cached?.toActiveBackgroundJobs(),
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }

/**
 * Merges the export feed's projected [UiState] and the [BackgroundJobRegistry]'s live mutation / custom jobs
 * into the render-ready [BackgroundWorkState] — the native fold of the web `useBackgroundJobs` aggregation
 * (`[...exports, ...mutationJob, ...custom].sort(...)`). The merged list is sorted oldest-first by ISO start
 * stamp (web `a.startedAt.localeCompare(b.startedAt)`), and the phase honestly reflects the export feed's
 * cache-then-network lifecycle when there is nothing to show: loading on a first fetch, a hard error (no
 * cache, nothing registered) as the retry surface, otherwise the friendly empty surface. Any aged / offline
 * cached export rows keep showing while [stale] / [offline] flag the "last known" surface.
 */
fun foldBackgroundWork(
    exports: UiState<List<BackgroundJob>>,
    registry: List<BackgroundJob>,
): BackgroundWorkState {
    val exportJobs = exports.data ?: emptyList()
    val combined = (exportJobs + registry).sortedBy { it.startedAtIso }
    val phase =
        when {
            combined.isNotEmpty() -> WorkPhase.Content
            exports.isLoading -> WorkPhase.Loading
            exports.isError -> WorkPhase.Error
            else -> WorkPhase.Empty
        }
    return BackgroundWorkState(
        phase = phase,
        jobs = combined,
        stale = exports.stale,
        refreshing = exports.refreshing,
        offline = exports.isOffline,
        errorKind = exports.errorKind,
        httpStatus = exports.httpStatus,
    )
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The diagnostics event emitted (PII-free) whenever the error surface's manual retry is invoked. */
const val EVENT_RETRY: String = "backgroundWork.retry"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * The PII-safe diagnostics this surface emits (P1/S11) — each carries only the surface
 * [BackgroundWorkSegmentRegistration.SLUG], never a job label, count, or payload, so a diagnostics line can
 * never leak what work a user has in flight. Kept free of Compose so it is unit-tested with a recording
 * [Logger]; the ViewModel calls [recordViewOpened] once per surface open and [recordRetry] per manual retry.
 */
object BackgroundWorkSegmentDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = BackgroundWorkSegmentRegistration.SLUG

    /** Emits the one-shot `view.opened` diagnostic for this surface (slug only). */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }

    /** Emits the PII-safe retry diagnostic (slug only) when the error surface's retry is invoked. */
    fun recordRetry(logger: Logger) {
        logger.info(EVENT_RETRY, mapOf(FIELD_SURFACE to SLUG))
    }
}
