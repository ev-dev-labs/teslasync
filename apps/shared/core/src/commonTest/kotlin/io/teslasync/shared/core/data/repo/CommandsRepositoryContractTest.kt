package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.MapCacheStore
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.buildApiHttpClient
import io.teslasync.shared.core.net.jsonHeaders
import io.teslasync.shared.core.net.runTestBlocking
import io.teslasync.shared.core.net.testConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Locks [HttpCommandsRepository]'s two reads to the exact endpoints/methods/params the web
 * `useCommands` hooks issue (web/src/api/hooks/useCommands.ts). A path/param regression — e.g. a
 * double `/api/v1` prefix, a missing `limit=200`, or a wrong segment — is caught at build time
 * instead of as a silently-always-failing Commands screen in production.
 */
class CommandsRepositoryContractTest {
    private fun repo(
        body: String = "[]",
        onRequest: (Url) -> Unit = {},
    ): HttpCommandsRepository {
        val engine =
            MockEngine { request ->
                onRequest(request.url)
                respond(body, HttpStatusCode.OK, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpCommandsRepository(api, MapCacheStore())
    }

    private suspend fun captureRead(
        body: String = "[]",
        call: (HttpCommandsRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it }
        call(r).toList()
        return url!!
    }

    @Test
    fun historyHitsPerVehicleCommandsHistoryWithLimit() =
        runTestBlocking {
            val url = captureRead { it.commandHistory("7") }
            assertEquals("/api/v1/vehicles/7/commands/history", url.encodedPath)
            // Fixed cap mirrors the web template literal `?limit=200`.
            assertEquals("200", url.parameters["limit"])
        }

    @Test
    fun latestHitsPerVehicleCommandsLatestWithNoQuery() =
        runTestBlocking {
            val url = captureRead { it.commandLatest("42") }
            assertEquals("/api/v1/vehicles/42/commands/latest", url.encodedPath)
            assertTrue(url.parameters.isEmpty(), "latest takes no query parameters")
        }

    @Test
    fun readsEmitCacheThenNetworkSuccess() =
        runTestBlocking {
            val history = repo(body = "[]").commandHistory("7").toList()
            assertTrue(history.first() is Resource.Loading, "first emission is the cache slot")
            assertTrue(history.last() is Resource.Success, "terminal emission is the network success")

            val latest = repo(body = "[]").commandLatest("7").toList()
            assertTrue(latest.first() is Resource.Loading)
            assertTrue(latest.last() is Resource.Success)
        }

    @Test
    fun feedsCacheUnderDistinctPrefixedKeysInTheCommandsPartition() =
        runTestBlocking {
            val body =
                """
                [{"id":1,"vehicle_id":7,"command":"wake_up","params":"{}","status":"ok",
                  "error":"","created_at":"2026-01-01T00:00:00Z"}]
                """.trimIndent()
            val store = MapCacheStore()
            val engine = MockEngine { respond(body, HttpStatusCode.OK, jsonHeaders) }
            val api = buildApiHttpClient(engine, testConfig())
            val r = HttpCommandsRepository(api, store)

            r.commandHistory("7").toList()
            r.commandLatest("7").toList()

            // The two reads share the Commands partition under distinct keys (web
            // `commandKeys.history` / `commandKeys.latest`).
            val historyPayload = store.read(CacheDomain.Commands, "history:7")?.payload ?: ""
            val latestPayload = store.read(CacheDomain.Commands, "latest:7")?.payload ?: ""
            assertTrue(historyPayload.contains("\"command\":\"wake_up\""))
            assertTrue(latestPayload.contains("\"command\":\"wake_up\""))
            // Command audit rows are not unit-bearing — no imperial suffixes should ever appear.
            assertFalse(historyPayload.contains("_mph"))
            assertFalse(historyPayload.contains("_kwh"))
        }
}
