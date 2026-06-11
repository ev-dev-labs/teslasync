package io.teslasync.android.featureviews.requestbuilder

import io.teslasync.android.featureviews.endpointsidebar.EndpointBody
import io.teslasync.android.featureviews.endpointsidebar.EndpointParam
import io.teslasync.android.featureviews.endpointsidebar.HttpMethod
import io.teslasync.android.featureviews.endpointsidebar.ParamLocation
import io.teslasync.android.featureviews.endpointsidebar.ParsedEndpoint
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure (off-device) tests for the RequestBuilder model: the per-endpoint default-param + body seed (web
 * `useEffect`), the final URL build with path substitution + encoded query string (web `buildUrl` +
 * `encodeURIComponent`), the destructive-method guard (web `isDestructive`), the optional `X-API-Key` header
 * fold + outgoing [RequestDraft] (web `handleSend` / `onSend`), and the cache-then-network data adapter
 * ([requestBuilderResource] / [requestBuilderSource] — cached selection → snapshot projection), covering the
 * loading / success / empty / error / offline envelope folding.
 */
class RequestBuilderProjectionTest {
    // ── default-param seed (web `useEffect` defaults) ───────────────────────────────────

    @Test
    fun seedParamsKeepsOnlyParametersWithDefaultsInOrder() {
        val endpoint =
            endpoint(
                parameters =
                    listOf(
                        query("limit", default = "50"),
                        path("id"),
                        query("q", default = "x"),
                    ),
            )
        val seeded = RequestBuilderProjection.seedParams(endpoint)
        assertEquals(mapOf("limit" to "50", "q" to "x"), seeded)
        assertEquals(listOf("limit", "q"), seeded.keys.toList())
    }

    @Test
    fun seedParamsIsEmptyWhenNoDefaults() {
        val endpoint = endpoint(parameters = listOf(path("id"), query("q")))
        assertTrue(RequestBuilderProjection.seedParams(endpoint).isEmpty())
    }

    // ── request-body seed (web `useEffect` body) ────────────────────────────────────────

    @Test
    fun seedBodyPrettyPrintsTheExampleWithTwoSpaceIndent() {
        val endpoint = endpoint(requestBody = EndpointBody("application/json", example = "{\"command\":\"honk_horn\"}"))
        val body = RequestBuilderProjection.seedBody(endpoint)
        assertTrue(body.startsWith("{"))
        assertTrue(body.contains("\n  \"command\": \"honk_horn\""))
    }

    @Test
    fun seedBodyUsesTheEmptyTemplateWhenBodyHasNoExample() {
        val endpoint = endpoint(requestBody = EndpointBody("application/json", example = null))
        assertEquals("{\n  \n}", RequestBuilderProjection.seedBody(endpoint))
    }

    @Test
    fun seedBodyIsBlankWhenEndpointTakesNoBody() {
        assertEquals("", RequestBuilderProjection.seedBody(endpoint(requestBody = null)))
    }

    @Test
    fun seedBodyFallsBackToRawExampleWhenNotJson() {
        val endpoint = endpoint(requestBody = EndpointBody("text/plain", example = "not json"))
        assertEquals("not json", RequestBuilderProjection.seedBody(endpoint))
    }

    // ── URL build (web `buildUrl`) ──────────────────────────────────────────────────────

    @Test
    fun buildUrlSubstitutesPathParameters() {
        val endpoint = endpoint(path = "/vehicles/{id}/state", parameters = listOf(path("id")))
        assertEquals("/vehicles/42/state", RequestBuilderProjection.buildUrl(endpoint, mapOf("id" to "42")))
    }

    @Test
    fun buildUrlKeepsPlaceholderWhenPathParameterIsEmpty() {
        val endpoint = endpoint(path = "/vehicles/{id}/state", parameters = listOf(path("id")))
        assertEquals("/vehicles/{id}/state", RequestBuilderProjection.buildUrl(endpoint, emptyMap()))
    }

