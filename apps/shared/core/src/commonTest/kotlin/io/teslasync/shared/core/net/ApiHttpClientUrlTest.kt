package io.teslasync.shared.core.net

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ApiHttpClientUrlTest {
    @Test
    fun normalizePathAddsLeadingSlashAndStripsStrayPrefix() {
        assertEquals("/vehicles", normalizePath("vehicles"))
        assertEquals("/vehicles", normalizePath("/vehicles"))
        assertEquals("/vehicles", normalizePath("/api/v1/vehicles"))
    }

    @Test
    fun buildUrlPrependsApiV1ExactlyOnce() {
        assertEquals("https://api.test/api/v1/vehicles", buildUrl("https://api.test/", "/vehicles", true))
        assertEquals("https://api.test/api/v1/vehicles", buildUrl("https://api.test", "/api/v1/vehicles", true))
        assertEquals("https://api.test/.well-known/x", buildUrl("https://api.test", "/.well-known/x", false))
    }

    @Test
    fun requestPrependsApiV1OnceAndForwardsSnakeCaseQuery() =
        runTestBlocking {
            var captured: Url? = null
            val engine =
                MockEngine { request ->
                    captured = request.url
                    respond("""{"name":"x","count":1}""", HttpStatusCode.OK, jsonHeaders)
                }
            val client = buildApiHttpClient(engine, testConfig())

            val result: Sample = client.request(path = "/vehicles", query = mapOf("vehicle_id" to "7"))

            assertEquals("x", result.name)
            assertEquals("/api/v1/vehicles", captured?.encodedPath)
            assertEquals("7", captured?.parameters?.get("vehicle_id"))
            // snake_case only: no camelCase variant is synthesised.
            assertNull(captured?.parameters?.get("vehicleId"))
        }

    @Test
    fun callerSuppliedApiV1PrefixIsNotDoubled() =
        runTestBlocking {
            var captured: Url? = null
            val engine =
                MockEngine { request ->
                    captured = request.url
                    respond("""{"name":"x","count":1}""", HttpStatusCode.OK, jsonHeaders)
                }
            val client = buildApiHttpClient(engine, testConfig())

            client.request<Sample>(path = "/api/v1/vehicles")

            assertEquals("/api/v1/vehicles", captured?.encodedPath)
            assertTrue(captured?.encodedPath?.contains("/api/v1/api/v1") == false)
        }

    @Test
    fun nullQueryValuesAreOmitted() =
        runTestBlocking {
            var captured: Url? = null
            val engine =
                MockEngine { request ->
                    captured = request.url
                    respond("""{"name":"x","count":1}""", HttpStatusCode.OK, jsonHeaders)
                }
            val client = buildApiHttpClient(engine, testConfig())

            client.request<Sample>(
                path = "/drives",
                query = mapOf("limit" to "10", "before" to null),
            )

            assertEquals("10", captured?.parameters?.get("limit"))
            assertFalse(captured?.parameters?.contains("before") == true)
        }
}
