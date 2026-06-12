// UI-thread-free state holder backing the IncidentForm feature view — the native port of the four-hook composition
// the web component owns (web/src/features/system/components/status/IncidentForm.tsx): `useCreateIncident`,
// `useToast`, `useId`, and the dialog's local field state. It binds the shared write seam ([IncidentFormSource],
// bound from the S8 IncidentsStore), runs the validate → create → toast → close orchestration, exposes the
// in-flight flag that disables the controls (web `create.isPending`), and emits the PII-safe `view.opened`
// diagnostic. The view never performs HTTP — it only collects state and calls [submit].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/feature-views/IncidentForm)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.incidentform

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.incidents.IncidentsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [IncidentForm]. It keeps the screen a stateless dialog that only
 * renders + gathers input: the form fields live in the composable (web `useState`), while this holder owns the parts
 * the web hooks owned — the submit orchestration, the in-flight flag, the one-shot toasts, and the close signal.
 *
 * It owns no networking. [submit] validates the title client-side (web `t.length < 3` → a validation toast, no
 * request), assembles the create payload, and delegates to the [source]; on success it raises the success toast and
 * the [closed] signal (web `toast.success(...)` + `onClose()`), on failure it raises a failure toast carrying the
 * server message (web `toast.error(err.message ...)`). A submit while one is already in flight is ignored, mirroring
 * the disabled web button. [onViewOpened] emits the one-shot `view.opened` diagnostic (P1/S11).
 *
 * @param source the incidents write seam (the S8 [IncidentsStore] binding in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + mutation events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class IncidentFormViewModel(
    private val source: IncidentFormSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val submittingState = MutableStateFlow(false)
    private val toastChannel = Channel<IncidentFormToast>(Channel.BUFFERED)
    private val closeChannel = Channel<Unit>(Channel.BUFFERED)
    private var viewOpenedRecorded = false

    /** Whether a create request is in flight — disables the controls + flips the submit label (web `isPending`). */
    val submitting: StateFlow<Boolean> = submittingState

    /** One-shot toasts the composable maps to localized surfaces (web `useToast`); never replayed. */
    val toasts: Flow<IncidentFormToast> = toastChannel.receiveAsFlow()

    /** One-shot close signal raised after a successful log (web `onClose()`); the host dismisses the dialog. */
    val closed: Flow<Unit> = closeChannel.receiveAsFlow()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. It
     * carries no field value, so a diagnostics line can never leak what the operator is drafting.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordIncidentFormOpened(logger)
    }

    /**
     * Validates + submits [draft] (web `handleSubmit`). A too-short title raises [IncidentFormToast.ValidationTitleTooShort]
     * and sends no request; otherwise the create runs and the result raises the success toast + [closed] signal or a
     * [IncidentFormToast.SubmitFailed]. A submit while one is in flight is ignored.
     */
    fun submit(draft: IncidentDraft) {
        if (submittingState.value) return
        if (!IncidentFormProjection.isTitleValid(draft.title)) {
            toastChannel.trySend(IncidentFormToast.ValidationTitleTooShort)
            return
        }
        val input = IncidentFormProjection.buildCreateInput(draft)
        launch {
            submittingState.update { true }
            source
                .createIncident(input)
                .onSuccess {
                    logger.info("incidentForm.created")
                    toastChannel.trySend(IncidentFormToast.Logged)
                    closeChannel.trySend(Unit)
                }.onFailure { error ->
                    logger.warn("incidentForm.createFailed")
                    toastChannel.trySend(IncidentFormToast.SubmitFailed(error.message))
                }
            submittingState.update { false }
        }
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: IncidentFormSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { IncidentFormViewModel(source, logger) }
            }

        /** Wire the surface from the shared **S8** [IncidentsStore] (web `useCreateIncident`). */
        fun create(
            store: IncidentsStore,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): IncidentFormViewModel = IncidentFormViewModel(bindIncidentFormSource(store), logger, scope)
    }
}
