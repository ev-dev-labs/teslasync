// The data seams the BackgroundWorkSegment surface binds to — the native analogue of the THREE signals the web
// `useBackgroundJobs` hook aggregates (web/src/hooks/useBackgroundJobs.ts). The view (composable) performs NO
// HTTP — it only collects state from the ViewModel, which drives these seams, satisfying the "no direct HTTP
// from the view" contract (P1/S8 boundary, ADR-002).
//
// Two seams, mirroring the two distinct data origins the web hook merges:
//   1. [BackgroundExportsSource] — the cache-then-network export-jobs feed (web `useExportJobs`). In production
//      it binds the shared S8 [io.teslasync.shared.core.presentation.exports.ExportsStore] `exportJobs()` feed
//      and projects each [Resource] of raw summaries onto a [Resource] of active background-work rows, so every
//      prompt state — loading / content / empty / stale / offline / error — renders from a genuine `Resource`
//      lifecycle rather than being fabricated (covenant: no silent drift). A fake / static source stands in for
//      the whole layer so the surface is verified off-device and previewed deterministically.
//   2. [BackgroundJobRegistry] — the module-scoped, observable mutation + custom-job store, the faithful port
//      of the web module-scoped `registerJob` pub/sub. The web's mutation signal is derived from a global
//      TanStack query cache the native platform has no equivalent of, so the honest native counterpart is
//      explicit registration: any write-path registers a [BackgroundJobKind.Mutation] / [BackgroundJobKind.Custom]
//      job here and calls the returned function to clear it. This is the same mechanism the web uses for its
//      custom jobs, generalized to all client-side work — never a fabricated global counter.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/BackgroundWorkSegment) cannot form a valid Kotlin package;
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for the co-located seams + registry
// alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.backgroundworksegment

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.exports.ExportsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import java.time.Instant

/**
 * The seam the [BackgroundWorkSegmentViewModel] binds to for the export signal, so it depends on an
 * abstraction (real S8 adapter ↔ test fake ↔ static source) rather than a concrete store/repository or the
 * network — the native counterpart of the web `useExportJobs` data path. [activeExports] streams the active
 * (queued / processing) export rows as a cache-then-network [Resource]; transport faults surface as
 * [Resource.Error] (keeping any cached rows visible), never as a thrown exception. No HTTP touches the view.
 */
fun interface BackgroundExportsSource {
    /** Streams the active export rows as a cache-then-network [Resource] (web `useExportJobs`, filtered + mapped). */
    fun activeExports(): Flow<Resource<List<BackgroundJob>>>
}

/**
 * Binds the surface to the shared **S8** [ExportsStore] — the memoized, multi-observer export feed every
 * Exports surface shares. The `exportJobs()` feed (web `useExportJobs`, `GET /export/jobs`) is projected from
 * a [Resource] of raw summaries onto a [Resource] of active background-work rows via [toActiveBackgroundResource],
 * preserving the cache / freshness / error semantics so the segment shows last-known rows offline and a
 * classified retry on a hard failure. No HTTP touches the view.
 */
fun ExportsStore.asBackgroundExportsSource(): BackgroundExportsSource =
    BackgroundExportsSource { exportJobs().map { it.toActiveBackgroundResource() } }

/**
 * A host-provided source for already-projected rows (previews, and any caller that already holds the active
 * list). Emits a single fresh [Resource.Success] — used where the export lifecycle is not under test.
 */
fun staticBackgroundExportsSource(
    jobs: List<BackgroundJob>,
    fetchedAtMillis: Long = 0L,
    stale: Boolean = false,
): BackgroundExportsSource = BackgroundExportsSource { flowOf(Resource.Success(jobs, fetchedAtMillis, stale)) }

/**
 * Builds a [BackgroundExportsSource] from a single feed provider — the host wiring seam used when a caller
 * already has the export feed flow in hand (and the test double used to drive each loading / content / empty /
 * stale / offline / error state deterministically).
 */
fun backgroundExportsSource(feed: () -> Flow<Resource<List<BackgroundJob>>>): BackgroundExportsSource = BackgroundExportsSource { feed() }

/**
 * The module-scoped, observable store for the mutation + custom signals — the native port of the web's
 * module-scoped `registerJob` pub/sub (web/src/hooks/useBackgroundJobs.ts). It is intentionally a plain
 * observable holder (not a coroutine ViewModel) so any code path — a handler, a save callback, a bulk action —
 * can register work without living inside a provider/scope, exactly as the web store allows.
 *
 * [register] adds (or idempotently replaces, by id) a job and returns a function that removes it when the work
 * completes; [clear] removes one by id; [clearForTests] resets the store between tests. The default
 * [BackgroundJobs] singleton is the process-wide store the segment observes; tests construct their own
 * instances with a deterministic [now] clock. Like the web store it is main-confined and not internally
 * synchronised beyond [MutableStateFlow]'s atomic [update].
 *
 * @param now the registration-time stamp provider (web `new Date().toISOString()`); injectable for tests.
 */
class BackgroundJobRegistry(
    private val now: () -> String = { Instant.now().toString() },
) {
    private val state = MutableStateFlow<List<BackgroundJob>>(emptyList())

    /** The live mutation + custom jobs the segment merges with the export feed (web custom-store snapshot). */
    val jobs: StateFlow<List<BackgroundJob>> = state.asStateFlow()

    /**
     * Registers a long-running background job, replacing any existing entry with the same [id] so
     * re-registration is idempotent (web `registerJob`). Returns a function that removes the registration when
     * the work completes — e.g. `val done = registry.register("backup", label = …); try { … } finally { done() }`.
     *
     * @param id stable de-duplication id.
     * @param kind the work kind (defaults to [BackgroundJobKind.Custom], as the web `kind` defaults to custom).
     * @param label the already-localized row title (the caller localizes it, per the web contract).
     * @param description an optional already-localized secondary line.
     * @param startedAtIso an explicit start stamp; defaults to [now] so the list sorts oldest-first.
     */
    fun register(
        id: String,
        kind: BackgroundJobKind = BackgroundJobKind.Custom,
        label: String? = null,
        description: String? = null,
        startedAtIso: String? = null,
    ): () -> Unit {
        val job =
            BackgroundJob(
                id = id,
                kind = kind,
                startedAtIso = startedAtIso ?: now(),
                label = label,
                description = description,
            )
        state.update { current -> current.filterNot { it.id == id } + job }
        return { clear(id) }
    }

    /** Removes the registration with [id], if present (idempotent). */
    fun clear(id: String) {
        state.update { current -> current.filterNot { it.id == id } }
    }

    /** Test-only helper: clears every registration between tests (web `__clearBackgroundJobsForTests`). */
    fun clearForTests() {
        state.value = emptyList()
    }
}

/**
 * The process-wide [BackgroundJobRegistry] the segment observes by default — the native equivalent of the web
 * module-scoped `customJobs` store. Any write-path registers its in-flight work here and clears it on
 * completion; the segment surfaces it alongside the export feed.
 */
val backgroundJobs: BackgroundJobRegistry = BackgroundJobRegistry()
