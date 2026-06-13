// UI-thread-free state holder backing the JobProgressDrawer overlay — the native port of the hook +
// local-state composition the web component owns (web/src/components/feedback/JobProgressDrawer.tsx).
// It binds the shared cache-then-network [JobProgressDrawerSource] (P1/S8), projects the export-job
// feed onto the shared [UiState] surface (loading / content / empty / stale / offline / error), owns
// the persisted open/minimized/dismissed drawer machine with the web's dismissed -> minimized
// auto-promotion, exposes the refresh/retry action, and emits the PII-safe `view.opened` diagnostic.
// The view never performs HTTP — it only collects state and calls these methods.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/JobProgressDrawer) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.jobprogressdrawer

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.ExportsRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import io.teslasync.shared.core.presentation.exports.ExportsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [JobProgressDrawer]. It consumes the
 * cache-then-network [JobProgressDrawerSource] (P1/S8) and re-shares the export-job read as a
 * [UiState] stream via [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that
 * only renders. An empty job list maps to the empty surface (web `allJobs.length === 0`); an error
 * keeps the best-effort cached rows visible with the offline/error chip + retry, never blanking
 * working content.
 *
 * It owns no networking. [refresh]/[retry] re-collect the feed. [open]/[minimize]/[dismiss] drive the
 * persisted drawer state, and [notifyActiveJobs] reproduces the web `useEffect` that promotes a
 * dismissed drawer back to minimized the moment an active job appears. [recordViewOpened] emits the
 * one-shot `view.opened` diagnostic (P1/S11).
 *
 * @param source the cache-then-network jobs seam (shared-layer adapters in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + refresh events.
 * @param maxRecent the recent-list cap (web `maxRecent`, default [DEFAULT_MAX_RECENT]).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class JobProgressDrawerViewModel(
    private val source: JobProgressDrawerSource,
    logger: Logger,
    val maxRecent: Int = DEFAULT_MAX_RECENT,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network read (manual retry + auto-refresh).
    private val refreshTrigger = MutableStateFlow(0)
    private val presentationState = MutableStateFlow(DrawerPresentation.Default)
    private var viewOpenedRecorded = false

    /**
     * The export-job list as cache-then-network UI state: loading / content / empty (web
     * `allJobs.length === 0`) / stale / offline / error, carrying the freshness stamp + error kind.
     */
    val jobs: StateFlow<UiState<List<ExportJobSummary>>> =
        refreshTrigger
            .flatMapLatest { source.exportJobs() }
            .asUiState { it.isEmpty() }

    /** The persisted open/minimized/dismissed drawer state (web `DrawerState`). */
    val presentation: StateFlow<DrawerPresentation> = presentationState

    /** Expand the drawer to the full panel (web `persist('open')`). */
    fun open() {
        presentationState.value = DrawerPresentation.Open
    }

    /** Collapse the drawer to the minimized chip (web `persist('minimized')`). */
    fun minimize() {
        presentationState.value = DrawerPresentation.Minimized
    }

    /** Dismiss the drawer entirely (web `persist('dismissed')`). */
    fun dismiss() {
        presentationState.value = DrawerPresentation.Dismissed
    }

    /**
     * Reproduces the web `useEffect`: when at least one job is active and the drawer is dismissed,
     * promote it back to minimized so the user notices the new work. A no-op in every other state.
     */
    fun notifyActiveJobs(activeCount: Int) {
        if (activeCount > 0 && presentationState.value == DrawerPresentation.Dismissed) {
            presentationState.value = DrawerPresentation.Minimized
        }
    }

    /** Re-runs the cache-then-network load (web `refetch`); backs retry + the stale auto-refresh. */
    fun refresh() {
        logger.info("jobProgressDrawer.refresh")
        source.invalidate()
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error/offline surface's retry. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no job id, file name, or error text, so a diagnostics line can never leak what a
     * user is exporting.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordJobProgressDrawerViewOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: JobProgressDrawerSource,
            logger: Logger,
            maxRecent: Int = DEFAULT_MAX_RECENT,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { JobProgressDrawerViewModel(source, logger, maxRecent) }
            }

        /** Wire the surface from the shared **S8** [ExportsStore]. */
        fun create(
            store: ExportsStore,
            logger: Logger,
            maxRecent: Int = DEFAULT_MAX_RECENT,
            scope: CoroutineScope? = null,
        ): JobProgressDrawerViewModel = JobProgressDrawerViewModel(jobProgressDrawerSource(store), logger, maxRecent, scope)

        /** Wire the surface from the shared **S7** [ExportsRepository]. */
        fun create(
            repository: ExportsRepository,
            logger: Logger,
            maxRecent: Int = DEFAULT_MAX_RECENT,
            scope: CoroutineScope? = null,
        ): JobProgressDrawerViewModel = JobProgressDrawerViewModel(jobProgressDrawerSource(repository), logger, maxRecent, scope)
    }
}
