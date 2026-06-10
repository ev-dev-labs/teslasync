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
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * Locks every [HttpFsmRepository] call to the exact endpoint/method/params the web `useFSM` hooks
 * issue (`/fsm/stats`, `/fsm/transitions` with snake_case params and the conditional
 * `fsm_name`/`start`/`end` shape), so a path/param regression is caught at build time instead of as
 * a silent always-fails FSM debugger screen in production.
 */
class FsmRepositoryContractTest {
    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "{}",
        onRequest: (Url) -> Unit = {},
    ): HttpFsmRepository {
        val engine =
            MockEngine { request ->
                onRequest(request.url)
                respond(body, HttpStatusCode.OK, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpFsmRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "{}",
        call: (HttpFsmRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it }
        call(r).toList()
        return url!!
    }

    // ---- /fsm/stats ---------------------------------------------------------------

    @Test
    fun statsHitsFsmStatsWithVehicleId() =
        runTestBlocking {
            val url = captureRead { it.stats("7") }
            assertEquals("/api/v1/fsm/stats", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
        }

    // ---- /fsm/transitions ---------------------------------------------------------

    @Test
    fun transitionsHitsFsmTransitionsWithCorePagingParams() =
        runTestBlocking {
            val url =
                captureRead("[]") {
                    it.transitions(entityId = "7", fsmType = FsmType.ALL, hours = 24, page = 2, perPage = 25)
                }
            assertEquals("/api/v1/fsm/transitions", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
            assertEquals("24", url.parameters["hours"])
            assertEquals("2", url.parameters["page"])
            assertEquals("25", url.parameters["per_page"])
        }

    @Test
    fun transitionsOmitsFsmNameForAllFilter() =
        runTestBlocking {
            val url =
                captureRead("[]") {
                    it.transitions(entityId = "7", fsmType = FsmType.ALL, hours = 1, page = 1, perPage = 50)
                }
            // Web `fsmType === 'all' ? '' : '&fsm_name=' + fsmType` — the param is absent for ALL.
            assertNull(url.parameters["fsm_name"])
        }

    @Test
    fun transitionsSendsFsmNameForNonAllFilter() =
        runTestBlocking {
            val url =
                captureRead("[]") {
                    it.transitions(entityId = "7", fsmType = FsmType.TELEMETRY_CONNECTION, hours = 1, page = 1, perPage = 50)
                }
            assertEquals("telemetry_connection", url.parameters["fsm_name"])
        }

    @Test
    fun transitionsOmitsWindowWhenEitherEndMissing() =
        runTestBlocking {
            val startOnly =
                captureRead("[]") {
                    it.transitions("7", FsmType.ALL, 1, 1, 50, startInstant = "2026-05-12T07:00:00.000Z")
                }
            assertNull(startOnly.parameters["start"], "start dropped when end is missing (web `start && end` guard)")
            assertNull(startOnly.parameters["end"])

            val endOnly =
                captureRead("[]") {
                    it.transitions("7", FsmType.ALL, 1, 1, 50, endInstantExclusive = "2026-05-13T07:00:00.000Z")
                }
            assertNull(endOnly.parameters["start"])
            assertNull(endOnly.parameters["end"], "end dropped when start is missing")
        }

    @Test
    fun transitionsSendsHalfOpenWindowWhenBothEndsSupplied() =
        runTestBlocking {
            val url =
                captureRead("[]") {
                    it.transitions(
                        entityId = "7",
                        fsmType = FsmType.VEHICLE,
                        hours = 1,
                        page = 1,
                        perPage = 50,
                        startInstant = "2026-05-12T07:00:00.000Z",
                        endInstantExclusive = "2026-05-13T07:00:00.000Z",
                    )
                }
            assertEquals("2026-05-12T07:00:00.000Z", url.parameters["start"])
            assertEquals("2026-05-13T07:00:00.000Z", url.parameters["end"])
            assertEquals("vehicle", url.parameters["fsm_name"])
        }

    // ---- Cache parity -------------------------------------------------------------

    @Test
    fun feedsCacheUnderDistinctWebQueryKeyTuples() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store = store, body = "{}")
            r.stats("7").toList()
            r.transitions("7", FsmType.VEHICLE, 24, 1, 50).toList()

            assertNotNull(store.read(CacheDomain.Fsm, "stats:7"))
            assertNotNull(store.read(CacheDomain.Fsm, "transitions:${fsmTransitionsKey("7", FsmType.VEHICLE, 24, 1, 50)}"))
        }
}
