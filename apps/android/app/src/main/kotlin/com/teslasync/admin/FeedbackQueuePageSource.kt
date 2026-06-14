// The data seam the FeedbackQueuePage admin surface binds to, plus its production binding over the shared S8
// FeedbackStore. The view (composable) performs NO HTTP — it only collects state from the view-model, which
// drives this seam, reproducing the web page's two TanStack-Query surfaces (`useFeedbackList`,
// `useUpdateFeedback`).
//
// The list read is the typed, cache-then-network [Resource] stream the shared S8 FeedbackStore already
// exposes (`GET /admin/feedback` ▸ feedbackList(params)); the patch + the cache-invalidating refresh are the
// store's own non-throwing mutation + refresh. A narrow seam so the view-model depends on an abstraction
// (real adapter ↔ test fake), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.feedback

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.feedback.FeedbackEntry
import io.teslasync.shared.core.presentation.feedback.FeedbackListParams
import io.teslasync.shared.core.presentation.feedback.FeedbackListResponse
import io.teslasync.shared.core.presentation.feedback.FeedbackStore
import io.teslasync.shared.core.presentation.feedback.FeedbackUpdateInput
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [FeedbackQueuePageViewModel] depends on so it binds to an abstraction (the shared
 * Feedback holder in production, a fake in tests), never to a concrete store or the network. The list read
 * is a cache-then-network typed `Resource` flow (web `useFeedbackList`); [updateFeedback] is the
 * non-throwing patch (web `useUpdateFeedback`); [refreshAll] re-fetches every observed list feed (the web
 * query `refetch` / the post-mutation `invalidateQueries(feedbackKeys.all)`). No HTTP touches the view.
 */
interface FeedbackQueueSource {
    /** The typed `GET /admin/feedback` queue feed for [params] (web `useFeedbackList`). */
    fun feedbackList(params: FeedbackListParams): Flow<Resource<FeedbackListResponse>>

    /** Patches a feedback row's status / GitHub URL or forwards it (web `useUpdateFeedback`). */
    suspend fun updateFeedback(input: FeedbackUpdateInput): Result<FeedbackEntry>

    /** Re-fetches every observed list feed (web `refetch` + the mutation's `invalidateQueries`). */
    fun refreshAll()
}

/**
 * Binds the surface to the shared **S8** [FeedbackStore] — the memoized, multi-observer feedback feeds the
 * app shares. The live values flow through unchanged so the view-model renders the full state matrix
 * (loading / content / empty / error / stale / offline). The store already refreshes every observed feed
 * after a successful patch (web `invalidateQueries(feedbackKeys.all)`), so the queue self-updates. No HTTP
 * touches the view.
 */
fun FeedbackStore.asFeedbackQueueSource(): FeedbackQueueSource {
    val store = this
    return object : FeedbackQueueSource {
        override fun feedbackList(params: FeedbackListParams): Flow<Resource<FeedbackListResponse>> =
            store.feedbackList(params)

        override suspend fun updateFeedback(input: FeedbackUpdateInput): Result<FeedbackEntry> =
            store.updateFeedback(input)

        override fun refreshAll() = store.refreshAll()
    }
}
