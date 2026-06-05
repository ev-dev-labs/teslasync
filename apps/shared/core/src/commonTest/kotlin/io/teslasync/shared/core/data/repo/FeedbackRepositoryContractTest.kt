package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.MapCacheStore
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.buildApiHttpClient
import io.teslasync.shared.core.net.jsonHeaders
import io.teslasync.shared.core.net.runTestBlocking
import io.teslasync.shared.core.net.testConfig
import io.teslasync.shared.core.presentation.feedback.FeedbackListParams
import io.teslasync.shared.core.presentation.feedback.FeedbackSubmitInput
import io.teslasync.shared.core.presentation.feedback.FeedbackUpdateInput
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks every [HttpFeedbackRepository] call to the exact endpoint/method/params/body the web
 * `useFeedback` hooks issue, and verifies the web-faithful cache behaviour: the public submit
 * touches no cache, while the admin patch evicts the WHOLE feedback partition (the web
 * `invalidateQueries(feedbackKeys.all)` analogue). A path/param/body regression is caught at
 * build time instead of as a silent always-fails Feedback screen.
 */
class FeedbackRepositoryContractTest {
    private val json = Json

    // A list response the typed `FeedbackListResponse` read can decode.
    private val listBody =
        """
        {"items":[{"id":1,"created_at":"2026-01-01T00:00:00Z","category":"bug","title":"t",
          "body":"b","status":"new"}],"total":1,"limit":25,"offset":0,
          "github_bridge_enabled":true,"github_repo":"ev-dev-labs/teslasync"}
        """.trimIndent()

    // A single feedback entry body the submit/patch reads can decode.
    private val entryBody =
        """
        {"id":1,"created_at":"2026-01-01T00:00:00Z","category":"bug","title":"t","body":"b","status":"new"}
        """.trimIndent()

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "{}",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpFeedbackRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpFeedbackRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = listBody,
        call: (HttpFeedbackRepository) -> kotlinx.coroutines.flow.Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    // ---- Read: path + params ------------------------------------------------------

    @Test
    fun feedbackListHitsAdminFeedbackWithNoParamsWhenEmpty() =
        runTestBlocking {
            val url = captureRead { it.feedbackList() }
            assertEquals("/api/v1/admin/feedback", url.encodedPath)
            assertNull(url.parameters["status"])
            assertNull(url.parameters["category"])
            assertNull(url.parameters["limit"])
            assertNull(url.parameters["offset"])
        }

    @Test
    fun feedbackListSendsEveryParam() =
        runTestBlocking {
            val url =
                captureRead {
                    it.feedbackList(FeedbackListParams(status = "triaged", category = "feature", limit = 25, offset = 50))
                }
            assertEquals("/api/v1/admin/feedback", url.encodedPath)
            assertEquals("triaged", url.parameters["status"])
            assertEquals("feature", url.parameters["category"])
            assertEquals("25", url.parameters["limit"])
            assertEquals("50", url.parameters["offset"])
        }

    @Test
    fun feedbackListOmitsBlankStatusAndCategoryButSendsZeroPaging() =
        runTestBlocking {
            // Web `buildQuery` uses truthy guards for status/category (empty strings dropped) but a
            // numeric guard for limit/offset (an explicit 0 IS sent).
            val url =
                captureRead {
                    it.feedbackList(FeedbackListParams(status = "", category = "", limit = 0, offset = 0))
                }
            assertNull(url.parameters["status"])
            assertNull(url.parameters["category"])
            assertEquals("0", url.parameters["limit"])
            assertEquals("0", url.parameters["offset"])
        }

