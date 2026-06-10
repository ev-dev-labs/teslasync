package io.teslasync.shared.core.data.repo

import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import io.ktor.http.encodeURLPathPart
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.vehiclesettings.VehicleSettingsResponse
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * HTTP-backed [VehicleSettingsRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). The single read caches the typed [VehicleSettingsResponse] under
 * [vehicleSettingsCacheKey] in the [CacheDomain.VehicleSettings] partition, honouring the web
 * `useVehicleSettings` `staleTime` (`30_000`) the domain default already encodes
 * ([VEHICLE_SETTINGS_TTL_MILLIS]). The resolved value carries a raw `JsonElement` per row, which is
 * serializable, so the response is cached as its typed form directly rather than via the raw-JSON
 * strategy the multi-shape ports use.
 *
 * The two mutations call the API and return a non-throwing [Result]. The upsert serializes its
 * `{ value }` body to exact JSON bytes via [TextContent] for byte-for-byte parity with the web
 * `JSON.stringify` payload; both responses are read as raw text and discarded so a `204`/empty body
 * never triggers a spurious decode failure. On success each evicts ONLY the affected vehicle's
 * settings key ([evict]) — the data-layer analogue of the web hooks invalidating their one
 * `vehicleSettingsKeys.detail(id)` tuple — so the matching S8 store refresh re-fetches rather than
 * replaying a stale entry. The web's SECOND invalidation (`vehicleKeys.detail(id)`) is a cross-domain
 * concern handled by the S8 store's injected vehicle-refresh hook, not here. The [key] segment is
 * percent-encoded via [encodeURLPathPart] exactly as the web `encodeURIComponent(key)`.
 */
public class HttpVehicleSettingsRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<VehicleSettingsResponse>(store, clock, json, VehicleSettingsResponse.serializer()),
    VehicleSettingsRepository {
    override val domain: CacheDomain = CacheDomain.VehicleSettings

    // ---- Read ---------------------------------------------------------------------

    override fun vehicleSettings(vehicleId: String): Flow<Resource<VehicleSettingsResponse>> =
        observe(vehicleSettingsCacheKey(vehicleId), VEHICLE_SETTINGS_TTL_MILLIS) {
            api.request<VehicleSettingsResponse>(path = "/vehicles/$vehicleId/settings")
        }

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun upsertVehicleSetting(
        vehicleId: String,
        key: String,
        value: JsonElement,
    ): Result<Unit> =
        api
            .safeRequest<String>(
                method = HttpMethodKind.PUT,
                path = "/vehicles/$vehicleId/settings/${key.encodeURLPathPart()}",
                body = jsonBody(upsertVehicleSettingBody(value)),
            ).map { }
            .onSuccess { evict(vehicleSettingsCacheKey(vehicleId)) }

    override suspend fun resetVehicleSetting(
        vehicleId: String,
        key: String,
    ): Result<Unit> =
        api
            .safeRequest<String>(
                method = HttpMethodKind.DELETE,
                path = "/vehicles/$vehicleId/settings/${key.encodeURLPathPart()}",
            ).map { }
            .onSuccess { evict(vehicleSettingsCacheKey(vehicleId)) }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes reach
     * the wire unchanged — byte-for-byte parity with the web `JSON.stringify` body.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)
}
