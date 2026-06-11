// The data port the Solar Production widget binds to — the native analogue of the two web hooks the
// component composes: `useTeslaEnergySites` (to resolve the first linked site — web
// `(sites ?? [])[0]?.energy_site_id`) and `useTeslaEnergyHistory(siteId, 'day', since)` (the rendered
// `GET /tesla/energy-sites/{id}/energy-history?period=day&since=` 30-day daily-solar feed). See
// web/src/features/dashboard/widgets/SolarProductionWidget.tsx + web/src/api/hooks/useEnergy.ts. The
// view never performs HTTP; a concrete adapter over the shared S7/S8 data layer (or a test fake) drives
// this seam. Cache-then-network freshness is preserved end to end (ADR-013): the two feeds are merged so
// the combined cached/stale/error flags mirror the web's `isLoading`/`isError`/`isStale`
// OR-combination and `updatedAt = max(...)`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SolarProductionWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.solarproduction

import io.teslasync.shared.core.data.repo.EnergyRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.energy.EnergyStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement
import java.time.ZoneId

/**
 * Streams the two cache-then-network feeds the widget needs: the `GET /tesla/energy-sites` list (used to
 * resolve the first linked site — web `useTeslaEnergySites`) and the per-site
 * `GET /tesla/energy-sites/{id}/energy-history?period=day&since=` 30-day feed (web
 * `useTeslaEnergyHistory`). A narrow seam so the view-model depends on an abstraction (real adapter ↔
 * test fake), never on a concrete store/repository or the network.
 */
interface SolarProductionSource {
    /** The cache-then-network `GET /tesla/energy-sites` feed (web `useTeslaEnergySites`). */
    fun energySites(): Flow<Resource<JsonElement>>

    /**
     * The cache-then-network `GET /tesla/energy-sites/{siteId}/energy-history?period={period}&since={since}`
     * feed for [siteId] over the daily window starting at [since] (web `useTeslaEnergyHistory`).
     */
    fun energyHistory(
        siteId: Long,
        period: String,
        since: String,
    ): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S8** [EnergyStore] — the memoized, multi-observer feeds every surface
 * shares. Use this when a host wants the widget to fold into the same shared collections as the rest of
 * the app; the live values (incl. the store's background refresh) flow through unchanged. No HTTP touches
 * the view.
 */
fun solarProductionSource(energy: EnergyStore): SolarProductionSource =
    object : SolarProductionSource {
        override fun energySites(): Flow<Resource<JsonElement>> = energy.teslaEnergySites()

        override fun energyHistory(
            siteId: Long,
            period: String,
            since: String,
        ): Flow<Resource<JsonElement>> = energy.teslaEnergyHistory(siteId, period, since)
    }

/**
 * Binds the widget to the shared **S7** [EnergyRepository] — the cold cache-then-network `Flow`s the S8
 * store also wraps. Re-collecting either feed performs a genuine cache-then-network re-fetch, which is
 * what backs the widget's manual refresh / error-retry affordance (the web `refetchSites()` +
 * `refetchHistory()`). No HTTP touches the view.
 */
fun solarProductionSource(energy: EnergyRepository): SolarProductionSource =
    object : SolarProductionSource {
        override fun energySites(): Flow<Resource<JsonElement>> = energy.teslaEnergySites()

        override fun energyHistory(
            siteId: Long,
            period: String,
            since: String,
        ): Flow<Resource<JsonElement>> = energy.teslaEnergyHistory(siteId, period, since)
    }

/**
 * Composes the energy-sites feed with the per-site energy-history feed into one cache-then-network
 * [Resource] of a [SolarProductionSnapshot] — the native analogue of the web component letting
 * `useTeslaEnergySites` resolve the `siteId` that gates `useTeslaEnergyHistory`. When no site id resolves
 * the history feed is never started and the sites resource is mapped to a no-site snapshot (the web
 * `!hasSites` short-circuit); otherwise the two resources are merged so the combined loading/error/stale
 * freshness mirrors the web's OR-combination and `updatedAt = max(...)`. History rows are decoded to
 * daily kWh in [zone], and today's row is resolved against [todayKey].
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun solarProductionResource(
    sites: Flow<Resource<JsonElement>>,
    history: (Long) -> Flow<Resource<JsonElement>>,
    todayKey: String,
    zone: ZoneId = ZoneId.systemDefault(),
): Flow<Resource<SolarProductionSnapshot>> =
    sites.flatMapLatest { sitesRes ->
        val summary = parseSolarSites(sitesRes.cached)
        when (val siteId = summary.firstSiteId) {
            null -> flowOf(sitesRes.toNoSiteSnapshot(summary.hasSites))
            else -> history(siteId).map { historyRes -> mergeSolarHistory(sitesRes, historyRes, todayKey, zone) }
        }
    }

/**
 * Maps a sites [Resource] that resolved no usable site id onto the snapshot surface, carrying [hasSites]
 * so the view distinguishes "no site linked" (web `!hasSites` → "No Tesla Energy site linked") from a
 * linked-but-id-less site (→ the chart's "No solar data"). The freshness flags pass through.
 */
private fun Resource<JsonElement>.toNoSiteSnapshot(hasSites: Boolean): Resource<SolarProductionSnapshot> {
    val snapshot = SolarProductionSnapshot(hasSites = hasSites, days = emptyList(), todayKwh = 0.0)
    return when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let { snapshot }, fetchedAt, stale)
        is Resource.Success -> Resource.Success(snapshot, fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let { snapshot }, fetchedAt, stale, error)
    }
}

/**
 * Merges the (site-resolved) sites resource with the per-site history resource into one snapshot
 * resource. The snapshot always carries `hasSites = true`; its [SolarDayPoint] list is decoded from the
 * history body (a resolved-but-empty array decodes to an empty list, surfacing the "No solar data"
 * state). The combined phase/freshness follows the web: error if either errored, loading if either is
 * still loading (no history cache ⇒ a true first-load spinner, mirroring web `historyLoading`), else
 * success.
 */
private fun mergeSolarHistory(
    sites: Resource<JsonElement>,
    history: Resource<JsonElement>,
    todayKey: String,
    zone: ZoneId,
): Resource<SolarProductionSnapshot> {
    val cachedSnapshot = history.cached?.let { solarSnapshotOf(it, todayKey, zone) }
    val fetchedAt = maxFetchedAt(sites.fetchedAtOrNull(), history.fetchedAtOrNull())
    val combinedStale = sites.stale || history.stale
    return when {
        sites is Resource.Error || history is Resource.Error ->
            Resource.Error(cachedSnapshot, fetchedAt, stale = true, error = mergeError(sites, history))

        sites is Resource.Loading || history is Resource.Loading ->
            Resource.Loading(cachedSnapshot, fetchedAt, combinedStale)

        else ->
            Resource.Success(
                cachedSnapshot ?: SolarProductionSnapshot.ofDays(emptyList(), 0.0),
                fetchedAt ?: 0L,
                stale = false,
            )
    }
}

private fun mergeError(
    sites: Resource<JsonElement>,
    history: Resource<JsonElement>,
): Throwable =
    (history as? Resource.Error)?.error
        ?: (sites as? Resource.Error)?.error
        ?: IllegalStateException("solar production unavailable")

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
