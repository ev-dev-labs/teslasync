// The data ports the StateMachineDebuggerPage surface binds to (P1/S8), plus their production binding over the
// shared-core holders. The view (composable) performs NO HTTP — it only collects state from the view-model, which
// reaches the backend exclusively through this seam, reproducing the web page's four reads
// (web/src/features/system/pages/StateMachineDebuggerPage.tsx): `useVehicleStateMachine` (`/vehicles/{id}/state`),
// `useFSMStats` (`/fsm/stats`), `useFSMTransitions` (`/fsm/transitions`), and `useSignalSnapshot`
// (`/signals/{id}/snapshot`), plus the global vehicle picker (`useSelectedVehicle`).
//
// Three reads are shared cache-then-network `Resource` streams already owned by the S8 holders — the vehicle list +
// per-vehicle state are the [VehiclesStore] feeds, and both FSM feeds are the [FsmStore] feeds (web `useFSM`). There
// is no shared store for `/signals/{id}/snapshot` (the Signals domain exposes available/live/history, not snapshot),
// so that read is wired over the resilient [ApiHttpClient] here as a one-shot cache-free `Resource` flow — the
// inspector is a point-in-time peek, not a polled feed, so a Loading→Success/Error stream matches the web mutationless
// query. The app-scoped active-vehicle selection is delegated to the shared [SelectedVehicleStore] so the picker
// agrees with every other vehicle-scoped surface. Narrow seams so the view-model depends on abstractions (real
// holders in production, fakes in tests), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located production-binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.statemachinedebugger

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.FsmType
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.fsm.FsmStore
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.JsonElement

/**
 * The seams the StateMachineDebuggerPage surface depends on so it binds to abstractions (the shared Vehicles + FSM
 * holders + active-vehicle selection in production, fakes in tests), never to concrete stores or the network. All four
 * reads are cache-then-network `Resource` flows (the snapshot is cache-free); the active-vehicle selection is the
 * shared app-scoped store. No HTTP touches the view.
 */
interface StateMachineDebuggerPageSource {
    /** The app-scoped selected vehicle id (web `useSelectedVehicle().vehicleId`). */
    val selectedId: StateFlow<Long?>

    /** Explicitly select a vehicle (web vehicle `Select` `onChange`). */
    fun select(id: Long)

    /** Reconcile the selection against the live enrolled-id list (web "default to first vehicle"). */
    fun reconcile(ids: List<Long>)

    /** The cache-then-network `GET /vehicles` list feed for the switcher (web `useSelectedVehicle().vehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /vehicles/{id}/state` feed (web `useVehicleStateMachine`). */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>

    /** The shared `GET /fsm/stats?vehicle_id={entityId}` feed (web `useFSMStats`). */
    fun fsmStats(entityId: String): Flow<Resource<JsonElement>>

    /** The shared paged `GET /fsm/transitions` feed (web `useFSMTransitions`). */
    fun fsmTransitions(
        entityId: String,
        fsmType: FsmType,
        hours: Int,
        page: Int,
        perPage: Int,
        startInstant: String? = null,
        endInstantExclusive: String? = null,
    ): Flow<Resource<JsonElement>>

    /**
     * The point-in-time `GET /signals/{id}/snapshot` read for the selected transition's inspector (web
     * `useSignalSnapshot`). [at] is the RFC-3339 instant; [signalsCsv] narrows the response (empty ⇒ all signals).
     */
    fun signalSnapshot(
        vehicleId: Long,
        at: String,
        signalsCsv: String,
    ): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] + [FsmStore], the app-scoped [SelectedVehicleStore], and the
 * resilient [ApiHttpClient] (for the snapshot read). The live values flow through unchanged so the view-model renders
 * the full state matrix (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun stateMachineDebuggerPageSourceOf(
    vehiclesStore: VehiclesStore,
    selectedVehicleStore: SelectedVehicleStore,
    fsmStore: FsmStore,
    api: ApiHttpClient,
): StateMachineDebuggerPageSource =
    object : StateMachineDebuggerPageSource {
        override val selectedId: StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun select(id: Long) = selectedVehicleStore.select(id)

        override fun reconcile(ids: List<Long>) = selectedVehicleStore.reconcile(ids)

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> =
            vehiclesStore.vehicleState(vehicleId)

        override fun fsmStats(entityId: String): Flow<Resource<JsonElement>> = fsmStore.stats(entityId)

        override fun fsmTransitions(
            entityId: String,
            fsmType: FsmType,
            hours: Int,
            page: Int,
            perPage: Int,
            startInstant: String?,
            endInstantExclusive: String?,
        ): Flow<Resource<JsonElement>> =
            fsmStore.transitions(entityId, fsmType, hours, page, perPage, startInstant, endInstantExclusive)

        override fun signalSnapshot(
            vehicleId: Long,
            at: String,
            signalsCsv: String,
        ): Flow<Resource<JsonElement>> =
            flow {
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                val query =
                    buildMap<String, String?> {
                        if (at.isNotBlank()) put("at", at)
                        if (signalsCsv.isNotBlank()) put("signals", signalsCsv)
                    }
                api
                    .safeRequest<JsonElement>(path = "/signals/$vehicleId/snapshot", query = query)
                    .fold(
                        onSuccess = { body ->
                            emit(Resource.Success(data = body, fetchedAt = System.currentTimeMillis(), stale = false))
                        },
                        onFailure = { error ->
                            emit(Resource.Error(cached = null, fetchedAt = null, stale = false, error = error))
                        },
                    )
            }
    }