    @Test
    fun feedbackListDecodesTypedResponseAndCachesUnderListKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = listBody)
            val params = FeedbackListParams(status = "new")
            val emissions = r.feedbackList(params).toList()

            val success = emissions.last() as Resource.Success
            assertEquals(1, success.data.items.size)
            assertEquals(
                "t",
                success.data.items
                    .first()
                    .title,
            )
            assertTrue(success.data.githubBridgeEnabled)
            assertEquals("ev-dev-labs/teslasync", success.data.githubRepo)
            // Cached under the web `feedbackKeys.list` tuple.
            assertTrue(store.read(CacheDomain.Feedback, feedbackCacheKey(params)) != null)
        }

    // ---- Submit: method + path + body + NO cache interaction ----------------------

    @Test
    fun submitFeedbackPostsBodyAndLeavesCacheUntouched() =
        runTestBlocking {
            val store = MapCacheStore()
            // A pre-existing cached list page must SURVIVE a submit (web invalidates nothing).
            store.putRaw(CacheDomain.Feedback, feedbackCacheKey(FeedbackListParams(status = "new")), "{}", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = entryBody, status = HttpStatusCode.Created) { seen = it }

            val result =
                r.submitFeedback(
                    FeedbackSubmitInput(
                        category = "bug",
                        title = "Broken thing",
                        body = "Detailed description of the broken thing",
                        pageRoute = "/dashboard",
                        consoleTail = "TypeError: x is undefined",
                    ),
                )

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/feedback", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("bug", body["category"]!!.jsonPrimitive.content)
            assertEquals("Broken thing", body["title"]!!.jsonPrimitive.content)
            assertEquals("Detailed description of the broken thing", body["body"]!!.jsonPrimitive.content)
            assertEquals("/dashboard", body["page_route"]!!.jsonPrimitive.content)
            assertEquals("TypeError: x is undefined", body["console_tail"]!!.jsonPrimitive.content)
            // Submit invalidates nothing: the cached page is still present.
            assertEquals(1, store.size())
        }

    @Test
    fun submitFeedbackOmitsOptionalKeysWhenNull() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = entryBody, status = HttpStatusCode.Created) { seen = it }

            r.submitFeedback(FeedbackSubmitInput(category = "feature", title = "Add a thing", body = "It would be nice to have"))

            val body = json.parseToJsonElement((requireNotNull(seen).body as TextContent).text) as JsonObject
            assertFalse(body.containsKey("page_route"))
            assertFalse(body.containsKey("user_agent"))
            assertFalse(body.containsKey("app_version"))
            assertFalse(body.containsKey("user_email"))
            assertFalse(body.containsKey("recent_errors"))
            assertFalse(body.containsKey("console_tail"))
        }

    // ---- Update: method + path + body + invalidate-all ----------------------------

    @Test
    fun updateFeedbackPatchesByIdAndInvalidatesWholePartition() =
        runTestBlocking {
            val store = MapCacheStore()
            // Two distinct list pages cached — a patch must drop BOTH (invalidate `all`).
            store.putRaw(CacheDomain.Feedback, feedbackCacheKey(FeedbackListParams(status = "new")), "{}", 1)
            store.putRaw(CacheDomain.Feedback, feedbackCacheKey(FeedbackListParams(category = "bug")), "{}", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = entryBody) { seen = it }

            val result = r.updateFeedback(FeedbackUpdateInput(id = 42, status = "closed"))

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Patch, req.method)
            assertEquals("/api/v1/admin/feedback/42", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("closed", body["status"]!!.jsonPrimitive.content)
            // invalidate `all`: the whole partition is gone.
            assertEquals(0, store.size())
        }

    @Test
    fun updateFeedbackSendsOnlyProvidedFields() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = entryBody) { seen = it }

            r.updateFeedback(FeedbackUpdateInput(id = 42, githubIssueUrl = "https://github.com/x/y/issues/3"))

            val body = json.parseToJsonElement((requireNotNull(seen).body as TextContent).text) as JsonObject
            assertEquals("https://github.com/x/y/issues/3", body["github_issue_url"]!!.jsonPrimitive.content)
            assertFalse(body.containsKey("status"))
            assertFalse(body.containsKey("forward_to_github"))
        }

    @Test
    fun updateFeedbackSendsForwardToGithubOnlyWhenSet() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = entryBody) { seen = it }

            r.updateFeedback(FeedbackUpdateInput(id = 42, forwardToGithub = true))

            val body = json.parseToJsonElement((requireNotNull(seen).body as TextContent).text) as JsonObject
            assertTrue(body["forward_to_github"]!!.jsonPrimitive.content.toBoolean())
            assertFalse(body.containsKey("status"))
            assertFalse(body.containsKey("github_issue_url"))
        }

    @Test
    fun updateFailureDoesNotInvalidate() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Feedback, feedbackCacheKey(FeedbackListParams()), "{}", 1)
            val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
            val r = HttpFeedbackRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)), store)

            val result = r.updateFeedback(FeedbackUpdateInput(id = 42, status = "closed"))

            assertTrue(result.isFailure)
            assertTrue(store.read(CacheDomain.Feedback, feedbackCacheKey(FeedbackListParams())) != null)
        }
}
