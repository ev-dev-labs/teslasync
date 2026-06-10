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
import io.teslasync.shared.core.presentation.annotations.AnnotationListParams
import io.teslasync.shared.core.presentation.annotations.ChartAnnotationRow
import io.teslasync.shared.core.presentation.annotations.CreateAnnotationInput
import io.teslasync.shared.core.presentation.annotations.UpdateAnnotationInput
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * HTTP-backed [AnnotationRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). Every list read shares the single [CacheDomain.Annotations] partition, keyed by
 * the web TanStack list tuple via [annotationCacheKey], so a `(vehicle, scope, window)` read
 * is cached independently while a mutation can drop the whole partition in one call and logout
 * still clears everything.
 *
 * The list read is cached as a typed `List<ChartAnnotationRow>`; the projection onto the
 * render shape (`toDataAnnotation`) is an S8 concern and is not performed here. Mutations call
 * the API directly and, on success, evict the ENTIRE partition ([clear]) — the data-layer
 * analogue of the web hooks invalidating `annotationKeys.all`.
 */
public class HttpAnnotationRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<List<ChartAnnotationRow>>(store, clock, json, ListSerializer(ChartAnnotationRow.serializer())),
    AnnotationRepository {
    override val domain: CacheDomain = CacheDomain.Annotations

    // ---- Read ---------------------------------------------------------------------

    override fun chartAnnotations(params: AnnotationListParams): Flow<Resource<List<ChartAnnotationRow>>> =
        observe(annotationCacheKey(params)) {
            api.request<List<ChartAnnotationRow>>(path = "/annotations/", query = annotationQuery(params))
        }

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun createAnnotation(input: CreateAnnotationInput): Result<ChartAnnotationRow> {
        val body =
            buildJsonObject {
                put("occurred_at", input.occurredAt)
                put("category", input.category)
                put("title", input.title)
                input.vehicleId?.let { put("vehicle_id", it) }
                input.description?.let { put("description", it) }
                input.scope?.let { put("scope", stringArray(it)) }
                input.color?.let { put("color", it) }
            }
        return api
            .safeRequest<ChartAnnotationRow>(method = HttpMethodKind.POST, path = "/annotations/", body = jsonBody(body))
            .onSuccess { clear() }
    }

    override suspend fun updateAnnotation(input: UpdateAnnotationInput): Result<ChartAnnotationRow> {
        val body =
            buildJsonObject {
                input.occurredAt?.let { put("occurred_at", it) }
                input.category?.let { put("category", it) }
                input.title?.let { put("title", it) }
                input.description?.let { put("description", it) }
                input.scope?.let { put("scope", stringArray(it)) }
                input.color?.let { put("color", it) }
                // Explicit erasers: only sent when set, mirroring the web optional patch fields.
                if (input.clearDescription) put("clear_description", true)
                if (input.clearColor) put("clear_color", true)
            }
        return api
            .safeRequest<ChartAnnotationRow>(method = HttpMethodKind.PATCH, path = "/annotations/${input.id}", body = jsonBody(body))
            .onSuccess { clear() }
    }

    override suspend fun deleteAnnotation(id: Long): Result<Unit> =
        // The server answers 204 No Content; read the (empty) body as raw text and discard so
        // an empty payload never triggers a spurious decode failure.
        api
            .safeRequest<String>(method = HttpMethodKind.DELETE, path = "/annotations/$id")
            .map { }
            .onSuccess { clear() }

    /**
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes
     * reach the wire unchanged — byte-for-byte parity with the web `JSON.stringify` bodies.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)

    private fun stringArray(values: List<String>): JsonArray = JsonArray(values.map { JsonPrimitive(it) })
}
