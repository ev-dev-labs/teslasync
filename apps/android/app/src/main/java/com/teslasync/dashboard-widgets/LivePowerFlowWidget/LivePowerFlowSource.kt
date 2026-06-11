// The data port the Live Power Flow widget binds to — the native analogue of the two web hooks the
// component composes: `useTeslaEnergySites` (to resolve the first linked site — web
// `(sites ?? [])[0]?.energy_site_id`) and `useTeslaEnergyLiveStatus(siteId)` (the rendered
// `GET /tesla/energy-sites/{id}/live-status` power-flow feed). See
// web/src/features/dashboard/widgets/LivePowerFlowWidget.tsx + web/src/api/hooks/useEnergy.ts. The view
// never performs HTTP; a concrete adapter over the shared S7/S8 data layer (or a test fake) drives this
// seam. Cache-then-network freshness is preserved end to end (ADR-013): the two feeds are merged so the
// combined cached/stale/error flags mirror the web's `isLoading`/`isError`/`isStale` OR-combination and
// `updatedAt = max(...)`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/LivePowerFlowWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.livepowerflow

import io.teslasync.shared.core.data.repo.EnergyRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.energy.EnergyStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement

/**
 * Streams the two cache-then-network feeds the widget needs: the `GET /tesla/energy-sites` list (used to
 * resolve the first linked site — web `useTeslaEnergySites`) and the per-site
 * `GET /tesla/energy-sites/{id}/live-status` power-flow feed (web `useTeslaEnergyLiveStatus`). A narrow
 * seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete
 * store/repository or the network.
 */
interface LivePowerFlowSource {
    /** The cache-then-network `GET /tesla/energy-sites` feed (web `useTeslaEnergySites`). */
    fun energySites(): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /tesla/energy-sites/{id}/live-status` feed (web `useTeslaEnergyLiveStatus`). */
    fun liveStatus(siteId: Long): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S8** [EnergyStore] — the memoized, multi-observer feeds every surface
 * shares. Use this when a host wants the widget to fold into the same shared collections as the rest of
 * the app; the live values (incl. the store's background refresh) flow through unchanged. No HTTP touches
 * the view.
 */
fun livePowerFlowSource(energy: EnergyStore): LivePowerFlowSource =
    object : LivePowerFlowSource {
        override fun energySites(): Flow<Resource<JsonElement>> = energy.teslaEnergySites()

        override fun liveStatus(siteId: Long): Flow<Resource<JsonElement>> = energy.teslaEnergyLiveStatus(siteId)
    }

/**
 * Binds the widget to the shared **S7** [EnergyRepository] — the cold cache-then-network `Flow`s the S8
 * store also wraps. Re-collecting either feed performs a genuine cache-then-network re-fetch, which is
 * what backs the widget's manual refresh / error-retry affordance (the web `refetchSites()` +
 * `refetchLive()`). No HTTP touches the view.
 */
fun livePowerFlowSource(energy: EnergyRepository): LivePowerFlowSource =
    object : LivePowerFlowSource {
        override fun energySites(): Flow<Resource<JsonElement>> = energy.teslaEnergySites()

        override fun liveStatus(siteId: Long): Flow<Resource<JsonElement>> = energy.teslaEnergyLiveStatus(siteId)
    }

/**
 * Composes the energy-sites feed with the per-site live-status feed into one cache-then-network
 * [Resource] of a [LivePowerFlowSnapshot] — the native analogue of the web component letting
 * `useTeslaEnergySites` resolve the `siteId` that gates `useTeslaEnergyLiveStatus`. When no site id
 * resolves the live feed is never started and the sites resource is mapped to a no-site snapshot (the web
 * `!hasSites` short-circuit); otherwise the two resources are merged so the combined
 * loading/error/stale freshness mirrors the web's OR-combination and `updatedAt = max(...)`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun livePowerFlowResource(
    sites: Flow<Resource<JsonElement>>,
    liveStatus: (Long) -> Flow<Resource<JsonElement>>,
): Flow<Resource<LivePowerFlowSnapshot>> =
    sites.flatMapLatest { sitesRes ->
        val summary = parseEnergySites(sitesRes.cached)
        when (val siteId = summary.firstSiteId) {
            null -> flowOf(sitesRes.toNoSiteSnapshot(summary.hasSites))
            else -> liveStatus(siteId).map { liveRes -> mergeLivePowerFlow(sitesRes, liveRes) }
        }
    }

/**
 * Maps a sites [Resource] that resolved no usable site id onto the snapshot surface, carrying [hasSites]
 * so the view distinguishes "no site linked" (web `!hasSites` → "No Tesla Energy site linked") from a
 * linked-but-id-less site (→ the flow diagram's "No live power data"). The freshness flags pass through.
 */
private fun Resource<JsonElement>.toNoSiteSnapshot(hasSites: Boolean): Resource<LivePowerFlowSnapshot> {
    val snapshot = LivePowerFlowSnapshot(hasSites = hasSites, status = null)
    return when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let { snapshot }, fetchedAt, stale)
        is Resource.Success -> Resource.Success(snapshot, fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let { snapshot }, fetchedAt, stale, error)
    }
}

/**
 * Merges the (site-resolved) sites resource with the per-site live-status resource into one snapshot
 * resource. The snapshot always carries `hasSites = true`; its [LivePowerStatus] is decoded from the live
 * body (a resolved-but-empty body decodes to `null`, surfacing the "No live power data" state). The
 * combined phase/freshness follows the web: error if either errored, loading if either is still loading
 * (no live cache ⇒ a true first-load spinner, mirroring web `liveLoading`), else success.
 */
private fun mergeLivePowerFlow(
    sites: Resource<JsonElement>,
    live: Resource<JsonElement>,
): Resource<LivePowerFlowSnapshot> {
    val cachedSnapshot = live.cached?.let { LivePowerFlowSnapshot(hasSites = true, status = parseLiveStatus(it)) }
    val fetchedAt = maxFetchedAt(sites.fetchedAtOrNull(), live.fetchedAtOrNull())
    val combinedStale = sites.stale || live.stale
    return when {
        sites is Resource.Error || live is Resource.Error ->
            Resource.Error(cachedSnapshot, fetchedAt, stale = true, error = mergeError(sites, live))

        sites is Resource.Loading || live is Resource.Loading ->
            Resource.Loading(cachedSnapshot, fetchedAt, combinedStale)

        else ->
            Resource.Success(
                cachedSnapshot ?: LivePowerFlowSnapshot.SITE_WITHOUT_STATUS,
                fetchedAt ?: 0L,
                stale = false,
            )
    }
}

private fun mergeError(
    sites: Resource<JsonElement>,
    live: Resource<JsonElement>,
): Throwable =
    (live as? Resource.Error)?.error
        ?: (sites as? Resource.Error)?.error
        ?: IllegalStateException("live power flow unavailable")

private fun Resource<*>.fetchedAtOrNull(): Long? =
    when (this) {
        is Resource.Loading -> fetchedAt
        is Resource.Success -> fetchedAt
        is Resource.Error -> fetchedAt
    }

private fun maxFetchedAt(
    a: Long?,
    b: Long?,
): Long? = listOfNotNull(a, b).maxOrNull()
