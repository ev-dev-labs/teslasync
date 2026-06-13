// UI-thread-free state holder backing the TOUSettingsModal surface — the native port of the hook composition the web
// component owns (web/src/features/battery/components/TOUSettingsModal.tsx): `useUpdateTOUSettings`,
// `useRefreshTeslaEnergySiteInfo`, and the dialog's submit orchestration. It binds the shared write seam
// ([TOUSettingsModalSource], bound from the S8 EnergyStore), runs the submit -> refresh -> close flow the web
// `handleSubmit` owns, exposes the in-flight flag that disables the controls + drives the submit spinner (web
// `updateMutation.isPending`), exposes the verbatim server submit error (web `setError(String(err))`), and emits the
// PII-safe `view.opened` diagnostic. The view never performs HTTP — it only owns the form fields and calls [submit]
// with an already-validated payload.
//
// The client-side validation (no-preset / empty-JSON / not-an-object / invalid-JSON) is the pure
// [TOUSettingsModalProjection.buildPayload] and runs in the composable BEFORE [submit] is called, exactly as the web
// `getPayload()` runs inside `handleSubmit` before `updateMutation.mutate`. So [submit] only ever receives a valid
// `tou_settings` envelope and is concerned solely with the network round-trip + close/error orchestration.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/modals-dialogs) cannot form
// a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.tousettingsmodal

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.energy.EnergyStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonObject

/**
 * Lifecycle-aware state holder backing the Compose [TOUSettingsModal]. It keeps the screen a stateless dialog that only
 * renders + gathers input: the tab / chosen preset / custom-JSON fields live in the composable (web `useState`), while
 * this holder owns the parts the web hooks owned — the submit orchestration, the in-flight flag, the inline submit
 * error, and the close signal.
 *
 * It owns no networking. [submit] takes the already-validated `tou_settings` envelope (the composable runs
 * [TOUSettingsModalProjection.buildPayload] first, mirroring the web `getPayload()` guard inside `handleSubmit`),
 * delegates the save to the [source], and on success fires the Tesla site-info refresh as fire-and-forget (web
 * `refreshSiteInfo.mutate(siteId)`) and raises the [closed] signal (web `onClose()`); on failure it surfaces the
 * verbatim server message (web `setError(String(err))`) and stays open. A submit while one is already in flight is
 * ignored, mirroring the disabled web button. [onViewOpened] emits the one-shot `view.opened` diagnostic (P1/S11);
 * [resetSubmitError] clears a stale error when the dialog re-opens (web `handleClose` resets `error`).
 *
 * @param source the TOU write seam (the S8 [EnergyStore] binding in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + mutation events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class TOUSettingsModalViewModel(
    private val source: TOUSettingsModalSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val submittingState = MutableStateFlow(false)
    private val submitErrorState = MutableStateFlow<String?>(null)
    private val closeChannel = Channel<Unit>(Channel.BUFFERED)
    private var viewOpenedRecorded = false

    /** Whether a save is in flight — disables the controls + drives the submit spinner (web `updateMutation.isPending`). */
    val submitting: StateFlow<Boolean> = submittingState.asStateFlow()

    /** The verbatim server error from the last failed save, or `null` (web `error` set from `setError(String(err))`). */
    val submitError: StateFlow<String?> = submitErrorState.asStateFlow()

    /** One-shot close signal raised after a successful save (web `onClose()`); the host dismisses the dialog. */
    val closed: Flow<Unit> = closeChannel.receiveAsFlow()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. It
     * carries no site id or tariff body, so a diagnostics line can never leak the operator's pricing config.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordTOUSettingsModalOpened(logger)
    }

    /** Clears a stale inline submit error when the dialog re-opens (web `handleClose` resets `error` to `''`). */
    fun resetSubmitError() {
        submitErrorState.update { null }
    }

    /**
     * Saves the already-validated [payload] for [siteId] (web `handleSubmit` after `getPayload`). On success it fires
     * the Tesla site-info refresh as fire-and-forget — its failure must never block the close (web non-awaited
     * `refreshSiteInfo.mutate`) — and raises the [closed] signal; on failure it surfaces the verbatim server message
     * and leaves the dialog open. A submit while one is in flight is ignored.
     */
    fun submit(
        siteId: Long,
        payload: JsonObject,
    ) {
        if (submittingState.value) return
        launch {
            submittingState.update { true }
            submitErrorState.update { null }
            source
                .updateTouSettings(siteId, payload)
                .onSuccess {
                    logger.info("touSettingsModal.updated")
                    fireRefresh(siteId)
                    closeChannel.trySend(Unit)
                }.onFailure { error ->
                    logger.warn("touSettingsModal.updateFailed")
                    submitErrorState.update { failureMessage(error) }
                }
            submittingState.update { false }
        }
    }

    /**
     * Fires the Tesla site-info refresh on its own ViewModel-scoped coroutine — the web non-awaited
     * `refreshSiteInfo.mutate(siteId)`. A sibling of the submit coroutine (not a child) so a slow or failing refresh
     * can never delay or block the dialog's close; its [Result] is intentionally ignored.
     */
    private fun fireRefresh(siteId: Long) {
        launch { source.refreshSiteInfo(siteId) }
    }

    /** The displayed server error — web `String(err instanceof Error ? err.message : err)`: the message, else the type. */
    private fun failureMessage(error: Throwable): String = error.message?.takeIf { it.isNotBlank() } ?: error.toString()

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: TOUSettingsModalSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { TOUSettingsModalViewModel(source, logger) }
            }

        /** Wire the surface from the shared **S8** [EnergyStore] (web `useUpdateTOUSettings` + `useRefreshTeslaEnergySiteInfo`). */
        fun create(
            store: EnergyStore,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): TOUSettingsModalViewModel = TOUSettingsModalViewModel(bindTOUSettingsModalSource(store), logger, scope)
    }
}
