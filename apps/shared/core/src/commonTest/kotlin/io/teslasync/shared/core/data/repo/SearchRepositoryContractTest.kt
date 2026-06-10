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
import io.teslasync.shared.core.presentation.search.SearchHitType
import kotlinx.coroutines.flow.toList
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks every [HttpSearchRepository] call to the exact endpoint/method/params the web `useGlobalSearch`
 * hook issues (web/src/api/hooks/useSearch.ts), and verifies the typed [io.teslasync.shared.core.presentation.search.SearchResponse]
 * decode + cache write under the web `searchKeys.global` key. A path/param/body regression is caught
 * at build time instead of as a silently-always-empty search box.
 */
class SearchRepositoryContractTest {
    private val rowBody =
        """
        {"query":"mod","hits":[
          {"type":"vehicle","id":7,"title":"Model 3","subtitle":"Red","url":"/vehicles/7","score":0.91,"when":"2026-01-01T00:00:00Z"},
          {"type":"drive","id":42,"title":"Morning commute","url":"/drives/42","score":0.4}
        ]}
        """.trimIndent()

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = """{"query":"","hits":[]}""",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpSearchRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpSearchRepository(api, store)
    }

    private suspend fun captureRead(
        query: String,
        types: List<SearchHitType> = emptyList(),
        limit: Int? = null,
    ): Url {
        var url: Url? = null
        val r = repo { url = it.url }
        r.globalSearch(query, types, limit).toList()
        return url!!
    }

    // ---- Path + params ------------------------------------------------------------

    @Test
    fun globalSearchHitsRootWithQueryParam() =
        runTestBlocking {
            val url = captureRead("model 3")
            assertEquals("/api/v1/search", url.encodedPath)
            assertEquals("model 3", url.parameters["q"])
            assertNull(url.parameters["types"], "no types ⇒ no `types` param")
            assertNull(url.parameters["limit"], "no limit ⇒ no `limit` param")
        }

    @Test
    fun globalSearchSendsCommaJoinedTypesWhenPresent() =
        runTestBlocking {
            val url = captureRead("mod", types = listOf(SearchHitType.Vehicle, SearchHitType.Drive))
            assertEquals("vehicle,drive", url.parameters["types"])
        }

    @Test
    fun globalSearchSendsLimitOnlyWhenPositive() =
        runTestBlocking {
            assertEquals("10", captureRead("mod", limit = 10).parameters["limit"])
            assertNull(captureRead("mod", limit = 0).parameters["limit"], "limit 0 is not sent (web `limit > 0`)")
        }

    // ---- Decode + cache -----------------------------------------------------------

    @Test
    fun globalSearchDecodesTypedHitsAndCachesUnderQueryKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = rowBody)
            val emissions = r.globalSearch("mod", emptyList(), null).toList()

            assertTrue(emissions.first() is Resource.Loading, "first emission is the cache slot")
            val success = emissions.last() as Resource.Success
            assertEquals("mod", success.data.query)
            assertEquals(2, success.data.hits.size)
            val first = success.data.hits.first()
            assertEquals(SearchHitType.Vehicle, first.type)
            assertEquals(7, first.id)
            assertEquals("Model 3", first.title)
            assertEquals("Red", first.subtitle)
            assertEquals("/vehicles/7", first.url)
            assertEquals(0.91, first.score)
            assertEquals("2026-01-01T00:00:00Z", first.whenAt)
            // The nullable `subtitle`/`when` are absent on the second hit.
            assertNull(success.data.hits[1].subtitle)
            assertNull(success.data.hits[1].whenAt)
            // Cached under the web `searchKeys.global` key.
            assertTrue(store.read(CacheDomain.Search, searchCacheKey("mod", emptyList(), null)) != null)
        }

    @Test
    fun distinctQueriesCacheUnderDistinctKeys() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = rowBody)
            r.globalSearch("mod", emptyList(), null).toList()
            r.globalSearch("model", emptyList(), null).toList()
            r.globalSearch("mod", listOf(SearchHitType.Vehicle), null).toList()
            assertTrue(store.read(CacheDomain.Search, searchCacheKey("mod", emptyList(), null)) != null)
            assertTrue(store.read(CacheDomain.Search, searchCacheKey("model", emptyList(), null)) != null)
            assertTrue(store.read(CacheDomain.Search, searchCacheKey("mod", listOf(SearchHitType.Vehicle), null)) != null)
            // A type filter changes the key (web tuple's 4th element differs).
            assertTrue(
                searchCacheKey("mod", emptyList(), null) != searchCacheKey("mod", listOf(SearchHitType.Vehicle), null),
            )
        }
}
