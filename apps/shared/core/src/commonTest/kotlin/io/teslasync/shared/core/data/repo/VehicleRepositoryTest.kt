package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpStatusCode
import io.ktor.http.fullPath
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.cache.newTestCache
import io.teslasync.shared.core.net.buildApiHttpClient
import io.teslasync.shared.core.net.defaultApiJson
import io.teslasync.shared.core.net.jsonHeaders
import io.teslasync.shared.core.net.runTestBlocking
import io.teslasync.shared.core.net.testConfig
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.builtins.ListSerializer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class VehicleRepositoryTest {
    private val vehiclesJson =
        """
        [
          {"id":1,"tesla_id":1001,"vin":"VINAAA","display_name":"Red",
           "timezone":"UTC","created_at":"2026-01-01T00:00:00Z",
           "enrolled_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-02T00:00:00Z"},
          {"id":2,"tesla_id":1002,"vin":"VINBBB","display_name":"Blue",
           "timezone":"UTC","created_at":"2026-01-01T00:00:00Z",
           "enrolled_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-02T00:00:00Z"}
        ]
        """.trimIndent()

    @Test
    fun populatesCacheFromNetworkAndReplaysOnSecondCollection() =
        runTestBlocking {
            var capturedPath: String? = null
            val engine =
                MockEngine { request ->
                    capturedPath = request.url.fullPath
                    respond(vehiclesJson, HttpStatusCode.OK, jsonHeaders)
                }
            val api = buildApiHttpClient(engine, testConfig())
            val repo = VehicleRepository(api, newTestCache().store)

            val first = repo.vehicles().toList()

            // Cold start: no cache, then a network success that is written through.
            assertNull(assertIs<Resource.Loading<List<Vehicle>>>(first[0]).cached)
            val success = assertIs<Resource.Success<List<Vehicle>>>(first[1])
            assertEquals(2, success.data.size)
            assertEquals("VINAAA", success.data[0].vin)
            assertEquals("/api/v1/vehicles/", capturedPath)

            // Second collection replays the now-cached list before refreshing.
            val second = repo.vehicles().toList()
            val replay = assertIs<Resource.Loading<List<Vehicle>>>(second[0])
            assertEquals(2, replay.cached?.size)
        }

    @Test
    fun writeThroughThenOfflineServesCachedListAsStale() =
        runTestBlocking {
            val engine = MockEngine { throw RuntimeException("no network") }
            val api = buildApiHttpClient(engine, testConfig())
            val repo = VehicleRepository(api, newTestCache().store)

            // Decode a known-good list and write it through the cache directly.
            val seeded =
                defaultApiJson.decodeFromString(
                    ListSerializer(Vehicle.serializer()),
                    vehiclesJson,
                )
            repo.cache(seeded)

            val emissions = repo.vehicles().toList()

            assertEquals(2, assertIs<Resource.Loading<List<Vehicle>>>(emissions[0]).cached?.size)
            val errored = assertIs<Resource.Error<List<Vehicle>>>(emissions[1])
            assertEquals(2, errored.cached?.size)
            assertTrue(errored.stale)
        }
}
