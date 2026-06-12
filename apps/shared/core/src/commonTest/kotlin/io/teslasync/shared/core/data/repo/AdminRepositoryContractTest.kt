package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.MapCacheStore
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.buildApiHttpClient
import io.teslasync.shared.core.net.jsonHeaders
import io.teslasync.shared.core.net.runTestBlocking
import io.teslasync.shared.core.net.testConfig
import io.teslasync.shared.core.presentation.admin.MaintenanceUpdateInput
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks every [HttpAdminRepository] call to the exact endpoint/method/params/body the web
 * `useAdmin` hooks issue, and verifies each mutation evicts the cache keys the web hook
 * invalidates. A path/param/body regression is caught at build time instead of as a silent
 * always-fails Admin screen in production.
 */
class AdminRepositoryContractTest {
    private val json = Json

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "{}",
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpAdminRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, HttpStatusCode.OK, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpAdminRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "{}",
        call: (HttpAdminRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    // ---- Reads: path + params -----------------------------------------------------

    @Test
    fun apiKeysHitsApiKeys() =
        runTestBlocking {
            assertEquals("/api/v1/api-keys", captureRead("[]") { it.apiKeys() }.encodedPath)
        }

    @Test
    fun apiLogsHitsApiLogsWithPageAndLimit() =
        runTestBlocking {
            val url = captureRead("[]") { it.apiLogs(3) }
            assertEquals("/api/v1/api-logs", url.encodedPath)
            assertEquals("3", url.parameters["page"])
            assertEquals("25", url.parameters["limit"])
        }

    @Test
    fun apiLogStatsHitsStats() =
        runTestBlocking {
            assertEquals("/api/v1/api-logs/stats", captureRead { it.apiLogStats() }.encodedPath)
        }

    @Test
    fun backupConfigsAndRunsHitBackup() =
        runTestBlocking {
            assertEquals("/api/v1/backup/configs", captureRead("[]") { it.backupConfigs() }.encodedPath)
            assertEquals("/api/v1/backup/runs", captureRead("[]") { it.backupRuns() }.encodedPath)
        }

    @Test
    fun systemHealthHitsSystemHealth() =
        runTestBlocking {
            assertEquals("/api/v1/system/health", captureRead { it.systemHealth() }.encodedPath)
        }

    @Test
    fun maintenanceStateHitsAdminMaintenance() =
        runTestBlocking {
            assertEquals("/api/v1/admin/maintenance", captureRead { it.maintenanceState() }.encodedPath)
        }

    @Test
    fun auditLogsHitsSystemAudit() =
        runTestBlocking {
            assertEquals("/api/v1/system/audit", captureRead("[]") { it.auditLogs() }.encodedPath)
        }

    @Test
    fun webErrorsSummaryHitsAdminWebErrorsSummary() =
        runTestBlocking {
            assertEquals("/api/v1/admin/web-errors/summary", captureRead { it.webErrorsSummary() }.encodedPath)
        }

    @Test
    fun securityEventsHitsSecurityWithVehicleIdQuery() =
        runTestBlocking {
            val url = captureRead("[]") { it.securityEvents("42") }
            assertEquals("/api/v1/security", url.encodedPath)
            assertEquals("42", url.parameters["vehicle_id"])
        }

    @Test
    fun devToolsReadsHitTheirEndpoints() =
        runTestBlocking {
            assertEquals("/api/v1/dev-tools/db-stats", captureRead { it.dbStats() }.encodedPath)
            assertEquals("/api/v1/dev-tools/migration-status", captureRead { it.migrations() }.encodedPath)
            assertEquals("/api/v1/dev-tools/runtime-info", captureRead { it.connectionPool() }.encodedPath)
        }

    @Test
    fun exportJobsHitsExportJobs() =
        runTestBlocking {
            assertEquals("/api/v1/export/jobs", captureRead("[]") { it.exportJobs() }.encodedPath)
        }

    @Test
    fun compressionStatsHitsSystemCompressionStats() =
        runTestBlocking {
            assertEquals("/api/v1/system/compression-stats", captureRead { it.compressionStats() }.encodedPath)
        }

    @Test
    fun vehicleStateMachineHitsPerVehicleState() =
        runTestBlocking {
            assertEquals("/api/v1/vehicles/7/state", captureRead { it.vehicleStateMachine("7") }.encodedPath)
        }

    @Test
    fun stateTimelineHitsTimelineWithVehicleIdAndDays() =
        runTestBlocking {
            val url = captureRead { it.stateTimeline("7", days = 14) }
            assertEquals("/api/v1/vehicle-states/timeline", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
            assertEquals("14", url.parameters["days"])
        }

    // ---- Reads: array guard (safeArray) -------------------------------------------

    @Test
    fun listReadCoercesNonArrayToEmptyArray() =
        runTestBlocking {
            // A backend that hands back an object instead of an array must not crash the UI:
            // safeArray collapses it to [].
            val r = repo(body = "{\"unexpected\":true}")
            val emissions = r.apiKeys().toList()
            val success = emissions.last() as Resource.Success
            assertEquals("[]", success.data.toString())
        }

    // ---- Mutations: method + path + body + invalidation ---------------------------

    @Test
    fun createApiKeyPostsBodyAndInvalidatesApiKeys() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Admin, "api-keys", "[]", 1)
            var seen: HttpRequestData? = null
            val engine =
                MockEngine { request ->
                    seen = request
                    respond("{\"id\":\"k1\",\"key\":\"secret\"}", HttpStatusCode.OK, jsonHeaders)
                }
            val r = HttpAdminRepository(buildApiHttpClient(engine, testConfig()), store)

            val result = r.createApiKey(name = "ci", permissions = "read")

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/api-keys", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("ci", body["name"]!!.jsonPrimitive.content)
            assertEquals("read", body["permissions"]!!.jsonPrimitive.content)
            // invalidateQueries(apiKeys) analogue: the cached feed is evicted.
            assertNull(store.read(CacheDomain.Admin, "api-keys"))
        }

