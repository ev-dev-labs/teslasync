// The data seam the Watch Summary widget binds to, its shared-store binding and the cache-then-network
// adapter that folds the summary + complication reads into one render envelope; named after the surface
// bundle (WatchSummaryWidget*) rather than the single interface it declares.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/WatchSummaryWidget) cannot form a valid Kotlin package.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.watchsummary

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.watch.WatchComplication
import io.teslasync.shared.core.presentation.watch.WatchStore
import io.teslasync.shared.core.presentation.watch.WatchSummary
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine

/**
 * The single seam the [WatchSummaryWidgetViewModel] depends on so it binds to an abstraction (real
 * adapter ↔ test fake), never to a concrete store or the network — the Android analogue of the web
 * `useWatchSummary` + `useWatchComplication` hook pair the widget composes (P1/S8 state-holder boundary).
 *
 * Unlike the vehicle-state widgets, the Watch surface does NOT resolve a vehicle from the fleet list: the
 * web passes `WidgetProps.vehicleId` (possibly `undefined`) straight to both watch endpoints, where a
 * null id means "primary vehicle". This seam mirrors that exactly — each read is keyed only by the
 * optional [vehicleId]. No HTTP touches the view.
 */
interface WatchSummarySource {
    /** Stream the full watch-glance payload for [vehicleId] (web `useWatchSummary`); null ⇒ primary vehicle. */
    fun summary(vehicleId: Long?): Flow<Resource<WatchSummary>>

    /** Stream the minimal complication payload for [vehicleId] (web `useWatchComplication`). */
    fun complication(vehicleId: Long?): Flow<Resource<WatchComplication>>

    /**
     * Re-fetch both reads for [vehicleId] — the widget's manual refresh affordance. The web refresh
     * control calls `refetchSummary()`; this additionally re-fetches the complication so the charging
     * indicator refreshes with the rest of the surface (the web complication has its own poll cadence,
     * which the native store does not, so a manual refresh is the only re-fetch available here).
     */
    fun refresh(vehicleId: Long?)
}

/**
 * Binds the surface to the shared S8 [WatchStore] — the memoized, multi-observer holder every Watch
 * surface shares app-wide (web `useWatch*`). Both reads fold into the same per-vehicle feeds the rest of
 * the app collects, and [refresh] bumps the store's per-feed triggers (its `invalidateQueries` analogue),
 * which re-runs the cache-then-network collection. No HTTP touches the view.
 */
fun WatchStore.asWatchSummarySource(): WatchSummarySource {
    val store = this
    return object : WatchSummarySource {
        override fun summary(vehicleId: Long?): Flow<Resource<WatchSummary>> = store.watchSummary(vehicleId)

        override fun complication(vehicleId: Long?): Flow<Resource<WatchComplication>> = store.watchComplication(vehicleId)

        override fun refresh(vehicleId: Long?) {
            store.refreshSummary(vehicleId)
            store.refreshComplication(vehicleId)
        }
    }
}

/**
 * Composes the summary + complication reads into one cache-then-network [Resource] stream — the native
 * port of the web component's two-hook composition. The [summary] read owns the surface lifecycle
 * (loading / content / empty / stale / offline / error all key off it, exactly as the web freshness props
 * read only `summaryUpdatedAt`/`summaryStale`/`summaryError`); the [complication] only contributes its
 * pre-rendered charge flag, folded onto each emission via [chargingFrom]. A still-loading or failed
 * complication degrades to `charging = false` (web `complication?.charging`) without blanking the surface.
 */
internal fun watchSummaryResource(
    summary: Flow<Resource<WatchSummary>>,
    complication: Flow<Resource<WatchComplication>>,
): Flow<Resource<WatchView>> =
    combine(summary, complication) { summaryRes, complicationRes ->
        summaryRes.withComplication(chargingFrom(complicationRes.cached))
    }

/** Wraps a summary [Resource] into a [WatchView] [Resource], folding in the complication [charging] flag. */
private fun Resource<WatchSummary>.withComplication(charging: Boolean): Resource<WatchView> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(cached = cached?.let { WatchView(it, charging) }, fetchedAt = fetchedAt, stale = stale)
        is Resource.Success ->
            Resource.Success(data = WatchView(data, charging), fetchedAt = fetchedAt, stale = stale)
        is Resource.Error ->
            Resource.Error(cached = cached?.let { WatchView(it, charging) }, fetchedAt = fetchedAt, stale = stale, error = error)
    }
