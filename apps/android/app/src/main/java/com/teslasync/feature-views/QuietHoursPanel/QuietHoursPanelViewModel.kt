// UI-thread-free state holder backing the QuietHoursPanel feature view — the native port of the quiet-hours hook
// composition the web component owns (web/src/features/settings/components/QuietHoursPanel.tsx). It binds the
// shared cache-then-network [QuietHoursPanelSource] (P1/S8), projects the windows list onto the shared [UiState]
// surface (loading / content / empty / stale / offline / error), exposes the refresh/retry action, runs the
// create-or-update + delete mutations (web `useSaveQuietHours` / `useDeleteQuietHours`) raising typed
// [QuietHoursToast]s, and emits the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only
// collects state and calls these methods.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/QuietHoursPanel) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.quiethourspanel

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.NotificationsRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.NotificationsStore
import io.teslasync.shared.core.presentation.notifications.QuietHoursWindow
import io.teslasync.shared.core.presentation.notifications.QuietHoursWindowInput
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
 * Lifecycle-aware state holder backing the Compose [QuietHoursPanel]. It consumes the cache-then-network
 * [QuietHoursPanelSource] (P1/S8) and re-shares the windows read as a [UiState] stream via
 * [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that only renders. An empty list maps
 * to the empty surface (web `windows.length === 0` → `<EmptyState />`); an error keeps the best-effort cached
 * data visible with the offline/error chip + retry, never blanking working content.
 *
 * It owns no networking. [refresh]/[retry] re-collect the feed; [save] and [delete] delegate to the source, raise
 * the matching [QuietHoursToast], and restart the read so a write is reflected. [save] returns the [Result] so the
 * composable closes the form on success or keeps it open with the failure toast (web `onSuccess` / `onError`).
 * [recordViewOpened] emits the one-shot `view.opened` diagnostic (P1/S11).
 *
 * @param source the cache-then-network quiet-hours seam (a shared-layer adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the refresh event.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class QuietHoursPanelViewModel(
    private val source: QuietHoursPanelSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network read (manual retry + post-mutation refresh).
    private val refreshTrigger = MutableStateFlow(0)
    private val savingState = MutableStateFlow(false)
    private val deletingState = MutableStateFlow<Set<Long>>(emptySet())
    private val toastChannel = Channel<QuietHoursToast>(Channel.BUFFERED)
    private var viewOpenedRecorded = false

    /**
     * The quiet-hours windows as cache-then-network UI state: loading / content / empty (web
     * `windows.length === 0`) / stale / offline / error, carrying the freshness stamp + error kind.
     */
    val windows: StateFlow<UiState<List<QuietHoursWindow>>> =
        refreshTrigger
            .flatMapLatest { source.windows() }
            .asUiState { it.isEmpty() }

    /** Whether a create-or-update is in flight (web `save.isPending`); disables the form's Save button. */
    val saving: StateFlow<Boolean> = savingState

    /** The ids of windows whose delete is in flight (web `remove.isPending`); disables that row's Delete. */
    val deletingIds: StateFlow<Set<Long>> = deletingState

    /** Typed quiet-hours mutation toasts the composable maps to localized surfaces (web `useToast`). */
    val toasts: Flow<QuietHoursToast> = toastChannel.receiveAsFlow()

    /** Re-runs the cache-then-network load (web `refetch()`); backs the retry affordance. */
    fun refresh() {
        logger.info("quietHours.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error/offline surface's retry affordance. */
    fun retry(): Unit = refresh()

    /**
     * Creates ([id] null) or updates ([id] set) a window (web `submit` → `save.mutate`). Raises
     * [QuietHoursToast.Created] / [QuietHoursToast.Updated] on success or [QuietHoursToast.SaveFailed] on failure,
     * restarts the read on success, and returns the [Result] so the composable closes the form only when it
     * succeeded (web `onSuccess: cancel()`). Validation happens at the render boundary before this is called.
     */
    suspend fun save(
        input: QuietHoursWindowInput,
        id: Long?,
    ): Result<QuietHoursWindow> {
        savingState.value = true
        return try {
            source.saveWindow(input, id).also { result ->
                result.fold(
                    onSuccess = {
                        emitToast(if (id != null) QuietHoursToast.Updated else QuietHoursToast.Created)
                        refreshTrigger.update { it + 1 }
                    },
                    onFailure = { emitToast(QuietHoursToast.SaveFailed) },
                )
            }
        } finally {
            savingState.value = false
        }
    }

    /**
     * Deletes [window] (web `removeWindow` → `remove.mutate`). Raises [QuietHoursToast.Deleted] on success or
     * [QuietHoursToast.DeleteFailed] on failure, then restarts the read. Tracks the id in [deletingIds] for the
     * row's pending state.
     */
    fun delete(window: QuietHoursWindow) {
        deletingState.update { it + window.id }
        launch {
            try {
                source.deleteWindow(window.id).fold(
                    onSuccess = {
                        emitToast(QuietHoursToast.Deleted)
                        refreshTrigger.update { it + 1 }
                    },
                    onFailure = { emitToast(QuietHoursToast.DeleteFailed) },
                )
            } finally {
                deletingState.update { it - window.id }
            }
        }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no window times, timezone, or id, so a diagnostics line can never leak what a user has configured.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordQuietHoursPanelViewOpened(logger)
    }

    private fun emitToast(toast: QuietHoursToast) {
        toastChannel.trySend(toast)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: QuietHoursPanelSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { QuietHoursPanelViewModel(source, logger) }
            }

        /** Wire the surface from the shared **S8** [NotificationsStore]. */
        fun create(
            store: NotificationsStore,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): QuietHoursPanelViewModel = QuietHoursPanelViewModel(quietHoursPanelSource(store), logger, scope)

        /** Wire the surface from the shared **S7** [NotificationsRepository] (refetch-on-retry binding). */
        fun create(
            repository: NotificationsRepository,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): QuietHoursPanelViewModel = QuietHoursPanelViewModel(quietHoursPanelSource(repository), logger, scope)
    }
}
