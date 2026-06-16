// The data seam the PowerFlowDashboardPage surface binds to, plus its production binding over the shared S8 EnergyStore.
// The view (composable) performs NO HTTP — it only collects state from the view-model, which drives this seam,
// reproducing the web page's data reads: `useTeslaEnergyLiveStatus` (`/tesla/energy-sites/{siteId}/live-status`),
// `useTeslaEnergyLiveStatusHistory` (`/tesla/energy-sites/{siteId}/live-status/history`) and the
// `useRefreshTeslaEnergyLiveStatus` mutation (`POST …/live-status/refresh`).
//
// All three reads/mutations are already exposed by the shared-core [EnergyStore] (the cross-platform `useEnergy` port),
// so — unlike the sibling BatteryHealthPage — this surface needs no page-local repository: it binds straight to the
// memoized, multi-observer holder every Energy surface shares app-wide. A narrow seam so the view-model depends on an
// abstraction (the real store in production ↔ a test fake), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.battery.powerflow

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.energy.EnergyStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The trailing history window the power-over-time + state-of-charge charts read, expressed as a most-recent row cap
 * (web `useTeslaEnergyLiveStatusHistory(siteId, since, until, 1000)`). A fixed window constant rather than an
 * interactive range — the established A7 precedent (StatisticsPage `FLEET_WINDOW_DAYS`) — keeps the shared feed key
 * stable and the surface free of a date-picker dependency while still exercising the history endpoint end-to-end.
 */
const val POWER_FLOW_HISTORY_LIMIT: Int = 1000

/**
 * The single seam the [PowerFlowDashboardPageViewModel] depends on so it binds to an abstraction (the shared Energy
 * holder in production; a fake in tests), never to a concrete store or the network. The two reads are cache-then-network
 * `Resource` flows (the web read hooks); the refresh is the non-throwing suspend mutation (the web mutation). No HTTP
 * touches the view.
 */
interface PowerFlowDashboardPageSource {
    /** The cache-then-network `GET …/live-status` feed for [siteId] (web `useTeslaEnergyLiveStatus`). */
    fun liveStatus(siteId: Long): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET …/live-status/history` feed for [siteId] (web `useTeslaEnergyLiveStatusHistory`). */
    fun liveStatusHistory(siteId: Long): Flow<Resource<JsonElement>>

    /**
     * Refreshes a site's live power-flow status from Tesla (`POST …/live-status/refresh`, web
     * `useRefreshTeslaEnergyLiveStatus`); on success the store re-fetches both the live-status and history feeds.
     */
    suspend fun refreshLiveStatus(siteId: Long): Result<JsonElement>
}

/**
 * Binds the surface to the shared **S8** [EnergyStore] — the memoized, multi-observer feeds every Energy surface shares
 * app-wide. The live values flow through unchanged so the view-model renders the full state matrix (loading / content /
 * empty / error / stale / offline). The history feed is scoped to the fixed [POWER_FLOW_HISTORY_LIMIT] window. No HTTP
 * touches the view.
 */
fun powerFlowDashboardPageSourceOf(energyStore: EnergyStore): PowerFlowDashboardPageSource =
    object : PowerFlowDashboardPageSource {
        override fun liveStatus(siteId: Long): Flow<Resource<JsonElement>> = energyStore.teslaEnergyLiveStatus(siteId)

        override fun liveStatusHistory(siteId: Long): Flow<Resource<JsonElement>> =
            energyStore.teslaEnergyLiveStatusHistory(siteId, limit = POWER_FLOW_HISTORY_LIMIT)

        override suspend fun refreshLiveStatus(siteId: Long): Result<JsonElement> =
            energyStore.refreshTeslaEnergyLiveStatus(siteId)
    }
