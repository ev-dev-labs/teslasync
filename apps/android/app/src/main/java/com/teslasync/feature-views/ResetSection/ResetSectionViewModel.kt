// UI-thread-free state holder backing the Compose [ResetSection] surface — the native port of the web panel's
// hook composition (web/src/features/settings/components/ResetSection.tsx). The web component owns three bits
// of state: the per-section `pending` confirm dialog, the Danger-zone `resetAllOpen` typed-confirm dialog, and
// the in-flight flag of whichever `useResetSection` / `useResetAllSettings` mutation is running. On confirm it
// awaits the mutation, raises a success toast carrying the receipt counts (its `announceSuccess`), and on
// failure the hook's `useMutationToast` raises an error toast; a confirm always closes its dialog when done.
//
// Here that becomes a small confirm-then-run machine over the injected [ResetSectionSource] (P1/S8): a
// [ResetSectionUiState] tracking the open dialog + busy flag, and a one-shot [BaseFeedViewModel.events] stream
// carrying the success / failure toast as a localized i18n key (ADR-014), never a pre-formatted sentence. The
// view-model performs no HTTP (ADR-002) and logs only the PII-safe surface slug (ADR-016) — never a section id
// or receipt. Because the shared client handles the backend's `RequireSudo` step-up transparently, there is no
// distinct "sudo canceled" branch (see [ResetSectionSource]); a failed step-up is just a failed [Result].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ResetSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.resetsection

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiEvent
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settingsreset.SettingsResetResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * State holder backing the Compose [ResetSection].
 *
 * It owns the dialog + busy [state] and routes the two reset mutations through the injected [source]. The
 * first [onAppear] records the one-shot `view.opened` diagnostic; [requestSection] / [requestAll] open a
 * confirm dialog; [dismiss] closes it; [confirm] runs the pending reset — flipping [ResetSectionUiState.busy]
 * while in flight (so the dialog stays open + loading), raising a success toast with the receipt counts or a
 * failure toast, then closing the dialog. It owns no networking and never logs anything but the surface slug.
 *
 * @param source the settings-reset mutation seam (P1/S8) — a shared-store adapter in production, a fake in tests.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class ResetSectionViewModel(
    private val source: ResetSectionSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(ResetSectionUiState())

    /** The dialog + busy interaction state the surface renders. */
    val state: StateFlow<ResetSectionUiState> = mutableState.asStateFlow()

    private var viewOpenedRecorded = false

    /**
     * Records the one-shot `view.opened` diagnostic (P1/S11 — PII-safe, surface slug only), at most once per
     * holder. Call from the composable's first-composition effect.
     */
    fun onAppear() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        ResetSectionDiagnostics.recordViewOpened(logger)
    }

    /** Opens the per-section confirm dialog for [row] (web `setPending(row)`). A no-op while a reset is in flight. */
    fun requestSection(row: ResetSectionRow) {
        if (mutableState.value.busy) return
        mutableState.value = ResetSectionUiState(dialog = ResetDialog.Section(row))
    }

    /** Opens the Danger-zone typed-confirmation dialog (web `setResetAllOpen(true)`). A no-op while a reset is in flight. */
    fun requestAll() {
        if (mutableState.value.busy) return
        mutableState.value = ResetSectionUiState(dialog = ResetDialog.All)
    }

    /** Closes the open dialog without resetting anything (web `onCancel`). A no-op while a reset is in flight. */
    fun dismiss() {
        if (mutableState.value.busy) return
        mutableState.value = ResetSectionUiState()
    }

    /**
     * Runs the pending dialog's reset (web `handleConfirmSection` / `handleConfirmAll`): the per-section
     * mutation for [ResetDialog.Section] or the global mutation for [ResetDialog.All]; a no-op when no dialog
     * is open.
     */
    fun confirm() {
        when (val dialog = mutableState.value.dialog) {
            is ResetDialog.Section -> runReset(ResetSectionDiagnostics.EVENT_RESET_SECTION) { source.resetSection(dialog.row.id.wire) }
            ResetDialog.All -> runReset(ResetSectionDiagnostics.EVENT_RESET_ALL) { source.resetAll() }
            ResetDialog.None -> Unit
        }
    }

    /**
     * The confirm-then-run core: marks the surface busy (dialog stays open + loading), logs the PII-safe
     * [event], runs [action], raises the success-receipt or failure toast, then closes the dialog. A no-op if
     * a reset is already in flight (guards a double confirm).
     */
    private fun runReset(
        event: String,
        action: suspend () -> Result<SettingsResetResult>,
    ) {
        if (mutableState.value.busy) return
        mutableState.value = mutableState.value.copy(busy = true)
        ResetSectionDiagnostics.recordReset(logger, event)
        launch {
            action().fold(
                onSuccess = { result ->
                    emitEvent(
                        UiEvent.Message(
                            messageKey = SUCCESS_DETAIL_KEY,
                            args = ResetSectionCatalog.successToastArgs(result),
                            severity = UiEvent.Severity.Success,
                        ),
                    )
                },
                onFailure = {
                    emitEvent(UiEvent.Message(messageKey = ERROR_KEY, severity = UiEvent.Severity.Error))
                },
            )
            mutableState.value = ResetSectionUiState()
        }
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a bound [source]. */
        fun factory(
            source: ResetSectionSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ResetSectionViewModel(source, logger) }
            }
    }
}
