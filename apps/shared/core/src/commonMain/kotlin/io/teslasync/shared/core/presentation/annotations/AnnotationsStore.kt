package io.teslasync.shared.core.presentation.annotations

import io.teslasync.shared.core.data.repo.AnnotationRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.annotationCacheKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the durable chart-annotation store — the cross-platform port
 * of the web `useAnnotations` hook domain (web/src/api/hooks/useAnnotations.ts). Every native
 * Annotations screen (Android/Apple via KMP, Windows via the C# port) binds to this single
 * holder rather than re-implementing endpoints, query keys, the `toDataAnnotation` projection,
 * or the invalidate-all rule.
 *
 * Reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013):
 *  - [chartAnnotations] mirrors the web `useChartAnnotations` — the raw rows feed, lazily
 *    created on first access and shared so every observer of the same `params` folds into one
 *    upstream collection;
 *  - [chartAnnotationsAsData] mirrors the web `useChartAnnotationsAsData` — the SAME shared
 *    upstream re-projected through [toDataAnnotation], so the as-data view never triggers a
 *    second fetch (exactly as the web wrapper reuses the same TanStack query key). The web
 *    wrapper's `{ annotations, isLoading }` pair maps onto the [Resource]: `annotations` is the
 *    [Resource.cached]/data list, `isLoading` is `it is Resource.Loading`.
 *
 * Mutations are non-throwing suspend [Result]s; on success each refreshes EVERY observed feed
 * via [refreshAll], because the web hooks invalidate `annotationKeys.all` (a write can affect
 * any list — a fleet-wide row appears on every vehicle). The repository (S7) clears the whole
 * cache partition on the same success, so each refresh re-fetches rather than replaying a stale
 * entry. The holder makes no network calls itself.
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised;
 * create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class AnnotationsStore(
    private val repo: AnnotationRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val rawFeeds = mutableMapOf<String, StateFlow<Resource<List<ChartAnnotationRow>>>>()
    private val dataFeeds = mutableMapOf<String, StateFlow<Resource<List<DataAnnotation>>>>()

    // ---- Reads --------------------------------------------------------------------

    /**
     * Shared, refreshable `GET /annotations/` rows feed for [params] (web `useChartAnnotations`).
     * The backend returns the rows pinned to the vehicle PLUS fleet-wide rows.
     */
    public fun chartAnnotations(params: AnnotationListParams = AnnotationListParams()): StateFlow<Resource<List<ChartAnnotationRow>>> {
        val key = annotationCacheKey(params)
        return rawFeeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { repo.chartAnnotations(params) }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = INITIAL_ROWS,
                )
        }
    }

    /**
     * The [chartAnnotations] feed for [params] re-projected onto [DataAnnotation] via
     * [toDataAnnotation] (web `useChartAnnotationsAsData`). Backed by the SAME shared upstream,
     * so opening both the raw and the as-data view of the same `params` performs a single fetch.
     */
    public fun chartAnnotationsAsData(params: AnnotationListParams = AnnotationListParams()): StateFlow<Resource<List<DataAnnotation>>> {
        val key = annotationCacheKey(params)
        return dataFeeds.getOrPut(key) {
            chartAnnotations(params)
                .map { resource -> resource.mapData { rows -> rows.map(::toDataAnnotation) } }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = INITIAL_DATA,
                )
        }
    }

    // ---- Mutations ----------------------------------------------------------------

    /** Creates an annotation, then refreshes every observed feed (web `useCreateAnnotation`). */
    public suspend fun createAnnotation(input: CreateAnnotationInput): Result<ChartAnnotationRow> =
        repo.createAnnotation(input).onSuccess { refreshAll() }

    /** Patches an annotation, then refreshes every observed feed (web `useUpdateAnnotation`). */
    public suspend fun updateAnnotation(input: UpdateAnnotationInput): Result<ChartAnnotationRow> =
        repo.updateAnnotation(input).onSuccess { refreshAll() }

    /** Deletes an annotation, then refreshes every observed feed (web `useDeleteAnnotation`). */
    public suspend fun deleteAnnotation(id: Long): Result<Unit> = repo.deleteAnnotation(id).onSuccess { refreshAll() }

    /**
     * Re-fetches every observed feed — the holder-side analogue of invalidating
     * `annotationKeys.all`. Bumping a raw feed's trigger restarts its cache-then-network
     * collection; the as-data feeds re-derive automatically because they observe the raw feeds.
     * A feed nobody is observing is a no-op.
     */
    public fun refreshAll() {
        triggers.values.forEach { it.update { n -> n + 1 } }
    }

    // ---- Internals ----------------------------------------------------------------

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    /** Transforms a [Resource]'s payload (cached + data) through [transform], preserving its state. */
    private fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
        when (this) {
            is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
            is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
            is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
        }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL_ROWS: Resource<List<ChartAnnotationRow>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
        val INITIAL_DATA: Resource<List<DataAnnotation>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
