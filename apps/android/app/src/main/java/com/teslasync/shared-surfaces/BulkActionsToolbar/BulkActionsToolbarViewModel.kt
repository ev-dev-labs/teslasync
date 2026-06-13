// The UI-thread-free state holder backing the BulkActionsToolbar shared surface — the native port of the web
// component's local `pending` map + `useConfirm` round-trip (web/src/components/data-display/
// BulkActionsToolbar.tsx). It tracks the per-action in-flight set (web `pending`), runs an action through its
// optional confirm gate (web `runAction`), and exposes the one PII-safe `view.opened` diagnostic. The view
// performs NO business logic — it only collects [state] / [confirmDialog] and calls [setSelection] / [run] /
// [respondToConfirm] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.bulkactionstoolbar

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * @param confirmer the confirmation interaction seam (web `useConfirm`); a dialog-backed [DialogBulkConfirmer]
 *   in production, a fake in tests. The view-model owns no UI — it only awaits this port before a confirm-gated
 *   mutation.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` plus a redacted
 *   failure event carrying only the non-PII action id + the exception class name (never selection ids or any
 *   user content).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class BulkActionsToolbarViewModel(
    private val confirmer: BulkConfirmer,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(BulkActionsUiState())
    private var selection: List<String> = emptyList()
    private var viewOpenedRecorded = false

    /** The live reducer state — the per-action in-flight set the render boundary maps to button spinners. */
    val state: StateFlow<BulkActionsUiState> = mutableState.asStateFlow()

    /** The confirmation request to render (web `dialogProps`), delegated to the bound [BulkConfirmer]. */
    val confirmDialog: StateFlow<BulkConfirmRequest?> = confirmer.dialog

    /** Threads the current selection (web `selectedIds` prop) so [run] can hand it to an action's `onClick`. */
    fun setSelection(ids: List<String>) {
        selection = ids
    }

    /**
     * Runs the action [actionId] — the native port of web `runAction`. A no-op while the action is already in
     * flight (web `if (pending[id]) return`). When [confirm] is non-null the mutation is gated behind the
     * confirmer (web `await confirm(...)`), aborting on cancel. The action is then marked in flight, [perform]
     * is invoked with the current selection, and the in-flight flag is always cleared afterwards (web's
     * `finally`), so a failed action re-enables for retry with the selection intact. A coroutine cancellation
     * propagates; any other failure is logged (redacted) rather than crashing the scope — the web source has no
     * visible error surface (it is a controlled toolbar with no fetch), so the parent owns user-facing reporting.
     */
    fun run(
        actionId: String,
        confirm: BulkConfirmRequest? = null,
        perform: suspend (selectedIds: List<String>) -> Unit,
    ) {
        if (mutableState.value.isPending(actionId)) return
        launch {
            if (confirm != null && !confirmer.confirm(confirm)) return@launch
            mutableState.update { it.startPending(actionId) }
            val outcome = runCatching { perform(selection) }
            mutableState.update { it.endPending(actionId) }
            val failure = outcome.exceptionOrNull() ?: return@launch
            if (failure is CancellationException) throw failure
            logger.warn(
                "bulkActionsToolbar.actionFailed",
                mapOf("action" to actionId, "error" to (failure::class.simpleName ?: "")),
            )
        }
    }

    /** Settles the open confirmation with the user's [confirmed] choice (the dialog's confirm/cancel/dismiss). */
    fun respondToConfirm(confirmed: Boolean) {
        confirmer.respond(confirmed)
    }

    /** Emits the one PII-safe `view.opened` diagnostic (P1/S11), at most once per holder. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordBulkActionsToolbarViewOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            confirmer: BulkConfirmer,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { BulkActionsToolbarViewModel(confirmer, logger) }
            }
    }
}
