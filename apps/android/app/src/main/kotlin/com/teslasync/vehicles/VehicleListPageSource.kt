// The data seam the VehicleListPage fleet surface binds to, plus its production binding over the shared-core
// Vehicles + Pinned + Settings state holders. The view (composable) performs NO HTTP — it only collects state from
// the view-model, which drives this seam, reproducing the web page's reads + mutations:
//   - `useQuery(['vehicles'])` ▸ `request<Vehicle[]>('/vehicles')`  -> [vehicles]
//   - `fetchVehicleState(id)` ▸ `GET /vehicles/{id}/state`          -> [fetchVehicleState]
//   - `usePinned('vehicle')` ▸ `GET /pinned?type=vehicle`          -> [usePinned]
//   - `useUnits` ▸ `/settings`                                      -> [settings]
//   - `useMutation(POST /vehicles/sync)`                            -> [syncVehicles]
//   - `useMutation(DELETE /vehicles/{id})`                          -> [deleteVehicle]
//
// All reads are the shared-core cache-then-network `Resource` streams the S8 [VehiclesStore]/[PinnedStore]/
// [SettingsStore] already expose, and the two mutations are the store's non-throwing suspend [Result]s (which
// re-fetch the affected feed family on success, the web `invalidateQueries` analogue). A narrow seam so the
// view-model depends on an abstraction (real holders ↔ test fakes), never on a concrete store or the network.
//
// The web hook names `fetchVehicleState` and `usePinned` are kept verbatim as the Kotlin call-site names so the
// parity mapping is explicit (P3/A7 parity record).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehicles) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.vehicles.vehiclelist

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import io.teslasync.shared.core.presentation.pinned.PinnedItemType
import io.teslasync.shared.core.presentation.pinned.PinnedStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [VehicleListPageViewModel] depends on so it binds to an abstraction (the shared Vehicles +
 * Pinned + Settings holders in production, fakes in tests), never to a concrete store or the network. The reads
 * are cache-then-network [Resource] flows (the web read hooks); the mutations are non-throwing suspend [Result]s
 * (the web `useMutation`s). No HTTP touches the view.
 */
interface VehicleListPageSource {
    /** The `GET /vehicles` enrolled list feed (web `useQuery(['vehicles'])`), `safeArray`-guarded at the data layer. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /**
     * The `GET /vehicles/{id}/state` last-known-state feed for one vehicle (web `fetchVehicleState(id)`), surfaced
     * as a cache-then-network [Resource] of the normalised [VehicleStateEnvelope].
     */
    fun fetchVehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>

    /** The `GET /pinned?type=vehicle` pin feed (web `usePinned('vehicle')`), used to float pinned rows to the top. */
    fun usePinned(): Flow<Resource<List<PinnedItem>>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits` source). */
    fun settings(): Flow<Resource<JsonElement>>

    /** `POST /vehicles/sync` — syncs vehicles from Tesla (web `syncMut`); re-fetches the vehicles family on success. */
    suspend fun syncVehicles(): Result<JsonElement>

    /** `DELETE /vehicles/{id}` — removes a vehicle (web `deleteMut`); re-fetches the vehicles family on success. */
    suspend fun deleteVehicle(id: Long): Result<Unit>

    /** `POST /pinned` / `DELETE /pinned/{id}` — pins or unpins a vehicle (web `useTogglePin('vehicle')`). */
    suspend fun togglePin(
        itemId: String,
        pin: Boolean,
    ): Result<PinnedItem?>
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] + [PinnedStore] + [SettingsStore] — the memoized
 * cache-then-network feeds + mutations every Vehicles surface shares. The live values flow through unchanged so
 * the view-model renders the full state matrix (loading / content / empty / error / stale / offline). No HTTP
 * touches the view.
 */
fun vehicleListPageSourceOf(
    vehiclesStore: VehiclesStore,
    pinnedStore: PinnedStore,
    settingsStore: SettingsStore,
): VehicleListPageSource =
    object : VehicleListPageSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun fetchVehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> =
            vehiclesStore.vehicleState(vehicleId)

        override fun usePinned(): Flow<Resource<List<PinnedItem>>> = pinnedStore.pinned(PinnedItemType.Vehicle)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override suspend fun syncVehicles(): Result<JsonElement> = vehiclesStore.syncVehicles()

        override suspend fun deleteVehicle(id: Long): Result<Unit> = vehiclesStore.deleteVehicle(id)

        override suspend fun togglePin(
            itemId: String,
            pin: Boolean,
        ): Result<PinnedItem?> = pinnedStore.togglePin(PinnedItemType.Vehicle, itemId, pin)
    }
