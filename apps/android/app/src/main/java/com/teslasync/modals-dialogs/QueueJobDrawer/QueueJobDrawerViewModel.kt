// UI-thread-free state holder backing the QueueJobDrawer overlay — the native port of the hook + prop
// composition the web component owns (web/src/features/admin/components/QueueJobDrawer.tsx). It binds
// the shared cache-then-network [QueueJobDrawerSource] (P1/S8), projects the per-worker jobs feed onto
// the shared [UiState] surface (loading / content / empty / stale / offline / error), owns the
// open-time `worker` + `enabled` target the web passes to `useQueueJobs`, exposes the refresh/retry
// action, and emits the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only
// collects state, sets the target, and calls these methods.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/QueueJobDrawer) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.queuejobdrawer

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.QUEUE_JOBS_DEFAULT_LIMIT
import io.teslasync.shared.core.data.repo.SystemQueuesRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.systemqueues.QueueJobsResponse
import io.teslasync.shared.core.presentation.systemqueues.SystemQueuesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * The drawer's open-time fetch target — the native mirror of the two args the web passes to
 * `useQueueJobs(worker ?? '__none__', { enabled })`. [worker] routes the per-worker feed; [enabled]
 * carries the web gate (`open && worker`). A blank [worker] is always disabled regardless of the flag.
 */
data class QueueJobTarget(
    val worker: String,
    val enabled: Boolean,
)

/**
 * Lifecycle-aware state holder backing the Compose [QueueJobDrawer]. It consumes the cache-then-network
 * [QueueJobDrawerSource] (P1/S8) and re-shares the per-worker jobs read as a [UiState] stream via
 * [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that only renders. An empty
 * jobs list maps to the empty surface (web `jobs.length === 0`); an error keeps the best-effort cached
 * rows visible with the offline/error chip + retry, never blanking working content.
 *
 * It owns no networking. [target] sets the `worker` + `enabled` the drawer opened with (web
 * `useQueueJobs` args) — a blank worker stays disabled so a closed/untargeted drawer never fetches.
 * [refresh]/[retry] re-collect the feed (web `refetch`). [recordViewOpened] emits the one-shot
 * `view.opened` diagnostic (P1/S11).
 *
 * @param source the cache-then-network jobs seam (shared-layer adapters in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + refresh events.
 * @param limit the recent-jobs page size (web `QUEUE_JOBS_DEFAULT_LIMIT`).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class QueueJobDrawerViewModel(
    private val source: QueueJobDrawerSource,
    logger: Logger,
    val limit: Int = QUEUE_JOBS_DEFAULT_LIMIT,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network read (manual retry + stale auto-refresh).
    private val refreshTrigger = MutableStateFlow(0)
    private val targetState = MutableStateFlow(QueueJobTarget(worker = "", enabled = false))
    private var viewOpenedRecorded = false

    /**
     * The per-worker recent-jobs list as cache-then-network UI state: loading / content / empty (web
     * `jobs.length === 0`) / stale / offline / error, carrying the freshness stamp + error kind. The
     * feed re-collects whenever [targetState] (the drawer re-targets a worker) or [refreshTrigger] (a
     * retry / auto-refresh) changes.
     */
    val jobs: StateFlow<UiState<QueueJobsResponse>> =
        targetState
            .combine(refreshTrigger) { target, _ -> target }
            .flatMapLatest { target -> source.queueJobs(target.worker, target.enabled, limit) }
            .asUiState { it.jobs.isEmpty() }

    /** The current fetch target (web `useQueueJobs` args); exposed for the view's open-time binding. */
    val target: StateFlow<QueueJobTarget> = targetState

    /**
     * Sets the open-time fetch target — the web `useQueueJobs(worker, { enabled })` args. A blank
     * [worker] forces the feed disabled regardless of [enabled] (the web `enabled: open && worker`
     * gate), so a closed or untargeted drawer never fetches.
     */
    fun setTarget(
        worker: String,
        enabled: Boolean = true,
    ) {
        targetState.value = QueueJobTarget(worker = worker, enabled = enabled && worker.isNotBlank())
    }

    /** Re-runs the cache-then-network load (web `refetch`); backs retry + the stale auto-refresh. */
    fun refresh() {
        logger.info("queueJobDrawer.refresh")
        source.refresh(targetState.value.worker)
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error/offline surface's retry. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no worker id, job id, title, or error text, so a diagnostics line can never leak
     * what a worker is processing.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordQueueJobDrawerViewOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: QueueJobDrawerSource,
            logger: Logger,
            limit: Int = QUEUE_JOBS_DEFAULT_LIMIT,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { QueueJobDrawerViewModel(source, logger, limit) }
            }

        /** Wire the surface from the shared **S8** [SystemQueuesStore]. */
        fun create(
            store: SystemQueuesStore,
            logger: Logger,
            limit: Int = QUEUE_JOBS_DEFAULT_LIMIT,
            scope: CoroutineScope? = null,
        ): QueueJobDrawerViewModel = QueueJobDrawerViewModel(queueJobDrawerSource(store), logger, limit, scope)

        /** Wire the surface from the shared **S7** [SystemQueuesRepository]. */
        fun create(
            repository: SystemQueuesRepository,
            logger: Logger,
            limit: Int = QUEUE_JOBS_DEFAULT_LIMIT,
            scope: CoroutineScope? = null,
        ): QueueJobDrawerViewModel = QueueJobDrawerViewModel(queueJobDrawerSource(repository), logger, limit, scope)
    }
}
