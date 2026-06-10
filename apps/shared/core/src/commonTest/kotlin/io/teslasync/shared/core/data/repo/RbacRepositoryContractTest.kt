package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.MapCacheStore
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.buildApiHttpClient
import io.teslasync.shared.core.net.jsonHeaders
import io.teslasync.shared.core.net.runTestBlocking
import io.teslasync.shared.core.net.testConfig
import io.teslasync.shared.core.presentation.rbacmatrix.RbacMatrixResponse
import io.teslasync.shared.core.presentation.rbacmatrix.RbacMatrixSession
import io.teslasync.shared.core.presentation.rbacmatrix.RbacUpsertCell
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Locks every [HttpRbacRepository] call to the exact endpoint/method/body the web `useRbacMatrix`
 * hooks issue (web/src/api/hooks/useRbacMatrix.ts), verifies the open-mode `501 AUTH_MODE_OPEN` is
 * normalised into [RbacMatrixResponse.Open] (a cached success, never an error), and that the
 * mutation leaves the durable cache intact (the web hook INVALIDATES — refetch — so the S8 store's
 * targeted refresh owns eviction). A path/param/body regression is caught at build time instead of
 * as a silently-always-failing RBAC surface.
 */
class RbacRepositoryContractTest {
    private val json = Json

    private val sessionBody =
        """
        {"mode":"session",
         "roles":[{"id":"admin","name":"admin"}],
         "permissions":[{"id":"vehicles.read","name":"vehicles.read","category":"vehicles"}],
         "categories":["vehicles"],
         "matrix":{"admin":{"vehicles.read":true}},
         "effective_for_me":{"vehicles.read":true},
         "my_roles":["admin"],
         "groups_header_name":"X-Forwarded-Groups"}
        """.trimIndent()

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = sessionBody,
        status: HttpStatusCode = HttpStatusCode.OK,
        maxRetries: Int = 0,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpRbacRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig(maxRetries = maxRetries))
        return HttpRbacRepository(api, store)
    }

    // ---- Read: path + decode + cache ----------------------------------------------

    @Test
    fun matrixHitsAdminRbacMatrixAndDecodesSession() =
        runTestBlocking {
            val store = MapCacheStore()
            var seen: HttpRequestData? = null
            val r = repo(store) { seen = it }

            val emissions = r.matrix().toList()

            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Get, req.method)
            assertEquals("/api/v1/admin/rbac/matrix", req.url.encodedPath)

            assertTrue(emissions.first() is Resource.Loading, "first emission is the cache slot")
            val last = emissions.last()
            assertTrue(last is Resource.Success, "terminal emission is the network success")
            val session = last.data as RbacMatrixSession
            assertEquals(listOf("admin"), session.roles.map { it.id })
            assertEquals(mapOf("admin" to mapOf("vehicles.read" to true)), session.matrix)
            assertEquals("X-Forwarded-Groups", session.groupsHeaderName)
            // Cached under the single matrix key.
            assertTrue(store.read(CacheDomain.Rbac, "matrix") != null)
        }

    @Test
    fun openModeIsNormalisedToOpenAndCachedAsSuccess() =
        runTestBlocking {
            val store = MapCacheStore()
            // 501 with the AUTH_MODE_OPEN envelope — the open-mode contract for this endpoint.
            val r =
                repo(
                    store,
                    body = """{"error":"forward-auth required","code":"AUTH_MODE_OPEN"}""",
                    status = HttpStatusCode.NotImplemented,
                )

            val emissions = r.matrix().toList()

            val last = emissions.last()
            assertTrue(last is Resource.Success, "open-mode 501 reads as a successful no-op, not an error")
            assertEquals(RbacMatrixResponse.Open, last.data)
            // The open sentinel was written through to the cache.
            assertTrue(store.read(CacheDomain.Rbac, "matrix") != null)
        }

    @Test
    fun nonOpenHttpErrorSurfacesAsError() =
        runTestBlocking {
            val r =
                repo(
                    body = """{"error":"boom","code":"INTERNAL"}""",
                    status = HttpStatusCode.InternalServerError,
                )

            val last = r.matrix().toList().last()
            assertTrue(last is Resource.Error, "a non-AUTH_MODE_OPEN failure surfaces as Resource.Error")
        }

    // ---- Mutation: method + path + body + cache-left-intact ------------------------

    @Test
    fun upsertCellsPutsBatchBodyAndLeavesCacheIntact() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Rbac, "matrix", sessionBody, 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = "", status = HttpStatusCode.NoContent) { seen = it }

            val result =
                r.upsertCells(
                    listOf(
                        RbacUpsertCell("admin", "vehicles.read", true),
                        RbacUpsertCell("user", "vehicles.write", false),
                    ),
                )

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Put, req.method)
            assertEquals("/api/v1/admin/rbac/matrix", req.url.encodedPath)

            val sentBody = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            val cells = sentBody["cells"]!!.jsonArray
            assertEquals(2, cells.size)
            val first = cells[0] as JsonObject
            assertEquals("admin", first["role_id"]!!.jsonPrimitive.content)
            assertEquals("vehicles.read", first["permission_id"]!!.jsonPrimitive.content)
            assertEquals("true", first["allowed"]!!.jsonPrimitive.content)
            // INVALIDATE (refetch), not removeQueries: the durable cache is left intact.
            assertEquals(1, store.size())
        }

    @Test
    fun upsertEmptyBatchStillSendsCellsArray() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = "", status = HttpStatusCode.NoContent) { seen = it }

            val result = r.upsertCells(emptyList())

            assertTrue(result.isSuccess)
            val sentBody = json.parseToJsonElement((requireNotNull(seen).body as TextContent).text) as JsonObject
            assertEquals(0, (sentBody["cells"] as JsonArray).size)
        }

    @Test
    fun upsertFailurePropagatesAndLeavesCacheIntact() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Rbac, "matrix", sessionBody, 1)
            val r = repo(store, body = """{"error":"nope"}""", status = HttpStatusCode.InternalServerError)

            val result = r.upsertCells(listOf(RbacUpsertCell("admin", "vehicles.read", true)))

            assertTrue(result.isFailure)
            assertTrue(store.read(CacheDomain.Rbac, "matrix") != null)
        }
}
