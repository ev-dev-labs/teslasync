// The data port the Energy Flow Animated widget binds to — the native analogue of the web
// `useVehicles` + `useVehicleState` hook composition
// (web/src/features/dashboard/widgets/EnergyFlowAnimatedWidget.tsx). The view never performs HTTP; a
// concrete adapter over the shared S8 [VehiclesStore] (or a test fake) drives this seam. Cache-then-
// network freshness is preserved end to end (ADR-013): the live vehicle-state feed drives the
// cached/stale/error flags the widget chrome renders.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/EnergyFlowAnimatedWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.energyflowanimated

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

/**
 * Streams the cache-then-network sequence of energy-flow snapshots the widget renders. A single-method
 * seam so the view-model depends on an abstraction (real adapter <-> test fake), never on a concrete
 * store or the network.
 */
fun interface EnergyFlowAnimatedSource {
    /** The cache-then-network live-state feed (cached value first for an instant cold start, then refreshed). */
    fun stream(): Flow<Resource<EnergyFlowAnimatedSnapshot>>
}

/**
 * Map the live vehicle-state [Resource] onto a snapshot [Resource], preserving every freshness flag
 * (cached / refreshing / stale / offline / error) — the native analogue of the web component letting
 * `useVehicleState` drive the chrome. A `null` envelope state becomes a `null`-state snapshot (the web
 * `stateData?.state` being undefined), which the view-model classifies as the empty surface. Pure, so
 * the mapping contract is unit-tested without a network or cache.
 */
internal fun mapEnergyFlowState(stateResource: Resource<VehicleStateEnvelope>): Resource<EnergyFlowAnimatedSnapshot> =
    when (stateResource) {
        is Resource.Loading ->
            Resource.Loading(
                cached = stateResource.cached?.let { EnergyFlowAnimatedSnapshot(it.state) },
                fetchedAt = stateResource.fetchedAt,
                stale = stateResource.stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = EnergyFlowAnimatedSnapshot(stateResource.data.state),
                fetchedAt = stateResource.fetchedAt,
                stale = stateResource.stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = stateResource.cached?.let { EnergyFlowAnimatedSnapshot(it.state) },
                fetchedAt = stateResource.fetchedAt,
                stale = stateResource.stale,
                error = stateResource.error,
            )
    }

/**
 * The shared-state-holder-backed [EnergyFlowAnimatedSource]. It resolves the scoped vehicle (the native
 * analogue of the web `vehicleId ?? vehicles?.[0]?.id`: an explicit [explicitVehicleId] wins, otherwise
 * the app-wide active vehicle from [activeVehicleId], which self-heals to the first enrolled vehicle via
 * `SelectedVehicleStore`), then maps the shared [VehiclesStore.vehicleState] feed (web
 * `useVehicleState`). With no vehicle the stream emits a resolved-empty success (`null` state) so the
 * surface shows the "No energy data available" empty state, mirroring the web hook's disabled query
 * (`enabled: id > 0`). No HTTP touches the view — the shared holders (S7/S8) own it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class StoreEnergyFlowAnimatedSource(
    private val vehiclesStore: VehiclesStore,
    private val activeVehicleId: StateFlow<Long?>,
    private val explicitVehicleId: Long? = null,
) : EnergyFlowAnimatedSource {
    override fun stream(): Flow<Resource<EnergyFlowAnimatedSnapshot>> =
        activeVehicleId.flatMapLatest { active ->
            when (val vehicleId = explicitVehicleId?.takeIf { it > 0 } ?: active) {
                null ->
                    flowOf(
                        Resource.Success(
                            data = EnergyFlowAnimatedSnapshot(state = null),
                            fetchedAt = NO_FETCH,
                            stale = false,
                        ),
                    )

                else -> vehiclesStore.vehicleState(vehicleId).map { mapEnergyFlowState(it) }
            }
        }

    private companion object {
        /** Sentinel "never fetched" stamp for the synthetic no-vehicle empty emission. */
        const val NO_FETCH = 0L
    }
}
