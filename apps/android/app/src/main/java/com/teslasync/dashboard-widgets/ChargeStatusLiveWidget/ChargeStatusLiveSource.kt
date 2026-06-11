// The data port the Charge Status Live widget binds to — the native analogue of the web
// `useVehicles` + `useVehicleState` + `useChargingSessionsPaginated` hook composition
// (web/src/features/dashboard/widgets/ChargeStatusLiveWidget.tsx). The view never performs HTTP; a
// concrete adapter over the shared S8 state holders (or a test fake) drives this seam, mirroring the
// WinUI `IChargeStatusLiveSource` reference. Cache-then-network freshness is preserved end to end
// (ADR-013): the primary live-state feed drives the cached/stale/error flags; the latest charging
// session is folded in best-effort, never failing the surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ChargeStatusLiveWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.chargestatuslive

import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.charging.ChargingStore
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf

/**
 * Streams the cache-then-network sequence of combined live-charge snapshots the widget renders. A
 * single-method seam so the view-model depends on an abstraction (real adapter <-> test fake), never on
 * a concrete store or the network.
 */
fun interface ChargeStatusLiveSource {
    /** The cache-then-network live-charge feed (cached value first for an instant cold start, then refreshed). */
    fun stream(): Flow<Resource<ChargeStatusLiveSnapshot>>
}

/**
 * Fold the primary vehicle-state [Resource] together with the supplementary charging-sessions
 * [Resource] into a single snapshot [Resource], preserving every freshness flag from the PRIMARY state
 * feed (cached / refreshing / stale / offline) — the native analogue of the web component letting
 * `useVehicleState` drive the chrome while `useChargingSessionsPaginated` only supplies `latestSession`.
 * The newest session is read best-effort from whatever value the sessions feed currently holds (its own
 * loading/error status never gates the surface), mirroring the web `(sessions ?? [])[0]`. Pure, so the
 * combine contract is unit-tested without a network or cache.
 */
internal fun combineChargeStatus(
    stateResource: Resource<VehicleStateEnvelope>,
    sessionsResource: Resource<List<ChargingSession>>,
): Resource<ChargeStatusLiveSnapshot> {
    val latestSession = sessionsResource.cached?.firstOrNull()

    fun snapshot(envelope: VehicleStateEnvelope?): ChargeStatusLiveSnapshot? =
        envelope?.let { ChargeStatusLiveSnapshot(it.state, latestSession) }

    return when (stateResource) {
        is Resource.Loading ->
            Resource.Loading(
                cached = snapshot(stateResource.cached),
                fetchedAt = stateResource.fetchedAt,
                stale = stateResource.stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = ChargeStatusLiveSnapshot(stateResource.data.state, latestSession),
                fetchedAt = stateResource.fetchedAt,
                stale = stateResource.stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = snapshot(stateResource.cached),
                fetchedAt = stateResource.fetchedAt,
                stale = stateResource.stale,
                error = stateResource.error,
            )
    }
}

/**
 * The shared-state-holder-backed [ChargeStatusLiveSource]. It resolves the scoped vehicle (the native
 * analogue of the web `vehicleId ?? vehicles?.[0]?.id`: an explicit [explicitVehicleId] wins, otherwise
 * the app-wide active vehicle from [activeVehicleId], which self-heals to the first enrolled vehicle via
 * `SelectedVehicleStore`), then combines the shared [VehiclesStore.vehicleState] feed (web
 * `useVehicleState`) with the newest row of the [ChargingStore.sessionsPaginated] feed (web
 * `useChargingSessionsPaginated(id, { limit: 1 })`). With no vehicle the stream emits a resolved-empty
 * success (`null` state) so the surface shows the "No charge data" empty state, mirroring the web
 * hooks' disabled query (`enabled: id > 0`). No HTTP touches the view — the shared holders (S7/S8) own
 * it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class StoreChargeStatusLiveSource(
    private val vehiclesStore: VehiclesStore,
    private val chargingStore: ChargingStore,
    private val activeVehicleId: StateFlow<Long?>,
    private val explicitVehicleId: Long? = null,
) : ChargeStatusLiveSource {
    override fun stream(): Flow<Resource<ChargeStatusLiveSnapshot>> =
        activeVehicleId.flatMapLatest { active ->
            when (val vehicleId = explicitVehicleId?.takeIf { it > 0 } ?: active) {
                null ->
                    flowOf(
                        Resource.Success(
                            data = ChargeStatusLiveSnapshot(state = null, latestSession = null),
                            fetchedAt = NO_FETCH,
                            stale = false,
                        ),
                    )

                else ->
                    combine(
                        vehiclesStore.vehicleState(vehicleId),
                        chargingStore.sessionsPaginated(vehicleId, limit = ChargeStatusLiveRegistration.SESSION_LIMIT),
                    ) { stateResource, sessionsResource -> combineChargeStatus(stateResource, sessionsResource) }
            }
        }

    private companion object {
        /** Sentinel "never fetched" stamp for the synthetic no-vehicle empty emission. */
        const val NO_FETCH = 0L
    }
}
