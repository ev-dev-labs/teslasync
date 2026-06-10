package io.teslasync.shared.core.presentation.feedback

import io.teslasync.shared.core.data.repo.FeedbackRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.feedbackCacheKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the in-app feedback widget — the cross-platform port of the
 * web `useFeedback` hook domain (web/src/api/hooks/useFeedback.ts). Every native Feedback screen
 * (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing endpoints, query keys, or the invalidate-all rule.
 *
 * The one read is exposed as a hot [StateFlow] of a cache-then-network [Resource] (ADR-013):
 *  - [feedbackList] mirrors the web `useFeedbackList` — the admin queue page for a given
 *    `params`, lazily created on first access and shared so every observer of the same `params`
 *    folds into one upstream collection. The web wrapper's `{ data, isLoading }` maps onto the
 *    [Resource]: `data` is the [Resource.cached]/data response, `isLoading` is
 *    `it is Resource.Loading`.
 *
 * Mutations are non-throwing suspend [Result]s, mirroring the web hooks' invalidation contract
 * exactly:
 *  - [submitFeedback] (web `useSubmitFeedback`) performs NO refresh — the public submit modal is
 *    an independent surface and the web hook declares no `invalidateQueries`.
 *  - [updateFeedback] (web `useUpdateFeedback`) refreshes EVERY observed list feed via
 *    [refreshAll], because the web hook invalidates `feedbackKeys.all` (a status change can move
 *    a row between any pages). The repository (S7) clears the whole cache partition on the same
 *    success, so each refresh re-fetches rather than replaying a stale entry.
 *
 * The holder makes no network calls itself. It mirrors the web hooks' single-threaded usage and
 * is not internally synchronised; create and drive it from one confinement (the platform main
 * scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class FeedbackStore(
    private val repo: FeedbackRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val listFeeds = mutableMapOf<String, StateFlow<Resource<FeedbackListResponse>>>()

    // ---- Reads --------------------------------------------------------------------

    /**
     * Shared, refreshable `GET /admin/feedback` queue feed for [params] (web `useFeedbackList`).
     * Two calls with equal [params] return the same shared [StateFlow]; distinct params are
     * distinct feeds.
     */
    public fun feedbackList(params: FeedbackListParams = FeedbackListParams()): StateFlow<Resource<FeedbackListResponse>> {
        val key = feedbackCacheKey(params)
        return listFeeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { repo.feedbackList(params) }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = INITIAL,
                )
        }
    }

    // ---- Mutations ----------------------------------------------------------------

    /**
     * Submits feedback (web `useSubmitFeedback`). Performs no refresh — the web hook invalidates
     * nothing, so the admin queue is not disturbed by a public submission.
     */
    public suspend fun submitFeedback(input: FeedbackSubmitInput): Result<FeedbackEntry> = repo.submitFeedback(input)

    /** Patches a feedback row, then refreshes every observed feed (web `useUpdateFeedback`). */
    public suspend fun updateFeedback(input: FeedbackUpdateInput): Result<FeedbackEntry> =
        repo.updateFeedback(input).onSuccess { refreshAll() }

    /**
     * Re-fetches every observed feed — the holder-side analogue of invalidating `feedbackKeys.all`.
     * Bumping a feed's trigger restarts its cache-then-network collection. A feed nobody is
     * observing is a no-op.
     */
    public fun refreshAll() {
        triggers.values.forEach { it.update { n -> n + 1 } }
    }

    // ---- Internals ----------------------------------------------------------------

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL: Resource<FeedbackListResponse> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
