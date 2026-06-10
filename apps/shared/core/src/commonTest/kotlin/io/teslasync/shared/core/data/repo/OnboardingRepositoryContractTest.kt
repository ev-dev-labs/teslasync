package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.teslasync.shared.core.cache.MapCacheStore
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.buildApiHttpClient
import io.teslasync.shared.core.net.jsonHeaders
import io.teslasync.shared.core.net.runTestBlocking
import io.teslasync.shared.core.net.testConfig
import kotlinx.coroutines.flow.toList
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Locks the [HttpOnboardingRepository] read to the exact endpoint/method the web
 * `useOnboardingStatus` hook issues (web/src/api/hooks/useOnboarding.ts). A path regression — e.g.
 * a double `/api/v1` prefix — is caught at build time instead of as a silently-always-failing
 * onboarding gate in production, and the typed contract shape (the three anchors + `is_complete`)
 * is asserted to round-trip.
 */
class OnboardingRepositoryContractTest {
    private val completeBody =
        """
        {
          "tesla_connected": true,
          "vehicle_count": 2,
          "data_flowing": true,
          "is_complete": true
        }
        """.trimIndent()

    private fun repo(
        respondBody: String = completeBody,
        onRequest: (Url) -> Unit = {},
    ): HttpOnboardingRepository {
        val engine =
            MockEngine { request ->
                onRequest(request.url)
                respond(respondBody, HttpStatusCode.OK, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpOnboardingRepository(api, MapCacheStore())
    }

    @Test
    fun statusHitsOnboardingStatus() =
        runTestBlocking {
            var url: Url? = null
            val r = repo { url = it }
            r.status().toList()
            assertEquals("/api/v1/onboarding/status", url!!.encodedPath)
        }

    @Test
    fun readEmitsCacheThenNetworkSuccess() =
        runTestBlocking {
            val emissions = repo().status().toList()
            assertTrue(emissions.first() is Resource.Loading, "first emission is the cache slot")
            val last = emissions.last()
            assertTrue(last is Resource.Success, "terminal emission is the network success")
            assertTrue(last.data.teslaConnected)
            assertEquals(2, last.data.vehicleCount)
            assertTrue(last.data.dataFlowing)
            assertTrue(last.data.isComplete)
        }

    @Test
    fun incompletePayloadDecodesWithSafeDefaults() =
        runTestBlocking {
            // First-boot shape: nothing connected yet. Omitted fields must decode to the safe
            // pessimistic gate rather than failing the contract read.
            val emissions = repo(respondBody = "{\"tesla_connected\":false}").status().toList()
            val last = emissions.last()
            assertTrue(last is Resource.Success)
            assertFalse(last.data.teslaConnected)
            assertEquals(0, last.data.vehicleCount)
            assertFalse(last.data.dataFlowing)
            assertFalse(last.data.isComplete)
        }
}
