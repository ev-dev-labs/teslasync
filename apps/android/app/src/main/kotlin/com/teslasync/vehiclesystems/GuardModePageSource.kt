// The data seam the GuardModePage surface binds to, plus its production binding over the shared-core Guard /
// Vehicles / Location repositories and the app-scoped active-vehicle selection. The view (composable) performs NO
// HTTP — it only collects state from the view-model, which drives this seam, reproducing the web page's reads
// (`useGuardConfig`, `useGuardEvents`, `useVehicleState`, `useGeofences` within the `useSelectedVehicle` scope) and
// its three mutations (`useSetGuardConfig`, `useGuardPanic`, `useAcknowledgeGuardEvent`).
//
// All reads are the shared-core cache-then-network `Resource` streams the S7 repositories already expose (ADR-013).
// The Android DI graph ([io.teslasync.android.data.DataContainer]) wires no GuardStore / LocationsStore yet, so the
// host constructs the shared [io.teslasync.shared.core.data.repo.HttpGuardRepository] +
// [io.teslasync.shared.core.data.repo.HttpVehiclesRepository] + [io.teslasync.shared.core.data.repo.HttpLocationRepository]
// over the SAME resilient client + offline cache the other repositories use (so the freshness contract + SI-verbatim
// caching are identical) and hands them in here — exactly as the sibling LocationsPage surface does. The S8
// invalidation rules the web hooks express via `invalidateQueries` are reproduced by the view-model's targeted
// refresh, so a mutation success refetches exactly the feeds the matching web hook would (config+events for
// set-config, events for panic + acknowledge). The events envelope is unwrapped to a plain list here via the
// shared-core [guardEventsOf] (the web `select: safeArray(data?.events)` analogue) so the view never sees the
// `{ vehicle_id, events }` shape. A narrow seam so the view-model depends on an abstraction (real adapters ↔ test
// fakes), never on a concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.GuardRepository
import io.teslasync.shared.core.data.repo.LocationRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.guard.AcknowledgeResponse
import io.teslasync.shared.core.presentation.guard.GuardConfig
import io.teslasync.shared.core.presentation.guard.GuardEvent
import io.teslasync.shared.core.presentation.guard.PanicResponse
import io.teslasync.shared.core.presentation.guard.SetConfigResponse
import io.teslasync.shared.core.presentation.guard.SetGuardConfigInput
import io.teslasync.shared.core.presentation.guard.guardEventsOf
import io.teslasync.shared.core.presentation.locations.Geofence
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map

/**
 * The single seam the [GuardModePageViewModel] depends on so it binds to an abstraction (the shared guard / vehicles
 * / location repositories + the app-scoped selection in production, fakes in tests), never to a concrete repository
 * or the network. Every read is a cache-then-network `Resource` flow; the selection is the global active-vehicle
 * scope. No HTTP touches the view.
 */
interface GuardModePageSource {
    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /** Explicitly selects [vehicleId] (the header `VehicleSelect`, web `actions={<VehicleSelect />}`). */
    fun selectVehicle(vehicleId: Long)

    /** The cache-then-network `GET /vehicles` feed (web `useVehicles`) — backs the picker + the active-vehicle name. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /vehicles/{id}/guard` feed (web `useGuardConfig`). */
    fun guardConfig(vehicleId: String): Flow<Resource<GuardConfig>>

    /**
     * The cache-then-network `GET /vehicles/{id}/guard/events` feed (web `useGuardEvents`), unwrapped to a plain
     * `List<GuardEvent>` via the shared [guardEventsOf] (the web `safeArray(data?.events)` select).
     */
    fun guardEvents(vehicleId: String): Flow<Resource<List<GuardEvent>>>

    /** The cache-then-network `GET /vehicles/{id}/state` feed (web `useVehicleState`). */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>

    /** The cache-then-network `GET /geofences` feed (web `useGeofences`). */
    fun geofences(): Flow<Resource<List<Geofence>>>

    /** `POST /vehicles/{id}/guard` — sets the guard config (web `useSetGuardConfig`). */
    suspend fun setGuardConfig(input: SetGuardConfigInput): Result<SetConfigResponse>

    /** `POST /vehicles/{id}/guard/panic` — triggers a panic alert (web `useGuardPanic`). */
    suspend fun triggerPanic(vehicleId: String): Result<PanicResponse>

    /** `POST /vehicles/{id}/guard/events/{eventId}/acknowledge` — acks an event (web `useAcknowledgeGuardEvent`). */
    suspend fun acknowledgeEvent(
        vehicleId: String,
        eventId: Long,
    ): Result<AcknowledgeResponse>
}

/**
 * Binds the surface to the shared **S7** [GuardRepository] + [VehiclesRepository] + [LocationRepository] and the
 * app-scoped [SelectedVehicleStore] — the memoized cache-then-network feeds every guard surface shares. The live
 * values flow through unchanged so the view-model renders the full state matrix (loading / content / empty / error /
 * stale / offline). No HTTP touches the view.
 */
fun guardModePageSourceOf(
    guardRepository: GuardRepository,
    vehiclesRepository: VehiclesRepository,
    locationRepository: LocationRepository,
    selectedVehicleStore: SelectedVehicleStore,
): GuardModePageSource =
    object : GuardModePageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun selectVehicle(vehicleId: Long) = selectedVehicleStore.select(vehicleId)

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesRepository.vehicles()

        override fun guardConfig(vehicleId: String): Flow<Resource<GuardConfig>> = guardRepository.guardConfig(vehicleId)

        override fun guardEvents(vehicleId: String): Flow<Resource<List<GuardEvent>>> =
            guardRepository.guardEvents(vehicleId).map { resource ->
                resource.mapData { envelope -> guardEventsOf(envelope) }
            }

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> =
            vehiclesRepository.vehicleState(vehicleId)

        override fun geofences(): Flow<Resource<List<Geofence>>> = locationRepository.geofences()

        override suspend fun setGuardConfig(input: SetGuardConfigInput): Result<SetConfigResponse> =
            guardRepository.setGuardConfig(input)

        override suspend fun triggerPanic(vehicleId: String): Result<PanicResponse> =
            guardRepository.triggerPanic(vehicleId)

        override suspend fun acknowledgeEvent(
            vehicleId: String,
            eventId: Long,
        ): Result<AcknowledgeResponse> = guardRepository.acknowledgeGuardEvent(vehicleId, eventId)
    }

/**
 * Transforms a [Resource]'s payload (cached + data) through [transform], preserving its loading/success/error state
 * and freshness — the same projection the S8 [io.teslasync.shared.core.presentation.guard.GuardStore] applies to
 * unwrap the events envelope, lifted here because the surface drives the repository directly (no DI-wired store yet).
 */
private fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }
