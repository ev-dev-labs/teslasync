package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.feedback.FeedbackEntry
import io.teslasync.shared.core.presentation.feedback.FeedbackListParams
import io.teslasync.shared.core.presentation.feedback.FeedbackListResponse
import io.teslasync.shared.core.presentation.feedback.FeedbackSubmitInput
import io.teslasync.shared.core.presentation.feedback.FeedbackUpdateInput
import kotlinx.coroutines.flow.Flow

/**
 * The S7 data port for the in-app feedback widget — the cross-platform analogue of the web
 * `useFeedback` hook domain (web/src/api/hooks/useFeedback.ts). Every native Feedback surface
 * (the public submit modal; the admin queue page) reaches the backend exclusively through this
 * interface, so a single fake stands in for the whole domain in the S8 state-holder tests.
 *
 * Three surfaces, mirroring the three web hooks:
 *  - [submitFeedback] — public `POST /feedback` (web `useSubmitFeedback`); a fire-and-return
 *    mutation that does NOT touch the cache, exactly as the web hook declares no
 *    `invalidateQueries` (the submit modal and the admin queue are independent surfaces).
 *  - [feedbackList] — admin `GET /admin/feedback` (web `useFeedbackList`); the only read,
 *    streamed cache-then-network ([Resource], ADR-013) and keyed by [feedbackCacheKey] so each
 *    `(status, category, limit, offset)` page caches independently.
 *  - [updateFeedback] — admin `PATCH /admin/feedback/{id}` (web `useUpdateFeedback`); on success
 *    it invalidates the WHOLE feedback partition — the data-layer analogue of the web hook
 *    invalidating `feedbackKeys.all` (`['feedback']`), which drops every list page at once.
 *
 * No feedback field is unit-bearing (ids, timestamps, free text, a status enum), so payloads
 * round-trip verbatim with no SI conversion; display formatting is the render boundary's job
 * (S5), never this layer's.
 */
public interface FeedbackRepository {
    /**
     * `POST /feedback` — submits a feedback row (web `useSubmitFeedback`). Returns the created
     * [FeedbackEntry]. The web hook performs no cache invalidation, so neither does this call.
     */
    public suspend fun submitFeedback(input: FeedbackSubmitInput): Result<FeedbackEntry>

    /**
     * `GET /admin/feedback` (optionally `?status=&category=&limit=&offset=`) — the admin queue
     * page for [params] (web `useFeedbackList`). The query is built by [feedbackQuery] with the
     * web `buildQuery` semantics, and the cache key by [feedbackCacheKey] mirroring the web
     * `feedbackKeys.list` tuple.
     */
    public fun feedbackList(params: FeedbackListParams = FeedbackListParams()): Flow<Resource<FeedbackListResponse>>

    /**
     * `PATCH /admin/feedback/{id}` — patches a feedback row's status / GitHub URL or forwards it
     * to GitHub Issues (web `useUpdateFeedback`). On success the whole feedback partition is
     * evicted so the next list read re-fetches.
     */
    public suspend fun updateFeedback(input: FeedbackUpdateInput): Result<FeedbackEntry>
}

/**
 * Builds the `/admin/feedback` query map with the web `buildQuery` semantics
 * (web/src/api/hooks/useFeedback.ts): `status`/`category` are sent only when non-blank
 * (mirroring JavaScript's truthy `if (params.status)` guard, so an empty string is treated as
 * "no filter"); `limit`/`offset` are sent whenever present (mirroring `typeof x === 'number'`,
 * so an explicit `0` IS sent). Keys are snake_case, matching the Go handler. Locked by golden
 * vectors shared with the C# port.
 */
public fun feedbackQuery(params: FeedbackListParams): Map<String, String> {
    val query = linkedMapOf<String, String>()
    params.status?.takeIf { it.isNotEmpty() }?.let { query["status"] = it }
    params.category?.takeIf { it.isNotEmpty() }?.let { query["category"] = it }
    params.limit?.let { query["limit"] = it.toString() }
    params.offset?.let { query["offset"] = it.toString() }
    return query
}

/**
 * Builds the stable cache/feed key for [params], mirroring the web `feedbackKeys.list` tuple
 * `['feedback', 'list', params]`. The four params are projected with null-coalescing
 * (`status ?? 'all'`, `category ?? 'all'`, `limit ?? ''`, `offset ?? ''`) so two param sets
 * collide in the cache exactly when their `(status, category, limit, offset)` differ — and a
 * present-but-empty status stays `''` (distinct from a null `'all'`), exactly as the web query
 * key distinguishes `{}` from `{status:''}`. Locked by golden vectors shared with the C# port.
 */
public fun feedbackCacheKey(params: FeedbackListParams): String =
    listOf(
        params.status ?: "all",
        params.category ?: "all",
        params.limit?.toString() ?: "",
        params.offset?.toString() ?: "",
    ).joinToString(":")
