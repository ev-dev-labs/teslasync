// The data seams the ChartContainer shared surface binds to — the native analogue of the three annotation
// hooks the web component composes (web/src/components/charts/ChartContainer.tsx via
// web/src/api/hooks/useAnnotations.ts): `useChartAnnotationsAsData` (the cache-then-network rows feed),
// `useCreateAnnotation`, and `useDeleteAnnotation`. The view-model depends on these abstractions (a real
// adapter over the shared S8 [AnnotationsStore] in production, a fake in tests), never on a concrete store or
// the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// A second seam, [ChartHiddenPrefs], ports the web component's `localStorage` persistence of the "Hide
// annotations" toggle (web `readHiddenPref` / `writeHiddenPref`, keyed by `chartId ?? title`). The default is
// in-memory (the toggle survives recomposition but not process death); a host that wants the web's durable
// behaviour wires a SharedPreferences/DataStore-backed implementation — a documented divergence, not a silent
// one (Honesty Covenant #9).
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/ChartContainer) cannot form a valid Kotlin package; `ktlint:standard:filename`
// / `MatchingDeclarationName` are suppressed for the co-located factory + prefs alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.chartcontainer

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.annotations.AnnotationListParams
import io.teslasync.shared.core.presentation.annotations.AnnotationsStore
import io.teslasync.shared.core.presentation.annotations.ChartAnnotationRow
import io.teslasync.shared.core.presentation.annotations.CreateAnnotationInput
import io.teslasync.shared.core.presentation.annotations.DataAnnotation
import kotlinx.coroutines.flow.Flow

/**
 * The single annotation seam the [ChartContainerViewModel] depends on so it binds to an abstraction (real
 * adapter ↔ test fake), never to a concrete store/repository or the network.
 *
 * [annotations] is the cache-then-network rows feed (web `useChartAnnotationsAsData`); [refresh] re-fetches
 * every observed feed (the web mutations' `invalidate(annotationKeys.all)` + the retry affordance);
 * [createAnnotation] / [deleteAnnotation] are the non-throwing mutations (web `useCreateAnnotation` /
 * `useDeleteAnnotation`), each of which refreshes the feed on success. No HTTP touches the view.
 */
interface ChartContainerSource {
    /**
     * Stream the durable chart-annotation rows for [params] (web `useChartAnnotationsAsData({ vehicleId,
     * scope })`) as a cache-then-network [Resource]. The backend returns the rows pinned to the vehicle PLUS
     * fleet-wide rows; the projection to [DataAnnotation] happens in the shared store.
     */
    fun annotations(params: AnnotationListParams): Flow<Resource<List<DataAnnotation>>>

    /** Re-fetch every observed annotation feed — the web mutations' cache invalidation + the surface's retry. */
    fun refresh()

    /**
     * Create an annotation, then refresh the feed on success (web `useCreateAnnotation`). Non-throwing: a
     * failure is carried in the [Result] so the view can surface it without crashing the chart.
     */
    suspend fun createAnnotation(input: CreateAnnotationInput): Result<ChartAnnotationRow>

    /** Delete an annotation by numeric id, then refresh the feed on success (web `useDeleteAnnotation`). */
    suspend fun deleteAnnotation(id: Long): Result<Unit>
}

/**
 * Binds the surface to the shared **S8** [AnnotationsStore] — the memoized, multi-observer holder every
 * annotation surface shares app-wide (it already reuses one upstream fetch across the raw + as-data views and
 * invalidates all feeds on a write). Use this so the chart's annotation overlay folds into the same shared
 * feed as the rest of the app. No HTTP touches the view.
 */
fun chartContainerSource(store: AnnotationsStore): ChartContainerSource =
    object : ChartContainerSource {
        override fun annotations(params: AnnotationListParams): Flow<Resource<List<DataAnnotation>>> = store.chartAnnotationsAsData(params)

        override fun refresh() = store.refreshAll()

        override suspend fun createAnnotation(input: CreateAnnotationInput): Result<ChartAnnotationRow> = store.createAnnotation(input)

        override suspend fun deleteAnnotation(id: Long): Result<Unit> = store.deleteAnnotation(id)
    }

/**
 * The persistence seam for the "Hide annotations" toggle — the native port of the web `readHiddenPref` /
 * `writeHiddenPref` `localStorage` helpers, keyed by the chart's [ChartAnnotationsConfig.hiddenStorageKey].
 * The view-model reads the initial state from here and writes back on every toggle.
 */
interface ChartHiddenPrefs {
    /** Whether annotations are hidden for [key] (web `localStorage.getItem(prefix + key) === '1'`). */
    fun isHidden(key: String): Boolean

    /** Persist the hidden flag for [key] (web `setItem`/`removeItem`). */
    fun setHidden(
        key: String,
        hidden: Boolean,
    )
}

/**
 * The default [ChartHiddenPrefs] — an in-memory map. The toggle survives recomposition / config changes but
 * not process death; a host wanting the web's durable `localStorage` parity wires a persistent implementation.
 * Thread-confined to the single platform main scope, like the surrounding holder.
 */
class InMemoryChartHiddenPrefs : ChartHiddenPrefs {
    private val hidden = mutableSetOf<String>()

    override fun isHidden(key: String): Boolean = key in hidden

    override fun setHidden(
        key: String,
        hidden: Boolean,
    ) {
        if (hidden) this.hidden.add(key) else this.hidden.remove(key)
    }
}