    @Test
    fun buildUrlAppendsNonEmptyQueryParametersJoinedWithAmpersand() {
        val endpoint = endpoint(path = "/vehicles", parameters = listOf(query("limit"), query("offset")))
        val url = RequestBuilderProjection.buildUrl(endpoint, mapOf("limit" to "10", "offset" to "20"))
        assertEquals("/vehicles?limit=10&offset=20", url)
    }

    @Test
    fun buildUrlOmitsEmptyQueryParameters() {
        val endpoint = endpoint(path = "/vehicles", parameters = listOf(query("limit"), query("offset")))
        val url = RequestBuilderProjection.buildUrl(endpoint, mapOf("limit" to "10", "offset" to ""))
        assertEquals("/vehicles?limit=10", url)
    }

    @Test
    fun buildUrlEncodesQueryValues() {
        val endpoint = endpoint(path = "/search", parameters = listOf(query("q")))
        val url = RequestBuilderProjection.buildUrl(endpoint, mapOf("q" to "a b&c"))
        assertEquals("/search?q=a%20b%26c", url)
    }

    @Test
    fun displayUrlPrependsTheApiPrefix() {
        val endpoint = endpoint(path = "/vehicles")
        assertEquals("/api/v1/vehicles", RequestBuilderProjection.displayUrl(endpoint, emptyMap()))
    }

    // ── encodeURIComponent parity ───────────────────────────────────────────────────────

    @Test
    fun encodeQueryComponentMatchesEncodeUriComponent() {
        assertEquals("a%20b", RequestBuilderProjection.encodeQueryComponent("a b"))
        assertEquals("a%26b%3Dc", RequestBuilderProjection.encodeQueryComponent("a&b=c"))
        assertEquals("%2Fpath%3F", RequestBuilderProjection.encodeQueryComponent("/path?"))
        // Multi-byte UTF-8 is percent-encoded byte by byte (é → %C3%A9).
        assertEquals("caf%C3%A9", RequestBuilderProjection.encodeQueryComponent("café"))
        // The unreserved set is emitted verbatim.
        assertEquals("a-b_c.d~e!*'()", RequestBuilderProjection.encodeQueryComponent("a-b_c.d~e!*'()"))
    }

    // ── destructive guard (web `isDestructive`) ─────────────────────────────────────────

    @Test
    fun onlyGetIsNonDestructive() {
        assertFalse(RequestBuilderProjection.isDestructive(endpoint(method = HttpMethod.Get)))
        assertTrue(RequestBuilderProjection.isDestructive(endpoint(method = HttpMethod.Post)))
        assertTrue(RequestBuilderProjection.isDestructive(endpoint(method = HttpMethod.Put)))
        assertTrue(RequestBuilderProjection.isDestructive(endpoint(method = HttpMethod.Delete)))
        assertTrue(RequestBuilderProjection.isDestructive(endpoint(method = HttpMethod.Patch)))
    }

    // ── header fold (web `handleSend`) ──────────────────────────────────────────────────

    @Test
    fun buildHeadersOmitsBlankApiKey() {
        assertTrue(RequestBuilderProjection.buildHeaders("").isEmpty())
        assertTrue(RequestBuilderProjection.buildHeaders("   ").isEmpty())
    }

    @Test
    fun buildHeadersTrimsAndSetsApiKey() {
        assertEquals(mapOf("X-API-Key" to "secret"), RequestBuilderProjection.buildHeaders("  secret  "))
    }

    // ── outgoing draft (web `onSend`) ───────────────────────────────────────────────────

    @Test
    fun draftBuildsTheOutgoingRequest() {
        val endpoint = endpoint(method = HttpMethod.Post, path = "/vehicles/{id}/command", parameters = listOf(path("id")))
        val draft = RequestBuilderProjection.draft(endpoint, mapOf("id" to "7"), body = "{\"x\":1}", apiKey = "k")
        assertEquals("/vehicles/7/command", draft.url)
        assertEquals("POST", draft.method)
        assertEquals("{\"x\":1}", draft.body)
        assertEquals(mapOf("X-API-Key" to "k"), draft.headers)
    }

