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
import io.teslasync.shared.core.presentation.admin.MaintenanceUpdateInput
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * HTTP-backed [AdminRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). Every Admin feed shares the single [CacheDomain.Admin] partition, keyed by a
 * stable per-feed string that mirrors the web TanStack query keys, so a feed can be
 * invalidated independently while logout still clears the whole domain in one call.
 *
 * Reads go through the generic cache-then-network operator ([observe]); list reads are
 * wrapped in [safeArray] so the cached payload is already a guaranteed array. Mutations
 * call the API directly and, on success, evict the affected keys — the data-layer analogue
 * of the web hooks' `invalidateQueries`.
 */
public class HttpAdminRepository(
    private val api: ApiHttpClient,
    private val store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    AdminRepository {
    override val domain: CacheDomain = CacheDomain.Admin

    // ---- Reads --------------------------------------------------------------------

    override fun apiKeys(): Flow<Resource<JsonElement>> = observe(KEY_API_KEYS) { safeArray(api.request<JsonElement>(path = "/api-keys")) }

    override fun apiLogs(page: Int): Flow<Resource<JsonElement>> =
        observe("$KEY_API_LOGS:$page") {
            safeArray(
                api.request<JsonElement>(
                    path = "/api-logs",
                    query = mapOf("page" to page.toString(), "limit" to "25"),
                ),
            )
        }

    override fun apiLogStats(): Flow<Resource<JsonElement>> =
        observe(KEY_API_LOG_STATS) { api.request<JsonElement>(path = "/api-logs/stats") }

    override fun backupConfigs(): Flow<Resource<JsonElement>> =
        observe(KEY_BACKUP_CONFIGS) { safeArray(api.request<JsonElement>(path = "/backup/configs")) }

    override fun backupRuns(): Flow<Resource<JsonElement>> =
        observe(KEY_BACKUP_RUNS) { safeArray(api.request<JsonElement>(path = "/backup/runs")) }

    override fun systemHealth(): Flow<Resource<JsonElement>> =
        observe(KEY_SYSTEM_HEALTH) { api.request<JsonElement>(path = "/system/health") }

    override fun maintenanceState(): Flow<Resource<JsonElement>> =
        observe(KEY_MAINTENANCE) { api.request<JsonElement>(path = "/admin/maintenance") }

    override fun auditLogs(): Flow<Resource<JsonElement>> =
        observe(KEY_AUDIT_LOGS) { safeArray(api.request<JsonElement>(path = "/system/audit")) }

    override fun webErrorsSummary(): Flow<Resource<JsonElement>> =
        observe(KEY_WEB_ERRORS) { api.request<JsonElement>(path = "/admin/web-errors/summary") }

    override fun securityEvents(vehicleId: String): Flow<Resource<JsonElement>> =
        observe("$KEY_SECURITY_EVENTS:$vehicleId") {
            safeArray(
                api.request<JsonElement>(
                    path = "/security",
                    query = mapOf("vehicle_id" to vehicleId),
                ),
            )
        }

    override fun dbStats(): Flow<Resource<JsonElement>> = observe(KEY_DB_STATS) { api.request<JsonElement>(path = "/dev-tools/db-stats") }

    override fun migrations(): Flow<Resource<JsonElement>> =
        observe(KEY_MIGRATIONS) { api.request<JsonElement>(path = "/dev-tools/migration-status") }

    override fun connectionPool(): Flow<Resource<JsonElement>> =
        observe(KEY_CONNECTION_POOL) { api.request<JsonElement>(path = "/dev-tools/runtime-info") }

    override fun compressionStats(): Flow<Resource<JsonElement>> =
        observe(KEY_COMPRESSION_STATS) { api.request<JsonElement>(path = "/system/compression-stats") }

    override fun exportJobs(): Flow<Resource<JsonElement>> =
        observe(KEY_EXPORT_JOBS) { safeArray(api.request<JsonElement>(path = "/export/jobs")) }

    override fun vehicleStateMachine(vehicleId: String): Flow<Resource<JsonElement>> =
        observe("$KEY_VEHICLE_STATE:$vehicleId") {
            api.request<JsonElement>(path = "/vehicles/$vehicleId/state")
        }

    override fun stateTimeline(
        vehicleId: String,
        days: Int,
    ): Flow<Resource<JsonElement>> =
        observe("$KEY_STATE_TIMELINE:$vehicleId:$days") {
            api.request<JsonElement>(
                path = "/vehicle-states/timeline",
                query = mapOf("vehicle_id" to vehicleId, "days" to days.toString()),
            )
        }

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun createApiKey(
        name: String,
        permissions: String,
    ): Result<JsonElement> {
        val body =
            buildJsonObject {
                put("name", name)
                put("permissions", permissions)
            }
        return api
            .safeRequest<JsonElement>(method = HttpMethodKind.POST, path = "/api-keys", body = jsonBody(body))
            .onSuccess { store.delete(domain, KEY_API_KEYS) }
    }

    override suspend fun deleteApiKey(id: String): Result<Unit> =
        fireAndForget(HttpMethodKind.DELETE, "/api-keys/$id")
            .onSuccess { store.delete(domain, KEY_API_KEYS) }

    override suspend fun revokeApiKey(id: String): Result<Unit> =
        fireAndForget(HttpMethodKind.POST, "/api-keys/$id/revoke")
            .onSuccess { store.delete(domain, KEY_API_KEYS) }

    override suspend fun updateMaintenance(input: MaintenanceUpdateInput): Result<JsonElement> {
        val body =
            buildJsonObject {
                put("mode", input.mode)
                put("message", input.message ?: "")
                // Web sends `until: input.until ?? null`; an explicit JSON null is emitted
                // when absent so the server clears any open-ended override.
                put("until", input.until)
            }
        return api
            .safeRequest<JsonElement>(method = HttpMethodKind.POST, path = "/admin/maintenance", body = jsonBody(body))
            .onSuccess {
                store.delete(domain, KEY_MAINTENANCE)
                store.delete(domain, KEY_SYSTEM_HEALTH)
            }
    }

    override suspend fun createExport(
        type: String,
        format: String,
        vehicleId: String?,
    ): Result<JsonElement> {
        val body =
            buildJsonObject {
                put("type", type)
                put("format", format)
                // Mirrors `JSON.stringify({ type, format, vehicleId })`: the camelCase key is
                // present only when a value is supplied (an undefined field is dropped).
                if (vehicleId != null) put("vehicleId", vehicleId)
            }
        return api
            .safeRequest<JsonElement>(method = HttpMethodKind.POST, path = "/exports", body = jsonBody(body))
            .onSuccess { store.delete(domain, KEY_EXPORT_JOBS) }
    }

    /**
     * Wraps an already-built [JsonObject] as a [TextContent] so its exact, compact JSON bytes
     * reach the wire unchanged. Passing a raw element as `Any?` would lose the static type
     * content negotiation needs; emitting the serialized text directly sidesteps that and
     * guarantees byte-for-byte parity with the web `JSON.stringify` bodies.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)

    /**
     * POSTs/DELETEs an endpoint whose 2xx body is empty or irrelevant. The response is read
     * as raw text (Ktor returns it without content negotiation, so an empty 204 body never
     * triggers a spurious decode failure) and discarded, yielding `Result<Unit>`.
     */
    private suspend fun fireAndForget(
        method: HttpMethodKind,
        path: String,
    ): Result<Unit> = api.safeRequest<String>(method = method, path = path).map { }

    private companion object {
        const val KEY_API_KEYS = "api-keys"
        const val KEY_API_LOGS = "api-logs"
        const val KEY_API_LOG_STATS = "api-log-stats"
        const val KEY_BACKUP_CONFIGS = "backup-configs"
        const val KEY_BACKUP_RUNS = "backup-runs"
        const val KEY_SYSTEM_HEALTH = "system-health"
        const val KEY_MAINTENANCE = "maintenance"
        const val KEY_AUDIT_LOGS = "audit-logs"
        const val KEY_WEB_ERRORS = "web-errors-summary"
        const val KEY_SECURITY_EVENTS = "security-events"
        const val KEY_DB_STATS = "db-stats"
        const val KEY_MIGRATIONS = "migrations"
        const val KEY_CONNECTION_POOL = "connection-pool"
        const val KEY_COMPRESSION_STATS = "compression-stats"
        const val KEY_EXPORT_JOBS = "export-jobs"
        const val KEY_VEHICLE_STATE = "vehicle-state"
        const val KEY_STATE_TIMELINE = "state-timeline"
    }
}
