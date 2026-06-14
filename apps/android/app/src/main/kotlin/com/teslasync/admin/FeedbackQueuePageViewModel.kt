// The state holder backing the FeedbackQueuePage admin surface (P1/S8) — the native counterpart of the web
// page's React state + TanStack-Query hooks (web/src/features/admin/pages/FeedbackQueuePage.tsx). It owns the
// page's local interaction state (the two filters, the page index, the expanded-row id) as a single immutable
// [FeedbackQueueInteraction] snapshot, projects the cache-then-network list read
// (`GET /admin/feedback{buildQuery(params)}`) onto the shared lifecycle-aware [UiState] surface via
// [BaseFeedViewModel.asUiState], and orchestrates the [updateFeedback] patch (web `useUpdateFeedback`)
// off the UI thread. All derivation logic lives in the framework-free model (FeedbackQueuePageModel.kt);
// this holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.feedback

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.feedback.FeedbackListParams
import io.teslasync.shared.core.presentation.feedback.FeedbackListResponse
import io.teslasync.shared.core.presentation.feedback.FeedbackUpdateInput
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * The page's local interaction snapshot — the union of the web component's `statusFilter`/`categoryFilter`/
 * `page` `useState` group + the expanded-row id, folded into one immutable value so the composable reads a
 * single source. [params] is the projection the cache-then-network read consumes (web `useFeedbackList`'s
 * params object with the `status || undefined` truthy guard).
 */
data class FeedbackQueueInteraction(
    val status: String = "",
    val category: String = "",
    val page: Int = 0,
    val expandedId: Long? = null,
) {
    /** The current query params (web `{ status: status || undefined, category, limit, offset }`). */
    val params: FeedbackListParams
        get() =
            FeedbackListParams(
                status = status.ifEmpty { null },
                category = category.ifEmpty { null },
                limit = FeedbackQueueRegistration.PAGE_SIZE,
                offset = page * FeedbackQueueRegistration.PAGE_SIZE,
            )
}

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.feedback.FeedbackStore]
 *   adapter ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + refresh + the
 *   mutation outcomes.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FeedbackQueuePageViewModel(
    private val source: FeedbackQueueSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val mutableInteraction = MutableStateFlow(FeedbackQueueInteraction())
    private val updatingState = MutableStateFlow(false)
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web `useState` group). */
    val interaction: StateFlow<FeedbackQueueInteraction> = mutableInteraction.asStateFlow()

    /** Whether a patch is in flight — disables the row's edit controls (web `update.isPending`). */
    val updating: StateFlow<Boolean> = updatingState.asStateFlow()

    /**
     * The queue feed as cache-then-network UI state (loading / content / empty / stale / offline / error).
     * Re-collected whenever the query params change (a new filter/page) or the refresh trigger bumps.
     */
    val state: StateFlow<UiState<FeedbackListResponse>> =
        combine(
            mutableInteraction.map { it.params }.distinctUntilChanged(),
            refreshTrigger,
        ) { params, _ -> params }
            .flatMapLatest { params -> source.feedbackList(params) }
            .asUiState(isEmpty = { it.isEmptyQueue })

    // ── Filters (web `setStatusFilter` / `setCategoryFilter` — each resets the page + collapses the row) ──

    /** Select a status filter (web `setStatusFilter(value); setPage(0)`). */
    fun setStatus(value: String): Unit = updateFilter { it.copy(status = value) }

    /** Select a category filter (web `setCategoryFilter(value); setPage(0)`). */
    fun setCategory(value: String): Unit = updateFilter { it.copy(category = value) }

    // ── Pagination + expansion (web `setPage` / row click) ───────────────────────────────────────────────

    /** Go to [page] (0-based, clamped at zero), collapsing the open row (web `setPage`). */
    fun setPage(page: Int): Unit =
        mutableInteraction.update { it.copy(page = page.coerceAtLeast(0), expandedId = null) }

    /** Toggle the expanded detail for [id] (web DataTable row expand). */
    fun toggleExpanded(id: Long): Unit =
        mutableInteraction.update { it.copy(expandedId = if (it.expandedId == id) null else id) }

    // ── Mutations (web `useUpdateFeedback` — status change / save URL / forward) ──────────────────────────

    /** Change a row's status (web `onUpdate({ id, update: { status } })`). */
    fun updateStatus(
        id: Long,
        status: String,
    ): Unit = mutate(FeedbackUpdateInput(id = id, status = status))

    /** Save a row's GitHub issue URL (web `onUpdate({ id, update: { github_issue_url } })`). */
    fun saveGithubUrl(
        id: Long,
        url: String,
    ): Unit = mutate(FeedbackUpdateInput(id = id, githubIssueUrl = url))

    /** Forward a row to GitHub Issues via the server bridge (web `onUpdate({ id, update: { forward } })`). */
    fun forwardToGithub(id: Long): Unit = mutate(FeedbackUpdateInput(id = id, forwardToGithub = true))

    // ── Refresh / retry (web query `refetch` + the error-state retry) ─────────────────────────────────────

    /** Re-fetch the queue feed (the web Refresh button / error retry affordance). */
    fun refresh() {
        logger.info("feedbackQueue.refresh")
        source.refreshAll()
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordFeedbackQueueOpened(logger)
    }

    private fun updateFilter(transform: (FeedbackQueueInteraction) -> FeedbackQueueInteraction) {
        mutableInteraction.update { transform(it).copy(page = 0, expandedId = null) }
    }

    /**
     * Runs a single patch off the UI thread (web `update.mutate`). A patch while one is already in flight is
     * ignored (web disabled controls). On success the shared store refreshes every observed list feed (web
     * `invalidateQueries(feedbackKeys.all)`), so the queue self-updates without a manual reload here.
     */
    private fun mutate(input: FeedbackUpdateInput) {
        if (updatingState.value) return
        launch {
            updatingState.update { true }
            source
                .updateFeedback(input)
                .onSuccess { logger.info("feedbackQueue.updated") }
                .onFailure { logger.warn("feedbackQueue.updateFailed") }
            updatingState.update { false }
        }
    }
}
