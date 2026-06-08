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
import io.teslasync.shared.core.presentation.dashboardlayouts.CreateDashboardLayoutInput
import io.teslasync.shared.core.presentation.dashboardlayouts.NamedDashboardLayout
import io.teslasync.shared.core.presentation.dashboardlayouts.UpdateDashboardLayoutInput
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * HTTP-backed [DashboardLayoutRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). Every list read shares the single [CacheDomain.DashboardLayouts] partition, keyed by
 * the web TanStack scope tuple via [dashboardLayoutCacheKey], so a `(vehicle | global)` read is
 * cached independently while a mutation can drop the whole partition in one call and logout still
 * clears everything.
 *
 * The list read is cached as a typed `List<NamedDashboardLayout>`; the `layout` blob round-trips
 * verbatim as its raw JSON. Mutations call the API directly and, on success, evict the ENTIRE
 * partition ([clear]) — the data-layer analogue of the web hooks invalidating
 * `dashboardLayoutLibraryKeys.all`.
 */
public class HttpDashboardLayoutRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<List<NamedDashboardLayout>>(
        store,
        clock,
        json,
        ListSerializer(NamedDashboardLayout.serializer()),
    ),
    DashboardLayoutRepository {
    override val domain: CacheDomain = CacheDomain.DashboardLayouts

    // ---- Read ---------------------------------------------------------------------

    override fun namedLayouts(vehicleId: Long?): Flow<Resource<List<NamedDashboardLayout>>> =
        observe(dashboardLayoutCacheKey(vehicleId)) {
            api.request<List<NamedDashboardLayout>>(path = LAYOUTS_PATH, query = dashboardLayoutListQuery(vehicleId))
        }

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun createLayout(input: CreateDashboardLayoutInput): Result<NamedDashboardLayout> {
        val body =
            buildJsonObject {
                put("name", input.name)
                put("layout", input.layout)
                input.vehicleId?.let { put("vehicle_id", it) }
                input.isDefault?.let { put("is_default", it) }
            }
        return api
            .safeRequest<NamedDashboardLayout>(method = HttpMethodKind.POST, path = LAYOUTS_PATH, body = jsonBody(body))
            .onSuccess { clear() }
    }

    override suspend fun updateLayout(input: UpdateDashboardLayoutInput): Result<NamedDashboardLayout> {
        val body =
            buildJsonObject {
                // Mirror the web `{ id, ...patch }` spread: id is path-only, every other field is
                // sent only when supplied so a partial update never overwrites untouched fields.
                input.name?.let { put("name", it) }
                input.isDefault?.let { put("is_default", it) }
                input.layout?.let { put("layout", it) }
            }
        return api
            .safeRequest<NamedDashboardLayout>(
                method = HttpMethodKind.PUT,
                path = "$LAYOUTS_PATH/${input.id}",
                body = jsonBody(body),
            ).onSuccess { clear() }
    }

    override suspend fun deleteLayout(id: Long): Result<Unit> =
        // The server answers 204 No Content; read the (empty) body as raw text and discard so an
        // empty payload never triggers a spurious decode failure.
        api
            .safeRequest<String>(method = HttpMethodKind.DELETE, path = "$LAYOUTS_PATH/$id")
            .map { }
            .onSuccess { clear() }

    override suspend fun applyLayout(id: Long): Result<NamedDashboardLayout> =
        api
            .safeRequest<NamedDashboardLayout>(method = HttpMethodKind.POST, path = "$LAYOUTS_PATH/$id/apply")
            .onSuccess { clear() }

    /**
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes reach
     * the wire unchanged — byte-for-byte parity with the web `JSON.stringify` bodies (including the
     * opaque `layout` blob).
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)

    private companion object {
        const val LAYOUTS_PATH = "/dashboard/layouts"
    }
}
