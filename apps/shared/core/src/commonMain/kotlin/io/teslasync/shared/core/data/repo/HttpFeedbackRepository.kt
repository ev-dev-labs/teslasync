package io.teslasync.shared.core.data.repo

import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.feedback.FeedbackEntry
import io.teslasync.shared.core.presentation.feedback.FeedbackListParams
import io.teslasync.shared.core.presentation.feedback.FeedbackListResponse
import io.teslasync.shared.core.presentation.feedback.FeedbackSubmitInput
import io.teslasync.shared.core.presentation.feedback.FeedbackUpdateInput
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * HTTP-backed [FeedbackRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). The single list read shares the [CacheDomain.Feedback] partition, keyed by the web
 * TanStack list tuple via [feedbackCacheKey], so each `(status, category, limit, offset)` page
 * is cached independently while a mutation can drop the whole partition in one call and logout
 * still clears everything.
 *
 * The list read is cached as a typed [FeedbackListResponse]. The public submit calls the API
 * directly with NO cache interaction (the web `useSubmitFeedback` declares no invalidation —
 * the submit modal and the admin queue are independent surfaces). The admin patch calls the API
 * and, on success, evicts the ENTIRE partition ([clear]) — the data-layer analogue of the web
 * `useUpdateFeedback` invalidating `feedbackKeys.all`.
 */
public class HttpFeedbackRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<FeedbackListResponse>(store, clock, json, FeedbackListResponse.serializer()),
    FeedbackRepository {
    override val domain: CacheDomain = CacheDomain.Feedback

    // ---- Read ---------------------------------------------------------------------

    override fun feedbackList(params: FeedbackListParams): Flow<Resource<FeedbackListResponse>> =
        observe(feedbackCacheKey(params)) {
            api.request<FeedbackListResponse>(path = "/admin/feedback", query = feedbackQuery(params))
        }

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun submitFeedback(input: FeedbackSubmitInput): Result<FeedbackEntry> {
        val body =
            buildJsonObject {
                put("category", input.category)
                put("title", input.title)
                put("body", input.body)
                // Optionals: dropped when null, kept when an explicit empty string is supplied —
                // mirroring `JSON.stringify` dropping `undefined` but carrying `''`.
                input.pageRoute?.let { put("page_route", it) }
                input.userAgent?.let { put("user_agent", it) }
                input.appVersion?.let { put("app_version", it) }
                input.userEmail?.let { put("user_email", it) }
                input.recentErrors?.let { put("recent_errors", it) }
                input.consoleTail?.let { put("console_tail", it) }
            }
        // No cache invalidation: the web `useSubmitFeedback` performs none.
        return api.safeRequest<FeedbackEntry>(method = HttpMethodKind.POST, path = "/feedback", body = jsonBody(body))
    }

    override suspend fun updateFeedback(input: FeedbackUpdateInput): Result<FeedbackEntry> {
        val body =
            buildJsonObject {
                input.status?.let { put("status", it) }
                input.githubIssueUrl?.let { put("github_issue_url", it) }
                input.forwardToGithub?.let { put("forward_to_github", it) }
            }
        return api
            .safeRequest<FeedbackEntry>(
                method = HttpMethodKind.PATCH,
                path = "/admin/feedback/${input.id}",
                body = jsonBody(body),
            ).onSuccess { clear() }
    }

    /**
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes reach
     * the wire unchanged — byte-for-byte parity with the web `JSON.stringify` bodies.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)
}
