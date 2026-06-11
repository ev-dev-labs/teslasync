// The data port the Energy Site widget binds to — the native analogue of the two web hooks the component
// composes: `useTeslaEnergySites` (to resolve the linked site) and `useTeslaEnergySiteInfo` (the detail
// feed). See web/src/features/dashboard/widgets/EnergySiteInfoWidget.tsx + web/src/api/hooks/useEnergy.ts.
// The view never performs HTTP; a concrete adapter over the shared S7/S8 Energy data layer (or a test
// fake) drives this seam. Cache-then-network freshness is preserved end to end (ADR-013): the view-model
// projects each emission's cached/stale/error flags onto the render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/EnergySiteInfoWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.energysiteinfo

import io.teslasync.shared.core.data.repo.EnergyRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.energy.EnergyStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * Streams the two cache-then-network feeds the widget needs: the [energySites] catalog (used to resolve
 * the first linked site — web `(sites ?? [])[0]?.energy_site_id`) and the per-site [energySiteInfo] detail
 * envelope (the rendered `GET /tesla/energy-sites/{id}/site-info` feed). A narrow two-method seam so the
 * view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete store/repository or
 * the network.
 */
interface EnergySiteInfoSource {
    /** The cache-then-network `GET /tesla/energy-sites` catalog feed (web `useTeslaEnergySites`). */
    fun energySites(): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /tesla/energy-sites/{siteId}/site-info` feed (web `useTeslaEnergySiteInfo`). */
    fun energySiteInfo(siteId: Long): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S8** [EnergyStore] — the memoized, multi-observer feeds every Energy
 * surface shares. Use this when a host wants the widget to fold into the same shared collections as the
 * rest of the app; the live values (incl. the store's background refresh) flow through unchanged. No HTTP
 * touches the view.
 */
fun EnergyStore.asEnergySiteInfoSource(): EnergySiteInfoSource {
    val store = this
    return object : EnergySiteInfoSource {
        override fun energySites(): Flow<Resource<JsonElement>> = store.teslaEnergySites()

        override fun energySiteInfo(siteId: Long): Flow<Resource<JsonElement>> = store.teslaEnergySiteInfo(siteId)
    }
}

/**
 * Binds the widget to the shared **S7** [EnergyRepository] — the cold cache-then-network `Flow`s the S8
 * [EnergyStore] also wraps. Re-collecting either feed performs a genuine cache-then-network re-fetch,
 * which is what backs the widget's manual refresh / error-retry affordance (the web `refetch()`). No HTTP
 * touches the view.
 */
fun EnergyRepository.asEnergySiteInfoSource(): EnergySiteInfoSource {
    val repo = this
    return object : EnergySiteInfoSource {
        override fun energySites(): Flow<Resource<JsonElement>> = repo.teslaEnergySites()

        override fun energySiteInfo(siteId: Long): Flow<Resource<JsonElement>> = repo.teslaEnergySiteInfo(siteId)
    }
}
