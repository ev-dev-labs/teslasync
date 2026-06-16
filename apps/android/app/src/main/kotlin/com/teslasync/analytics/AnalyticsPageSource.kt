// The data seam the AnalyticsPage surface binds to, plus its production binding over the shared S8
// AnalyticsStore. The view (composable) performs NO HTTP — it only collects state from the view-model, which
// drives this seam, reproducing the web page's single TanStack-Query read (`useFleetAnalytics({ start, end })`).
//
// The read is the shared-core cache-then-network raw-JSON `Resource` stream the S8 AnalyticsStore already
// exposes (`GET /analytics/fleet?days=` ▸ fleetAnalytics(days)); [refresh] is the store's own per-feed
// re-fetch for the active range (the web query `refetch` / the RangePicker re-query analogue). A narrow seam
// so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete store or the
// network. The page drives only the trailing-window `days` preset (web RangePicker), so the explicit
// `start`/`end` bounds the store also accepts are left null here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.analytics

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.analytics.AnalyticsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [AnalyticsPageViewModel] depends on so it binds to an abstraction (the shared Analytics
 * holder in production, a fake in tests), never to a concrete store or the network. The read is a
 * cache-then-network raw-JSON `Resource` flow per trailing-window `days` preset (web `useFleetAnalytics`);
 * [refresh] re-fetches the active range (the web query `refetch`). No HTTP touches the view.
 */
interface AnalyticsSource {
    /** The raw-JSON `GET /analytics/fleet?days={days}` feed for the active range (web `useFleetAnalytics`). */
    fun fleetAnalytics(days: Int?): Flow<Resource<JsonElement>>

    /** Re-fetches the fleet-analytics feed for the active [days] range (web `refetch` / RangePicker re-query). */
    fun refresh(days: Int?)
}

/**
 * Binds the surface to the shared **S8** [AnalyticsStore] — the memoized, multi-observer analytics feeds the
 * app shares. The live values flow through unchanged so the view-model renders the full state matrix
 * (loading / content / stale / offline / error). No HTTP touches the view.
 */
fun AnalyticsStore.asAnalyticsSource(): AnalyticsSource {
    val store = this
    return object : AnalyticsSource {
        override fun fleetAnalytics(days: Int?): Flow<Resource<JsonElement>> = store.fleetAnalytics(days = days)

        override fun refresh(days: Int?) = store.refreshFleetAnalytics(days = days)
    }
}
