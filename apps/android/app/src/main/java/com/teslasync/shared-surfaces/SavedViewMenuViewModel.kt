// UI-thread-free state holder backing the SavedViewMenu shared surface — the native port of the five data
// hooks the web component composes (web/src/components/data-display/SavedViewMenu.tsx → useSavedViews +
// useCreateSavedView + useUpdateSavedView + useDeleteSavedView + useSetDefaultSavedView). It binds the shared
// saved-views layer (P1/S8) through [SavedViewMenuSource], re-shares the per-route list feed as a
// lifecycle-aware [UiState] (loading / content / empty / stale / offline / error), and runs the four
// mutations as non-throwing fire-and-forget actions that surface one-shot toast [io.teslasync.android.data.
// UiEvent]s — the web `useMutationToast` success/error split. The view never performs HTTP — it only collects
// [views] + the in-flight flags and calls the action methods.
//
// A successful mutation needs no manual re-fetch here: the shared store evicts + refreshes only the affected
// route's feed on success (the web `invalidateAndBroadcast(savedViewsKeys.list(route))`), which flows straight
// through [views]. [retry]/[refresh] re-run the feed for the hard-error / stale affordances. [onViewOpened]
// emits the one PII-safe `view.opened` diagnostic (P1/S11) — surface slug only, never a name or query.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/SavedViewMenu) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.savedviewmenu

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.android.data.errorKindOf
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.savedviews.DeleteSavedViewArgs
import io.teslasync.shared.core.presentation.savedviews.SavedView
import io.teslasync.shared.core.presentation.savedviews.SavedViewCreateInput
import io.teslasync.shared.core.presentation.savedviews.SavedViewUpdateInput
import io.teslasync.shared.core.presentation.savedviews.SetDefaultSavedViewArgs
import io.teslasync.shared.core.presentation.savedviews.UpdateSavedViewArgs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * State holder backing the Compose [SavedViewMenu].
 *
 * @param source the saved-views read + mutation seam (a shared S8 [io.teslasync.shared.core.presentation.
 *   savedviews.SavedViewsStore] adapter in production, a fake in tests). The view-model owns no networking.
 * @param route the SPA list-page route this menu manages views for (web `route` prop) — keys the feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the PII-safe `view.opened`,
 *   `savedViews.*` mutation events, and `savedViews.refresh` — never a view name or query.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SavedViewMenuViewModel(
    private val source: SavedViewMenuSource,
    private val route: String,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val savingState = MutableStateFlow(false)
    private val renamingState = MutableStateFlow(false)
    private val deletingState = MutableStateFlow(false)
    private var viewOpenedRecorded = false

    /**
     * The saved-views feed for [route] as a lifecycle-aware [UiState]: loading (first open, no cache) /
     * content / empty (no saved views) / stale / offline (cached after a failed refresh) / error (no cache).
     * The composable folds it through [SavedViewMenuProjection] into the rendered rows + active/default views.
     */
    val views: StateFlow<UiState<List<SavedView>>> =
        refreshTrigger
            .flatMapLatest { source.savedViews(route) }
            .asUiState(isEmpty = { it.isEmpty() })

    /** True while a create (the save dialog's submit) is in flight (web `createMut.isPending`). */
    val saving: StateFlow<Boolean> = savingState.asStateFlow()

    /** True while a rename (the rename dialog's submit) is in flight (web `updateMut.isPending`). */
    val renaming: StateFlow<Boolean> = renamingState.asStateFlow()

    /** True while a delete (the confirm dialog's submit) is in flight (web `deleteMut.isPending`). */
    val deleting: StateFlow<Boolean> = deletingState.asStateFlow()

    /**
     * Saves the current querystring as a new view (web `useCreateSavedView`). A blank name is ignored (the web
     * submit guard). On success the success toast fires and [onSuccess] closes the dialog; a failure surfaces
     * the error toast and keeps the dialog open.
     */
    fun create(
        name: String,
        makeDefault: Boolean,
        currentQuery: String,
        onSuccess: () -> Unit,
    ) {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return
        logger.info(SavedViewMenuRegistration.EVENT_CREATE, surfaceField())
        runMutation(savingState, CREATE_FEEDBACK, onSuccess) {
            source.create(
                SavedViewCreateInput(name = trimmed, route = route, query = currentQuery, isDefault = makeDefault),
            )
        }
    }

    /**
     * Renames [view] (web `useUpdateSavedView`). A blank or unchanged name closes the dialog without a PUT
     * (the web submit guard); otherwise the patched name is sent and on success the dialog closes.
     */
    fun rename(
        view: SavedView,
        name: String,
        onSuccess: () -> Unit,
    ) {
        val trimmed = name.trim()
        if (trimmed.isEmpty() || trimmed == view.name) {
            onSuccess()
            return
        }
        logger.info(SavedViewMenuRegistration.EVENT_UPDATE, surfaceField())
        runMutation(renamingState, UPDATE_FEEDBACK, onSuccess) {
            source.update(UpdateSavedViewArgs(view.id, view.route, SavedViewUpdateInput(name = trimmed)))
        }
    }

    /** Deletes [view] (web `useDeleteSavedView`); on success the confirm dialog closes via [onSuccess]. */
    fun delete(
        view: SavedView,
        onSuccess: () -> Unit,
    ) {
        logger.info(SavedViewMenuRegistration.EVENT_DELETE, surfaceField())
        runMutation(deletingState, DELETE_FEEDBACK, onSuccess) {
            source.delete(DeleteSavedViewArgs(view.id, view.route))
        }
    }

    /** Toggles the pinned flag on [view] (web `handleTogglePin` → `useUpdateSavedView`). */
    fun togglePin(view: SavedView) {
        logger.info(SavedViewMenuRegistration.EVENT_UPDATE, surfaceField())
        runMutation(inFlight = null, feedback = UPDATE_FEEDBACK) {
            source.update(UpdateSavedViewArgs(view.id, view.route, SavedViewUpdateInput(isPinned = !view.isPinned)))
        }
    }

    /** Toggles the default flag on [view] (web `handleToggleDefault` → `useSetDefaultSavedView`). */
    fun toggleDefault(view: SavedView) {
        val next = !view.isDefault
        logger.info(SavedViewMenuRegistration.EVENT_SET_DEFAULT, surfaceField())
        val feedback =
            MutationFeedback(
                successToast =
                    if (next) {
                        SavedViewMenuRegistration.TOAST_SET_DEFAULT_SUCCESS
                    } else {
                        SavedViewMenuRegistration.TOAST_UNSET_DEFAULT_SUCCESS
                    },
                errorToast = SavedViewMenuRegistration.TOAST_SET_DEFAULT_ERROR,
                failEvent = SavedViewMenuRegistration.EVENT_SET_DEFAULT_FAILED,
            )
        runMutation(inFlight = null, feedback = feedback) {
            source.setDefault(SetDefaultSavedViewArgs(view.id, view.route, next))
        }
    }

    /** Re-fetches the feed after a hard error (web `refetch`); backs the retry affordance. */
    fun retry() {
        logger.info(SavedViewMenuRegistration.EVENT_REFRESH, surfaceField())
        source.refresh(route)
        refreshTrigger.update { it + 1 }
    }

    /** Re-fetches the feed over the shown rows; backs the stale/offline freshness chip's auto-refresh. */
    fun refresh() = retry()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no view name, query, or route. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(SavedViewMenuRegistration.EVENT_VIEW_OPENED, surfaceField())
    }

    /**
     * Runs [block], optionally tracking [inFlight]; on success surfaces the success toast + invokes
     * [onSuccess] (close the dialog), on failure logs the classified kind + surfaces the error toast. The
     * shared store refreshes the affected route feed on its own success, so no manual re-fetch is needed.
     */
    private fun runMutation(
        inFlight: MutableStateFlow<Boolean>?,
        feedback: MutationFeedback,
        onSuccess: () -> Unit = {},
        block: suspend () -> Result<*>,
    ) {
        inFlight?.update { true }
        launch {
            block().fold(
                onSuccess = {
                    inFlight?.update { false }
                    emitEvent(UiEvent.Message(feedback.successToast, severity = UiEvent.Severity.Success))
                    onSuccess()
                },
                onFailure = { error ->
                    inFlight?.update { false }
                    logger.warn(feedback.failEvent, surfaceField(SavedViewMenuRegistration.KIND_KEY to errorKindOf(error).name))
                    emitEvent(UiEvent.Message(feedback.errorToast, severity = UiEvent.Severity.Error))
                },
            )
        }
    }

    private fun surfaceField(vararg extra: Pair<String, String>): Map<String, String> =
        mapOf(SavedViewMenuRegistration.SURFACE_KEY to SavedViewMenuRegistration.SLUG, *extra)

    /** The toast keys + log event a mutation surfaces, bundled to keep the runner's parameter list small. */
    private data class MutationFeedback(
        val successToast: String,
        val errorToast: String,
        val failEvent: String,
    )

    companion object {
        private val CREATE_FEEDBACK =
            MutationFeedback(
                SavedViewMenuRegistration.TOAST_CREATE_SUCCESS,
                SavedViewMenuRegistration.TOAST_CREATE_ERROR,
                SavedViewMenuRegistration.EVENT_CREATE_FAILED,
            )
        private val UPDATE_FEEDBACK =
            MutationFeedback(
                SavedViewMenuRegistration.TOAST_UPDATE_SUCCESS,
                SavedViewMenuRegistration.TOAST_UPDATE_ERROR,
                SavedViewMenuRegistration.EVENT_UPDATE_FAILED,
            )
        private val DELETE_FEEDBACK =
            MutationFeedback(
                SavedViewMenuRegistration.TOAST_DELETE_SUCCESS,
                SavedViewMenuRegistration.TOAST_DELETE_ERROR,
                SavedViewMenuRegistration.EVENT_DELETE_FAILED,
            )

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel for a [route]. */
        fun factory(
            source: SavedViewMenuSource,
            route: String,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { SavedViewMenuViewModel(source, route, logger) }
            }
    }
}
