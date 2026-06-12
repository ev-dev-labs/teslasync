// UI-thread-free state holder backing the ScheduledExportsPanel feature view — the native port of the hook
// composition the web component owns (web/src/features/system/pages/ScheduledExportsPanel.tsx). It binds the shared
// cache-then-network [ScheduledExportsPanelSource] (P1/S8), projects the schedules list onto the shared [UiState]
// surface (loading / content / empty / stale / offline / error), exposes the refresh/retry action, runs the
// create/update/delete/run-now/toggle mutations (web `useCreateScheduledExport` / `useUpdateScheduledExport` /
// `useDeleteScheduledExport` / `useRunScheduledExportNow` / `toggleEnabled`) raising a typed [ScheduledExportToast]
// on failure, tracks the per-row run-now in-flight id (web `runNow.variables`), and emits the PII-safe
// `view.opened` diagnostic. The view never performs HTTP — it only collects state and calls these methods.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ScheduledExportsPanel) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.scheduledexportspanel

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.ExportsRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.exports.ExportsStore
import io.teslasync.shared.core.presentation.exports.ScheduledExport
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [ScheduledExportsPanel]. It consumes the cache-then-network
 * [ScheduledExportsPanelSource] (P1/S8) and re-shares the schedules read as a [UiState] stream via
 * [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that only renders. An empty schedule
 * list maps to the empty surface (web `rows.length === 0` → `<EmptyState />`); an error keeps the best-effort
 * cached rows visible with the offline/error chip + retry, never blanking working content.
 *
 * It owns no networking. [refresh]/[retry] re-collect the feed; the mutations delegate to the source, refresh the
 * read on success (the web hooks' `invalidateQueries(['scheduled-exports'])`), and raise [ScheduledExportToast]
 * `ActionFailed` on failure. [save] returns whether it succeeded so the form closes on success or stays open on
 * failure (the web `submit` `try { … closeForm() } catch { /* toast */ }`). [runScheduledExportNow] tracks
 * [runningNowId] for the per-row spinner. [recordViewOpened] emits the one-shot `view.opened` diagnostic (P1/S11).
 *
 * @param source the cache-then-network schedules seam (shared-layer adapters in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + refresh events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ScheduledExportsPanelViewModel(
    private val source: ScheduledExportsPanelSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network read (manual retry + post-mutation refresh).
    private val refreshTrigger = MutableStateFlow(0)
    private val runningNow = MutableStateFlow<Long?>(null)
    private val toastChannel = Channel<ScheduledExportToast>(Channel.BUFFERED)
    private var viewOpenedRecorded = false

    /**
     * The schedules list as cache-then-network UI state: loading / content / empty (web `rows.length === 0`) /
     * stale / offline / error, carrying the freshness stamp + error kind.
     */
    val schedules: StateFlow<UiState<List<ScheduledExport>>> =
        refreshTrigger
            .flatMapLatest { source.scheduledExports() }
            .asUiState { it.isEmpty() }

    /** The id of the schedule whose "Run now" is in flight (web `runNow.variables === row.id`), else `null`. */
    val runningNowId: StateFlow<Long?> = runningNow

    /** Typed mutation-failure toasts the composable maps to the localized shared error copy (web global toast). */
    val toasts: Flow<ScheduledExportToast> = toastChannel.receiveAsFlow()

    /** Re-runs the cache-then-network load (web `refetch`); backs retry and the post-mutation refresh. */
    fun refresh() {
        logger.info("scheduledExports.refresh")
        source.invalidate()
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error/offline surface's retry affordance. */
    fun retry(): Unit = refresh()

    /**
     * Creates (when [editingId] is null) or updates the schedule from [form] — the web `submit`. Returns `true` on
     * success so the caller closes the form, refreshing the read; returns `false` on failure (the form stays open)
     * and raises [ScheduledExportToast.ActionFailed], reproducing the web's global error toast.
     */
    suspend fun save(
        editingId: Long?,
        form: ScheduledExportForm,
    ): Boolean {
        val input = toScheduledExportInput(form)
        val result =
            if (editingId == null) {
                source.createScheduledExport(input)
            } else {
                source.updateScheduledExport(editingId, input)
            }
        return result.fold(
            onSuccess = {
                refreshRead()
                true
            },
            onFailure = {
                emitToast(ScheduledExportToast.ActionFailed)
                false
            },
        )
    }

    /**
     * Toggles [row]'s enabled state (web `toggleEnabled`, an update with the flipped flag). Refreshes the read on
     * success or raises [ScheduledExportToast.ActionFailed] on failure.
     */
    fun toggle(row: ScheduledExport) {
        launch {
            source.updateScheduledExport(row.id, toggledScheduledExportInput(row)).fold(
                onSuccess = { refreshRead() },
                onFailure = { emitToast(ScheduledExportToast.ActionFailed) },
            )
        }
    }

    /**
     * Fires a manual "Run now" for [id] (web `runNow.mutate(row.id)`). Tracks [runningNowId] for the row spinner,
     * refreshes the read on success, and raises [ScheduledExportToast.ActionFailed] on failure.
     */
    fun runScheduledExportNow(id: Long) {
        runningNow.value = id
        launch {
            try {
                source.runScheduledExportNow(id).fold(
                    onSuccess = { refreshRead() },
                    onFailure = { emitToast(ScheduledExportToast.ActionFailed) },
                )
            } finally {
                runningNow.update { current -> current.takeIf { it != id } }
            }
        }
    }

    /**
     * Deletes [id] (web `remove.mutate` from the confirm dialog). Refreshes the read on success or raises
     * [ScheduledExportToast.ActionFailed] on failure.
     */
    fun delete(id: Long) {
        launch {
            source.deleteScheduledExport(id).fold(
                onSuccess = { refreshRead() },
                onFailure = { emitToast(ScheduledExportToast.ActionFailed) },
            )
        }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no schedule name, cron, or delivery target, so a diagnostics line can never leak user configuration.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordScheduledExportsViewOpened(logger)
    }

    private fun refreshRead() {
        source.invalidate()
        refreshTrigger.update { it + 1 }
    }

    private fun emitToast(toast: ScheduledExportToast) {
        toastChannel.trySend(toast)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: ScheduledExportsPanelSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ScheduledExportsPanelViewModel(source, logger) }
            }

        /** Wire the surface from the shared **S8** [ExportsStore]. */
        fun create(
            store: ExportsStore,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): ScheduledExportsPanelViewModel = ScheduledExportsPanelViewModel(scheduledExportsPanelSource(store), logger, scope)

        /** Wire the surface from the shared **S7** [ExportsRepository]. */
        fun create(
            repository: ExportsRepository,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): ScheduledExportsPanelViewModel = ScheduledExportsPanelViewModel(scheduledExportsPanelSource(repository), logger, scope)
    }
}
