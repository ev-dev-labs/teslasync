// The data port the Energy Stats widget binds to — the native analogue of the three web hooks the
// component composes: `useVehicles` (to resolve the default vehicle when no explicit id is configured —
// web `vehicleId ?? vehicles?.[0]?.id`) and `useEnergyStats` (the rendered
// `GET /vehicles/{id}/energy?days=30` feed). The user's display units (web `useUnits`) are read at the
// Compose boundary from `LocalDataContainer.unitFormatter`, NOT through this seam — energy + efficiency
// conversion is render-only (Phase-48 SI-canonical rule). See
// web/src/features/dashboard/widgets/EnergyStatsWidget.tsx + web/src/api/hooks/useEnergy.ts. The view
// never performs HTTP; a concrete adapter over the shared S7/S8 data layer (or a test fake) drives this
// seam. Cache-then-network freshness is preserved end to end (ADR-013): the view-model projects each
// emission's cached/stale/error flags onto the render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/EnergyStatsWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.energystats

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.EnergyRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.energy.EnergyStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * Streams the two cache-then-network feeds the widget needs: the enrolled-vehicle [vehicles] list (used
 * only to resolve the default vehicle when no explicit id is configured — web `vehicles?.[0]?.id`) and
 * the per-vehicle [energyStats] envelope (the rendered `GET /vehicles/{id}/energy?days=30` feed). A
 * narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a
 * concrete store/repository or the network.
 */
interface EnergyStatsSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to pick the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /vehicles/{id}/energy?days=30` feed for [vehicleId] (web `useEnergyStats`). */
    fun energyStats(vehicleId: String): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S8** stores — the memoized, multi-observer feeds every surface
 * shares. Use this when a host wants the widget to fold into the same shared collections as the rest of
 * the app; the live values (incl. each store's background refresh) flow through unchanged. The energy
 * window matches the web default (30 days) via [EnergyStore.energyStats]'s default. No HTTP touches the
 * view.
 */
fun energyStatsSource(
    vehicles: VehiclesStore,
    energy: EnergyStore,
): EnergyStatsSource =
    object : EnergyStatsSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun energyStats(vehicleId: String): Flow<Resource<JsonElement>> = energy.energyStats(vehicleId)
    }

/**
 * Binds the widget to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores
 * also wrap. Re-collecting any feed performs a genuine cache-then-network re-fetch, which is what backs
 * the widget's manual refresh / error-retry affordance (the web `refetch()`). No HTTP touches the view.
 */
fun energyStatsSource(
    vehicles: VehiclesRepository,
    energy: EnergyRepository,
): EnergyStatsSource =
    object : EnergyStatsSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun energyStats(vehicleId: String): Flow<Resource<JsonElement>> = energy.energyStats(vehicleId)
    }
