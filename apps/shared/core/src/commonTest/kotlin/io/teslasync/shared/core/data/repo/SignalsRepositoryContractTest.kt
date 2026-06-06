package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.MapCacheStore
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.buildApiHttpClient
import io.teslasync.shared.core.net.jsonHeaders
import io.teslasync.shared.core.net.runTestBlocking
import io.teslasync.shared.core.net.testConfig
import io.teslasync.shared.core.presentation.signals.SignalHistoryRange
import io.teslasync.shared.core.presentation.signals.SignalKind
import io.teslasync.shared.core.presentation.signals.SignalUnitKind
import io.teslasync.shared.core.presentation.signals.SignalValue
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks every [HttpSignalsRepository] call to the exact endpoint/method/params the web `useSignals`
 * hooks issue (web/src/api/hooks/useSignals.ts), against the generated OpenAPI contract, and
 * verifies the cached raw SI [kotlinx.serialization.json.JsonElement] is normalized into the typed
 * read model on emission. A path/param/normalization regression is caught at build time instead of
 * as a silently-broken Signals screen.
 */
class SignalsRepositoryContractTest {
    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "{}",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpSignalsRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpSignalsRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "{}",
        call: (HttpSignalsRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    // ---- Reads: path + params -----------------------------------------------------

    @Test
    fun availableHitsPerVehicleAvailableAndNormalizesDescriptors() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = AVAILABLE_BODY)
            val emissions = r.availableSignals(7).toList()

            val success = emissions.last() as Resource.Success
            assertEquals(7L, success.data.vehicleId)
            assertEquals(1, success.data.signals.size)
            assertEquals(
                SignalKind.Float,
                success.data.signals
                    .first()
                    .valueKind,
            )
            assertEquals(
                SignalUnitKind.Speed,
                success.data.signals
                    .first()
                    .unitKind,
            )
            assertTrue(store.read(CacheDomain.Signals, signalsAvailableKey(7)) != null)

            val url = captureRead(AVAILABLE_BODY) { it.availableSignals(7) }
            assertEquals("/api/v1/signals/7/available", url.encodedPath)
        }

    @Test
    fun liveHitsPerVehicleLiveAndNormalizesEnvelopes() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = LIVE_BODY)
            val success = r.liveSignals(7).toList().last() as Resource.Success
            assertEquals(
                SignalKind.Float,
                success.data.signals
                    .getValue("VehicleSpeed")
                    .kind,
            )
            assertEquals(
                SignalValue.Num(13.4),
                success.data.signals
                    .getValue("VehicleSpeed")
                    .value,
            )
            assertTrue(store.read(CacheDomain.Signals, signalsLiveKey(7)) != null)

            val url = captureRead(LIVE_BODY) { it.liveSignals(7) }
            assertEquals("/api/v1/signals/7/live", url.encodedPath)
        }

    @Test
    fun historyHitsPerSignalHistoryWithHoursParam() =
        runTestBlocking {
            val url = captureRead(HISTORY_BODY) { it.signalHistory(7, "VehicleSpeed", SignalHistoryRange(hours = 24)) }
            assertEquals("/api/v1/signals/7/VehicleSpeed/history", url.encodedPath)
            assertEquals("24", url.parameters["hours"])
            assertNull(url.parameters["from"])
            assertNull(url.parameters["to"])
        }

    @Test
    fun historyPrefersFromToOverHoursAndSendsLimit() =
        runTestBlocking {
            val url =
                captureRead(HISTORY_BODY) {
                    it.signalHistory(
                        7,
                        "VehicleSpeed",
                        SignalHistoryRange(hours = 24, from = "2026-01-01T00:00:00Z", to = "2026-01-02T00:00:00Z", limit = 100),
                    )
                }
            assertEquals("/api/v1/signals/7/VehicleSpeed/history", url.encodedPath)
            assertEquals("2026-01-01T00:00:00Z", url.parameters["from"])
            assertEquals("2026-01-02T00:00:00Z", url.parameters["to"])
            assertEquals("100", url.parameters["limit"])
            assertNull(url.parameters["hours"])
        }

    @Test
    fun historyDecodesTypedRowsAndCachesUnderHistoryKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val range = SignalHistoryRange(hours = 24)
            val r = repo(store, body = HISTORY_BODY)
            val success = r.signalHistory(7, "VehicleSpeed", range).toList().last() as Resource.Success
            assertEquals(2, success.data.data.size)
            assertEquals(SignalValue.Num(13.4), success.data.data[1].value)
            assertTrue(store.read(CacheDomain.Signals, signalsHistoryKey(7, "VehicleSpeed", range)) != null)
        }

    private companion object {
        const val AVAILABLE_BODY =
            """{"vehicle_id":7,"count":1,"source":"signal_store","signals":[{"name":"VehicleSpeed",""" +
                """"category":"drive","value_kind":"ValueKindFloat","unit_kind":"speed","is_compound":false,""" +
                """"is_setting_unit":false}]}"""

        const val LIVE_BODY =
            """{"vehicle_id":7,"count":1,"at":"2026-06-15T12:00:00Z","signals":{""" +
                """"VehicleSpeed":{"kind":"ValueKindFloat","value":13.4,"ts":"2026-06-15T12:00:00Z"}}}"""

        const val HISTORY_BODY =
            """{"vehicle_id":7,"signal":"VehicleSpeed","expected_kind":"ValueKindFloat",""" +
                """"from":"2026-06-15T00:00:00Z","to":"2026-06-15T12:00:00Z","count":2,"data":[""" +
                """{"kind":"ValueKindFloat","value":0.0,"ts":"2026-06-15T00:00:00Z"},""" +
                """{"kind":"ValueKindFloat","value":13.4,"ts":"2026-06-15T12:00:00Z"}]}"""
    }
}
