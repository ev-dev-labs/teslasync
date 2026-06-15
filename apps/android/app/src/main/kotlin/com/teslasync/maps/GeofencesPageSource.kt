// The data seam the GeofencesPage surface binds to, plus its production binding over the shared-core S7
// repositories. The view (composable) performs NO HTTP — it only collects state from the view-model, which drives
// this seam, reproducing the web page's reads (`useGeofences` GET /geofences, `useVehicles` GET /vehicles,
// `usePinned('geofence')` GET /pinned) and its mutations (`useBulkGeofencesDelete` POST /geofences/bulk, plus the
// inline `request()` create/update against `/geofences`).
//
// The geofences feed + the vehicles feed + the pin feed are the shared-core cache-then-network `Resource` streams
// the S7 [LocationRepository]/[VehiclesRepository]/[PinnedRepository] already expose. The Android DI graph
// ([io.teslasync.android.data.DataContainer]) wires no LocationsStore yet, so the host constructs the shared
// [io.teslasync.shared.core.data.repo.HttpLocationRepository] over the SAME resilient client + offline cache the
// other repositories use (so the ADR-013 freshness contract + SI-verbatim caching are identical) and hands it in
// here — exactly as the sibling DrivesList surface does for driving. The single-geofence create/update have no
// shared S7 port, so they go through the same shared resilient [ApiHttpClient] (`safeRequest`) the repositories
// run on; the body is a plain `JsonObject` the client serialises via its JSON content negotiation, so the Android
// module adds no networking of its own. A narrow seam so the view-model depends on an abstraction (real adapter ↔
// test fake), never on a concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.maps.geofences

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.LocationRepository
import io.teslasync.shared.core.data.repo.PinnedRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.locations.Geofence
import io.teslasync.shared.core.presentation.locations.GeofenceBulkResult
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import io.teslasync.shared.core.presentation.pinned.PinnedItemType
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * The single seam the [GeofencesPageViewModel] depends on so it binds to an abstraction (the shared location +
 * vehicles + pin repositories and the resilient client in production, fakes in tests), never to a concrete
 * repository or the network. The three reads are cache-then-network `Resource` flows (the web read hooks); the
 * mutations are the page's bulk delete + the create/update the web does through its `request()` client. No HTTP
 * touches the view.
 */
interface GeofencesPageSource {
    /** The cache-then-network `GET /geofences` feed (web `useGeofences`). */
    fun geofences(): Flow<Resource<List<Geofence>>>

    /** The cache-then-network `GET /vehicles` feed (web `useVehicles`) — backs the "use vehicle location" picker. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /pinned?type=geofence` feed (web `usePinned('geofence')`) — pinned-first order. */
    fun pinnedGeofences(): Flow<Resource<List<PinnedItem>>>

    /** `POST /geofences/bulk` (web `useBulkGeofencesDelete`); also backs a single-row delete of one id. */
    suspend fun bulkDeleteGeofences(ids: List<Long>): Result<GeofenceBulkResult>

    /** `POST /geofences` with the create [body] (web `createMut` ▸ `request('/geofences', { method: 'POST' })`). */
    suspend fun createGeofence(body: JsonObject): Result<Geofence>

    /** `PUT /geofences/{id}` with the update [body] (web `updateMut`/`toggleMut` ▸ `request(...PUT)`). */
    suspend fun updateGeofence(
        id: Long,
        body: JsonObject,
    ): Result<Geofence>

    /**
     * `GET /vehicles/{vehicleId}/positions?limit=1` — the latest known position for the create modal's
     * "Get Location" affordance (web `handleGetLocation` ▸ `request<Position[]>(.../positions?limit=1)`).
     * Resolves null when the vehicle has no position row yet (the web `positions.length === 0` branch).
     */
    suspend fun latestVehiclePosition(vehicleId: Long): Result<GeoCoordinate?>
}

/**
 * Binds the surface to the shared **S7** [LocationRepository] + [VehiclesRepository] + [PinnedRepository] reads
 * and the page's mutations. Bulk delete routes through the location repository's one mutation; the single-geofence
 * create/update route through the shared resilient [api] (`safeRequest`) — the same client every repository runs
 * on — with a plain `JsonObject` body the client serialises as JSON. The live values flow through unchanged so the
 * view-model renders the full state matrix (loading / content / empty / error / stale / offline). No HTTP touches
 * the view.
 */
fun geofencesPageSourceOf(
    locationRepository: LocationRepository,
    vehiclesRepository: VehiclesRepository,
    pinnedRepository: PinnedRepository,
    api: ApiHttpClient,
): GeofencesPageSource =
    object : GeofencesPageSource {
        override fun geofences(): Flow<Resource<List<Geofence>>> = locationRepository.geofences()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesRepository.vehicles()

        override fun pinnedGeofences(): Flow<Resource<List<PinnedItem>>> =
            pinnedRepository.pinned(PinnedItemType.Geofence)

        override suspend fun bulkDeleteGeofences(ids: List<Long>): Result<GeofenceBulkResult> =
            locationRepository.bulkDeleteGeofences(ids)

        override suspend fun createGeofence(body: JsonObject): Result<Geofence> =
            api.safeRequest(method = HttpMethodKind.POST, path = "/geofences", body = body)

        override suspend fun updateGeofence(
            id: Long,
            body: JsonObject,
        ): Result<Geofence> =
            api.safeRequest(method = HttpMethodKind.PUT, path = "/geofences/$id", body = body)

        override suspend fun latestVehiclePosition(vehicleId: Long): Result<GeoCoordinate?> =
            runCatching {
                val payload =
                    api.request<JsonElement>(
                        path = "/vehicles/$vehicleId/positions",
                        query = mapOf("limit" to "1"),
                    )
                val first = (payload as? JsonArray)?.firstOrNull() as? JsonObject ?: return@runCatching null
                val lat = first["latitude"]?.jsonPrimitive?.doubleOrNull
                val lng = first["longitude"]?.jsonPrimitive?.doubleOrNull
                if (lat != null && lng != null) GeoCoordinate(lat, lng) else null
            }
    }
