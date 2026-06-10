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
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Locks every [HttpSettingsResetRepository] call to the exact endpoint/method/body the web
 * `useSettingsReset` hooks issue: `POST /settings/reset` with `{ section }` (single section) or `{}`
 * (reset all), and verifies each successful mutation flushes the WHOLE offline cache — the
 * data-layer analogue of the web hooks' argument-less `invalidateQueries()`. A path/method/body or
 * missing-invalidation regression is caught at build time instead of as a silent stale-cache bug.
 */
class SettingsResetRepositoryContractTest {
    private val json = Json

    // A receipt body both reset paths can decode.
    private val resultBody =
        """
        {"reset":12,"sections":[{"section":"settings","reset":5},{"section":"alert_rules","reset":7}]}
        """.trimIndent()

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = resultBody,
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpSettingsResetRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpSettingsResetRepository(api, store)
    }

    // ---- resetSection: method + path + body ---------------------------------------

    @Test
    fun resetSectionPostsSettingsResetWithSectionBody() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo { seen = it }

            val result = r.resetSection("alert_rules")

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/settings/reset", req.url.encodedPath)
            val sent = json.parseToJsonElement((req.body as TextContent).text).jsonObject
            assertEquals("alert_rules", sent["section"]!!.jsonPrimitive.content)
            // Decoded receipt carries the total + per-section counts.
            val receipt = result.getOrThrow()
            assertEquals(12, receipt.reset)
            assertEquals(2, receipt.sections.size)
            assertEquals("settings", receipt.sections.first().section)
            assertEquals(5, receipt.sections.first().reset)
        }

    // ---- resetAll: method + path + empty body -------------------------------------

    @Test
    fun resetAllPostsSettingsResetWithEmptyBody() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo { seen = it }

            val result = r.resetAll()

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/settings/reset", req.url.encodedPath)
            val sent = json.parseToJsonElement((req.body as TextContent).text).jsonObject
            // Empty body `{}` — the web `useResetAllSettings` sends no `section`.
            assertFalse(sent.containsKey("section"))
            assertTrue(sent.isEmpty())
        }

    // ---- invalidate-all on success ------------------------------------------------

    @Test
    fun resetSectionFlushesWholeCacheOnSuccess() =
        runTestBlocking {
            val store = MapCacheStore()
            // Seed unrelated cached rows across two domains; a reset must drop them all.
            store.putRaw(CacheDomain.Vehicles, "list", "[]", 1L)
            store.putRaw(CacheDomain.Settings, "doc", "{}", 1L)
            assertEquals(2, store.size())

            val r = repo(store = store)
            assertTrue(r.resetSection("settings").isSuccess)

            // clearAll() ran — the data-layer analogue of invalidateQueries().
            assertEquals(0, store.size())
        }

    @Test
    fun resetAllFlushesWholeCacheOnSuccess() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Notifications, "list", "[]", 1L)
            assertEquals(1, store.size())

            val r = repo(store = store)
            assertTrue(r.resetAll().isSuccess)

            assertEquals(0, store.size())
        }

    // ---- Failure semantics --------------------------------------------------------

    @Test
    fun failedResetSurfacesAsResultFailureAndLeavesCacheIntact() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Vehicles, "list", "[]", 1L)
            val engine = MockEngine { respond("denied", HttpStatusCode.Unauthorized) }
            val r = HttpSettingsResetRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)), store)

            assertTrue(r.resetSection("settings").isFailure)
            // No invalidate on failure: the cached row survives.
            assertEquals(1, store.size())
        }
}
