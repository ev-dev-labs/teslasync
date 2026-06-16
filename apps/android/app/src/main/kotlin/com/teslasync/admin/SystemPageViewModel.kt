// The state holder backing the SystemPage admin surface (P1/S8) — the native counterpart of the host-owned
// state the web page's embedded QueueStatusPanel keeps (web/src/features/admin/pages/SystemPage.tsx +
// web/src/features/admin/components/QueueStatusPanel.tsx). The page is a thin "infrastructure-budget"
// wrapper: the rate-limit panel self-fetches from the shared SystemStore, so this holder owns only the one
// host-owned region — the `GET /system/queues` worker feed — which it projects onto the shared
// lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState], plus the selected-worker drawer
// target the web `QueueStatusPanel` keeps in local state (web `useState` → `<QueueJobDrawer>`). All
// networking lives in the shared store; this holder performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.system

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.systemqueues.QueueStatusResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.systemqueues.SystemQueuesStore]
 *   adapter ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SystemPageViewModel(
    private val source: SystemPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val selectedWorkerState = MutableStateFlow<String?>(null)
    private var viewOpenedRecorded = false

    /**
     * The worker-queue feed as cache-then-network UI state (loading / content / empty / stale / offline /
     * error). Re-collected whenever the refresh trigger bumps. The empty predicate is the web component's
     * "no workers registered" guard (`workers.length === 0`), so a real response with zero workers resolves
     * to the empty surface rather than blank content.
     */
    val queueState: StateFlow<UiState<QueueStatusResponse>> =
        refreshTrigger
            .flatMapLatest { source.queueStatus() }
            .asUiState { it.workers.isEmpty() }

    /** The worker whose recent-jobs drawer is open (web `QueueStatusPanel` local `useState`), or `null`. */
    val selectedWorker: StateFlow<String?> = selectedWorkerState.asStateFlow()

    /** Re-fetch the worker-queue feed (the web `refetchInterval` / error-retry affordance). */
    fun refresh() {
        logger.info("system.refresh")
        source.refresh()
        refreshTrigger.update { it + 1 }
    }

    /** Open the per-worker job drawer for [worker] (web card click → `setSelectedWorker`). Blank is ignored. */
    fun openWorker(worker: String) {
        if (worker.isBlank()) return
        selectedWorkerState.value = worker
    }

    /** Dismiss the per-worker job drawer (web `onClose` → `setSelectedWorker(null)`). */
    fun closeWorker() {
        selectedWorkerState.value = null
    }

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSystemPageOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] the host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: SystemPageSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { SystemPageViewModel(source, logger) }
            }
    }
}