    @Test
    fun draftSendsNullBodyWhenEmpty() {
        val draft = RequestBuilderProjection.draft(endpoint(), emptyMap(), body = "", apiKey = "")
        assertNull(draft.body)
        assertTrue(draft.headers.isEmpty())
    }

    // ── data adapter (cached → snapshot) ────────────────────────────────────────────────

    @Test
    fun adapterFoldsSelectionIntoContentSnapshot() =
        runTest {
            val source = FakeSource(listOf(Resource.Success(endpoint(), fetchedAt = 5L, stale = false)))
            val result = requestBuilderResource(source).toList().last()
            assertTrue(result is Resource.Success)
            assertFalse(result.cached?.isEmpty ?: true)
            assertEquals("/vehicles", result.cached?.endpoint?.path)
        }

    @Test
    fun adapterFoldsNullSelectionIntoEmptySnapshot() =
        runTest {
            val source = FakeSource(listOf(Resource.Success(null, fetchedAt = 5L, stale = false)))
            val result = requestBuilderResource(source).toList().last()
            assertTrue(result is Resource.Success)
            assertTrue(result.cached?.isEmpty == true)
        }

    @Test
    fun adapterKeepsLoadingCacheAsSnapshot() =
        runTest {
            val source = FakeSource(listOf(Resource.Loading(endpoint(), fetchedAt = 1L, stale = false)))
            val result = requestBuilderResource(source).toList().last()
            assertTrue(result is Resource.Loading)
            assertEquals("/vehicles", result.cached?.endpoint?.path)
        }

    @Test
    fun adapterKeepsOfflineCacheAsSnapshotWithError() =
        runTest {
            val source =
                FakeSource(
                    listOf(Resource.Error(endpoint(), fetchedAt = 2L, stale = true, error = ApiError.Timeout())),
                )
            val result = requestBuilderResource(source).toList().last()
            assertTrue(result is Resource.Error)
            assertEquals("/vehicles", result.cached?.endpoint?.path)
            assertTrue(result.stale)
        }

    @Test
    fun adapterPropagatesHardErrorWithoutCache() =
        runTest {
            val source =
                FakeSource(listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())))
            val result = requestBuilderResource(source).toList().last()
            assertTrue(result is Resource.Error)
            assertNull(result.cached)
        }

    @Test
    fun defaultSourceEmitsProvidedSelectionOnce() =
        runTest {
            val emissions = requestBuilderSource(endpoint()).selectedEndpoint().toList()
            assertEquals(1, emissions.size)
            assertEquals("/vehicles", emissions.single().cached?.path)
        }

    @Test
    fun defaultSourceEmitsNullSelectionOnce() =
        runTest {
            val emissions = requestBuilderSource(null).selectedEndpoint().toList()
            assertEquals(1, emissions.size)
            assertNull(emissions.single().cached)
        }

    // ── fixtures ────────────────────────────────────────────────────────────────────────

    private fun endpoint(
        method: HttpMethod = HttpMethod.Get,
        path: String = "/vehicles",
        parameters: List<EndpointParam> = emptyList(),
        requestBody: EndpointBody? = null,
    ): ParsedEndpoint =
        ParsedEndpoint(
            method = method,
            path = path,
            tag = "Vehicles",
            summary = "Sample",
            operationId = "sample",
            parameters = parameters,
            requestBody = requestBody,
        )

    private fun path(
        name: String,
        default: String? = null,
    ): EndpointParam = EndpointParam(name, ParamLocation.Path, required = true, type = "string", description = "", default = default)

    private fun query(
        name: String,
        default: String? = null,
    ): EndpointParam = EndpointParam(name, ParamLocation.Query, required = false, type = "string", description = "", default = default)

    private class FakeSource(
        private val emissions: List<Resource<ParsedEndpoint?>>,
    ) : RequestBuilderSource {
        override fun selectedEndpoint(): Flow<Resource<ParsedEndpoint?>> = emissions.asFlow()

        override suspend fun refresh() = Unit
    }
}