    @Test
    fun deleteApiKeyDeletesAndInvalidates() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Admin, "api-keys", "[]", 1)
            var seen: HttpRequestData? = null
            val r = repo(store) { seen = it }

            val result = r.deleteApiKey("k1")

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Delete, req.method)
            assertEquals("/api/v1/api-keys/k1", req.url.encodedPath)
            assertNull(store.read(CacheDomain.Admin, "api-keys"))
        }

    @Test
    fun revokeApiKeyPostsRevokeAndInvalidates() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Admin, "api-keys", "[]", 1)
            var seen: HttpRequestData? = null
            val r = repo(store) { seen = it }

            val result = r.revokeApiKey("k1")

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/api-keys/k1/revoke", req.url.encodedPath)
            assertNull(store.read(CacheDomain.Admin, "api-keys"))
        }

    @Test
    fun updateMaintenancePostsFullBodyAndInvalidatesMaintenanceAndHealth() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Admin, "maintenance", "{}", 1)
            store.putRaw(CacheDomain.Admin, "system-health", "{}", 1)
            var seen: HttpRequestData? = null
            val r = repo(store) { seen = it }

            val result =
                r.updateMaintenance(
                    MaintenanceUpdateInput(mode = "degraded", message = "down for upgrade", until = null),
                )

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/admin/maintenance", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("degraded", body["mode"]!!.jsonPrimitive.content)
            assertEquals("down for upgrade", body["message"]!!.jsonPrimitive.content)
            // until is emitted as an explicit JSON null, mirroring the web body.
            assertTrue(body.containsKey("until"))
            assertNull(store.read(CacheDomain.Admin, "maintenance"))
            assertNull(store.read(CacheDomain.Admin, "system-health"))
        }

    @Test
    fun createExportOmitsVehicleIdWhenNull() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r =
                repo(body = "{\"id\":\"job1\"}") { seen = it }

            val result = r.createExport(type = "drives", format = "csv", vehicleId = null)

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/exports", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("drives", body["type"]!!.jsonPrimitive.content)
            assertEquals("csv", body["format"]!!.jsonPrimitive.content)
            assertFalse(body.containsKey("vehicleId"))
        }

    @Test
    fun createExportIncludesCamelCaseVehicleIdWhenPresentAndInvalidates() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Admin, "export-jobs", "[]", 1)
            var seen: HttpRequestData? = null
            val engine =
                MockEngine { request ->
                    seen = request
                    respond("{\"id\":\"job1\"}", HttpStatusCode.OK, jsonHeaders)
                }
            val r = HttpAdminRepository(buildApiHttpClient(engine, testConfig()), store)

            val result = r.createExport(type = "charging", format = "json", vehicleId = "7")

            assertTrue(result.isSuccess)
            val body = json.parseToJsonElement((requireNotNull(seen).body as TextContent).text) as JsonObject
            // Verbatim web parity: the body key is camelCase `vehicleId`, not `vehicle_id`.
            assertEquals("7", body["vehicleId"]!!.jsonPrimitive.content)
            assertFalse(body.containsKey("vehicle_id"))
            assertNull(store.read(CacheDomain.Admin, "export-jobs"))
        }

    @Test
    fun mutationFailureDoesNotInvalidate() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Admin, "api-keys", "[]", 1)
            val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
            val r = HttpAdminRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)), store)

            val result = r.deleteApiKey("k1")

            assertTrue(result.isFailure)
            // A failed mutation must leave the cache untouched.
            assertTrue(store.read(CacheDomain.Admin, "api-keys") != null)
        }
}
