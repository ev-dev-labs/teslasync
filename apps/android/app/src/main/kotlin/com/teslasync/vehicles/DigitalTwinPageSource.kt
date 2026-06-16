// The data seam the DigitalTwinPage vehicles surface binds to, plus its production binding over the shared resilient
// client and the app-scoped active-vehicle selection. The view (composable) performs NO HTTP — it only collects state
// from the view-model, which drives this seam, reproducing the web page's reads: `useVehicles` (`GET /vehicles`),
// `useVehicleState` (`GET /vehicles/{id}/state`), `useSecurityLatest` (`GET /security/latest?vehicle_id=`) and
// `useChargingTelemetryLatest` (`GET /charging-telemetry/latest?vehicle_id=`), all scoped to the global
// `useSelectedVehicle` active vehicle.
//
// None of these four reads has a shared **S7** repository port specialised for this surface (the web page issues them
// through its `request()` client / per-domain hooks rather than a single digital-twin hook), so — exactly as the
// sibling MediaPlayer / SharedDrive sources do for their inline reads — they go through the SAME shared resilient
// [ApiHttpClient] (`safeRequest`) every repository runs on, wrapped here into the cache-then-network [Resource] shape
// the view-model projects to [io.teslasync.android.data.UiState] (loading → success/error). The Android module adds no
// networking of its own. A narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never
// on a concrete client or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehicles) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.vehicles.digitaltwin

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.safeRequest
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [DigitalTwinPageViewModel] depends on so it binds to an abstraction (the shared resilient client
 * + the app-scoped selection in production, fakes in tests), never to a concrete client or the network. The four reads
 * are the page's cache-then-network `Resource` feeds (the web `useQuery` reads); the selection is the global
 * active-vehicle scope. No HTTP touches the view.
 */
interface DigitalTwinPageSource {
    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /**
     * The `GET /vehicles` fleet feed (web `useVehicles`), surfaced as a cache-then-network [Resource] stream:
     * [Resource.Loading] first, then exactly one terminal [Resource.Success] (the raw vehicles envelope) or
     * [Resource.Error].
     */
    fun vehicles(): Flow<Resource<JsonElement>>

    /** The `GET /vehicles/{id}/state` live-state feed (web `useVehicleState`). */
    fun vehicleState(vehicleId: Long): Flow<Resource<JsonElement>>

    /** The `GET /security/latest?vehicle_id={id}` feed (web `useSecurityLatest`). */
    fun securityLatest(vehicleId: Long): Flow<Resource<JsonElement>>

    /** The `GET /charging-telemetry/latest?vehicle_id={id}` feed (web `useChargingTelemetryLatest`). */
    fun chargingLatest(vehicleId: Long): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared resilient [api] + the app-scoped [SelectedVehicleStore]. The four reads run on the
 * same `safeRequest` client every repository uses (so the resilience seam is identical) and are each folded into a
 * one-shot loading → success/error [Resource] stream so the view-model renders the full state matrix. No HTTP touches
 * the view.
 */
fun digitalTwinPageSourceOf(
    api: ApiHttpClient,
    selectedVehicleStore: SelectedVehicleStore,
): DigitalTwinPageSource =
    object : DigitalTwinPageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun vehicles(): Flow<Resource<JsonElement>> =
            resourceFlow { api.safeRequest<JsonElement>(path = "/vehicles") }

        override fun vehicleState(vehicleId: Long): Flow<Resource<JsonElement>> =
            resourceFlow { api.safeRequest<JsonElement>(path = "/vehicles/$vehicleId/state") }

        override fun securityLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
            resourceFlow {
                api.safeRequest<JsonElement>(
                    path = "/security/latest",
                    query = mapOf("vehicle_id" to vehicleId.toString()),
                )
            }

        override fun chargingLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
            resourceFlow {
                api.safeRequest<JsonElement>(
                    path = "/charging-telemetry/latest",
                    query = mapOf("vehicle_id" to vehicleId.toString()),
                )
            }
    }

/** Wraps a one-shot `safeRequest` into the cache-then-network [Resource] stream the view-model projects to UiState. */
private fun resourceFlow(request: suspend () -> Result<JsonElement>): Flow<Resource<JsonElement>> =
    flow {
        emit(Resource.Loading<JsonElement>(cached = null, fetchedAt = null, stale = false))
        request().fold(
            onSuccess = { payload ->
                emit(Resource.Success(payload, fetchedAt = System.currentTimeMillis(), stale = false))
            },
            onFailure = { error ->
                emit(Resource.Error<JsonElement>(cached = null, fetchedAt = null, stale = false, error = error))
            },
        )
    }
