package io.teslasync.shared.core.data.repo

import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleDriver
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleInvitation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * HTTP-backed [VehicleAccessRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). Both reads share the single [CacheDomain.VehicleAccess] partition under distinct keys
 * ([vehicleDriversCacheKey] / [vehicleInvitationsCacheKey], the web `vehicleAccessKeys` tuples),
 * each honouring the web `STALE_TIMES.STANDARD` (60s) window the domain default already encodes
 * ([VEHICLE_ACCESS_TTL_MILLIS]). The raw [JsonElement] is cached verbatim (the same SI-preserving
 * strategy as the Sharing/Push ports) and decoded to the typed model on every emission through
 * [decode]; a typed decode failure on the fresh value surfaces as [Resource.Error] (never a thrown
 * exception that would cancel the flow), and a failure decoding a cached value degrades that slot to
 * `null` so a schema-drifted cache can never brick the network reload. Each list read applies
 * [safeArray] before caching (the web `select: safeArray`) so a non-array body resolves to `[]`.
 *
 * The five mutations call the API directly and return a non-throwing [Result]. On success each
 * evicts ONLY the affected vehicle's matching feed key ([evict]) — driver actions evict
 * [vehicleDriversCacheKey], invitation actions evict [vehicleInvitationsCacheKey] — the data-layer
 * analogue of the web hooks invalidating ONLY their one `vehicleAccessKeys.*(id)` tuple, leaving the
 * sibling feed and every other vehicle untouched. The remove-driver body is serialized to exact
 * JSON bytes via [TextContent] for byte-for-byte parity with the web `JSON.stringify` payload; the
 * remove / revoke responses are read as raw text and discarded so a `{ status }` / empty body never
 * triggers a spurious decode failure.
 */
public class HttpVehicleAccessRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    VehicleAccessRepository {
    override val domain: CacheDomain = CacheDomain.VehicleAccess

    // ---- Reads --------------------------------------------------------------------

    override fun vehicleDrivers(vehicleId: String): Flow<Resource<List<VehicleDriver>>> =
        observe(vehicleDriversCacheKey(vehicleId), VEHICLE_ACCESS_TTL_MILLIS) {
            safeArray(api.request<JsonElement>(path = "/vehicles/$vehicleId/drivers"))
        }.decode(ListSerializer(VehicleDriver.serializer()))

    override fun vehicleInvitations(vehicleId: String): Flow<Resource<List<VehicleInvitation>>> =
        observe(vehicleInvitationsCacheKey(vehicleId), VEHICLE_ACCESS_TTL_MILLIS) {
            safeArray(api.request<JsonElement>(path = "/vehicles/$vehicleId/invitations"))
        }.decode(ListSerializer(VehicleInvitation.serializer()))

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun refreshVehicleDrivers(vehicleId: String): Result<List<VehicleDriver>> =
        api
            .safeRequest<List<VehicleDriver>>(
                method = HttpMethodKind.POST,
                path = "/vehicles/$vehicleId/drivers/refresh",
            ).onSuccess { evict(vehicleDriversCacheKey(vehicleId)) }

    override suspend fun refreshVehicleInvitations(vehicleId: String): Result<List<VehicleInvitation>> =
        api
            .safeRequest<List<VehicleInvitation>>(
                method = HttpMethodKind.POST,
                path = "/vehicles/$vehicleId/invitations/refresh",
            ).onSuccess { evict(vehicleInvitationsCacheKey(vehicleId)) }

    override suspend fun removeVehicleDriver(
        vehicleId: String,
        shareUserId: Long,
    ): Result<Unit> =
        // The server answers an empty/`{ status }` body; read it as raw text and discard so the
        // response shape never triggers a spurious decode failure.
        api
            .safeRequest<String>(
                method = HttpMethodKind.DELETE,
                path = "/vehicles/$vehicleId/drivers",
                body = jsonBody(removeVehicleDriverBody(shareUserId)),
            ).map { }
            .onSuccess { evict(vehicleDriversCacheKey(vehicleId)) }

    override suspend fun createVehicleInvitation(vehicleId: String): Result<VehicleInvitation> =
        api
            .safeRequest<VehicleInvitation>(
                method = HttpMethodKind.POST,
                path = "/vehicles/$vehicleId/invitations",
            ).onSuccess { evict(vehicleInvitationsCacheKey(vehicleId)) }

    override suspend fun revokeVehicleInvitation(
        vehicleId: String,
        invitationId: String,
    ): Result<Unit> =
        api
            .safeRequest<String>(
                method = HttpMethodKind.POST,
                path = "/vehicles/$vehicleId/invitations/$invitationId/revoke",
            ).map { }
            .onSuccess { evict(vehicleInvitationsCacheKey(vehicleId)) }

    // ---- Internals ----------------------------------------------------------------

    /** Maps a raw-JSON cache-then-network feed onto its typed model, guarding every decode. */
    private fun <T> Flow<Resource<JsonElement>>.decode(serializer: KSerializer<T>): Flow<Resource<T>> =
        map { resource -> resource.decodeTo(serializer) }

    private fun <T> Resource<JsonElement>.decodeTo(serializer: KSerializer<T>): Resource<T> =
        when (this) {
            is Resource.Loading -> Resource.Loading(cached?.let { tryDecode(serializer, it) }, fetchedAt, stale)
            is Resource.Error -> Resource.Error(cached?.let { tryDecode(serializer, it) }, fetchedAt, stale, error)
            is Resource.Success ->
                runCatching { json.decodeFromJsonElement(serializer, data) }.fold(
                    onSuccess = { Resource.Success(it, fetchedAt, stale) },
                    // A 2xx body that no longer matches the DTO is a contract error, not a transport
                    // one — surface it without throwing across the flow boundary.
                    onFailure = { Resource.Error(cached = null, fetchedAt = fetchedAt, stale = false, error = it) },
                )
        }

    /** A schema-drifted cached slot degrades to `null` rather than bricking the refresh. */
    private fun <T> tryDecode(
        serializer: KSerializer<T>,
        element: JsonElement,
    ): T? = runCatching { json.decodeFromJsonElement(serializer, element) }.getOrNull()

    /**
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes reach
     * the wire unchanged — byte-for-byte parity with the web `JSON.stringify` body.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)
}
