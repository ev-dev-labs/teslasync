package io.teslasync.shared.core.data.repo

import io.ktor.client.request.forms.MultiPartFormDataContent
import io.ktor.client.request.forms.formData
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.vehiclephoto.VehiclePhotoMeta
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json

/**
 * HTTP-backed [VehiclePhotoRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). The single read caches the typed [VehiclePhotoMeta] under [vehiclePhotoCacheKey] in the
 * [CacheDomain.VehiclePhoto] partition, honouring the web `useVehiclePhoto` `staleTime`
 * (`60_000`) the domain default already encodes ([VEHICLE_PHOTO_TTL_MILLIS]). The metadata is plain
 * (a bool, an ISO stamp, rendered-path strings), so it is cached as its typed form directly rather
 * than the raw-JSON strategy the SI-bearing list ports use.
 *
 * The two mutations call the API and return a non-throwing [Result]. On success each writes the new
 * meta through this vehicle's cache key ([put]) — the data-layer analogue of the web
 * `queryClient.setQueryData(detail, ...)` — so the matching S8 store refresh re-collects an instant
 * optimistic value before the cache-then-network refetch confirms it. Neither mutation evicts: the
 * web pairs `setQueryData` with `invalidateQueries`, and in the cache-then-network model the store's
 * feed refresh already triggers the refetch, so an evict would only throw away the optimistic value.
 *
 * The upload is multipart/form-data — the request body is a [MultiPartFormDataContent] carrying the
 * image bytes under the [VEHICLE_PHOTO_FORM_FIELD] part with its declared `Content-Type`. The
 * resilient client sends an [io.ktor.http.content.OutgoingContent] body with its own boundary
 * `Content-Type` intact (it does NOT clobber it with `application/json`), which is exactly why the
 * web hook bypasses its JSON `request()` wrapper for this one call. The delete response is read as
 * raw text and discarded so a `204`/empty body never triggers a spurious decode failure.
 */
public class HttpVehiclePhotoRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<VehiclePhotoMeta>(store, clock, json, VehiclePhotoMeta.serializer()),
    VehiclePhotoRepository {
    override val domain: CacheDomain = CacheDomain.VehiclePhoto

    // ---- Read ---------------------------------------------------------------------

    override fun vehiclePhoto(vehicleId: String): Flow<Resource<VehiclePhotoMeta>> =
        observe(vehiclePhotoCacheKey(vehicleId), VEHICLE_PHOTO_TTL_MILLIS) {
            api.request<VehiclePhotoMeta>(path = "/vehicles/$vehicleId/photo")
        }

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun uploadVehiclePhoto(
        vehicleId: String,
        bytes: ByteArray,
        fileName: String,
        mimeType: String?,
    ): Result<VehiclePhotoMeta> =
        api
            .safeRequest<VehiclePhotoMeta>(
                method = HttpMethodKind.POST,
                path = "/vehicles/$vehicleId/photo",
                body = multipartBody(bytes, fileName, mimeType),
            ).onSuccess { put(vehiclePhotoCacheKey(vehicleId), it) }

    override suspend fun deleteVehiclePhoto(vehicleId: String): Result<Unit> =
        api
            .safeRequest<String>(
                method = HttpMethodKind.DELETE,
                path = "/vehicles/$vehicleId/photo",
            ).map { }
            .onSuccess { put(vehiclePhotoCacheKey(vehicleId), VehiclePhotoMeta(hasPhoto = false)) }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Wraps the image [bytes] as a single multipart part named [VEHICLE_PHOTO_FORM_FIELD], carrying
     * the declared [mimeType] and [fileName] so the backend `r.FormFile("photo")` parse succeeds —
     * the wire-level analogue of the browser `FormData.append(VEHICLE_PHOTO_FORM_FIELD, file, name)`.
     */
    private fun multipartBody(
        bytes: ByteArray,
        fileName: String,
        mimeType: String?,
    ): MultiPartFormDataContent =
        MultiPartFormDataContent(
            formData {
                append(
                    key = VEHICLE_PHOTO_FORM_FIELD,
                    value = bytes,
                    headers =
                        Headers.build {
                            if (!mimeType.isNullOrBlank()) append(HttpHeaders.ContentType, mimeType)
                            append(HttpHeaders.ContentDisposition, "filename=\"$fileName\"")
                        },
                )
            },
        )
}
