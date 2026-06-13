// UI-thread-free state holder backing the FeedbackModal surface — the native port of the hook composition the web
// component owns (web/src/components/feedback/FeedbackModal.tsx): `useSubmitFeedback`, `useLocation`, the auto-context
// collection, and the dialog's local field state. It binds the shared write seam ([FeedbackModalSource], bound from
// the S8 FeedbackStore), runs the validate -> submit -> close orchestration, exposes the in-flight flag that disables
// the controls + flips the submit label (web `submit.isPending`), exposes the inline submit-error flag (web
// `submit.isError`), and emits the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects
// state and calls [submit].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/modals-dialogs) cannot form
// a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.feedbackmodal

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.feedback.FeedbackStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [FeedbackModal]. It keeps the screen a stateless dialog that only
 * renders + gathers input: the form fields live in the composable (web `useState`), while this holder owns the parts
 * the web hooks owned — the submit orchestration, the in-flight flag, the inline submit-error flag, and the close
 * signal.
 *
 * It owns no networking. [submit] validates the draft client-side (web `validation.success`; an invalid draft sends no
 * request, mirroring the disabled submit button), assembles the create payload from the draft + the auto-collected
 * [FeedbackContext], and delegates to the [source]; on success it raises the [closed] signal (web `onClose()`), on
 * failure it raises the inline [submitError] flag (web `submit.isError`, rendered as the form's `role="alert"`). A
 * submit while one is already in flight is ignored, mirroring the disabled web button. [onViewOpened] emits the
 * one-shot `view.opened` diagnostic (P1/S11); [resetSubmitError] clears the stale inline error when the dialog
 * re-opens (web `submit.reset()` on close).
 *
 * @param source the feedback write seam (the S8 [FeedbackStore] binding in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + mutation events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class FeedbackModalViewModel(
    private val source: FeedbackModalSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val submittingState = MutableStateFlow(false)
    private val submitErrorState = MutableStateFlow(false)
    private val closeChannel = Channel<Unit>(Channel.BUFFERED)
    private var viewOpenedRecorded = false

    /** Whether a submit is in flight — disables the controls + flips the submit label (web `submit.isPending`). */
    val submitting: StateFlow<Boolean> = submittingState.asStateFlow()

    /** Whether the last submit failed — drives the inline `role="alert"` error (web `submit.isError`). */
    val submitError: StateFlow<Boolean> = submitErrorState.asStateFlow()

    /** One-shot close signal raised after a successful submit (web `onClose()`); the host dismisses the dialog. */
    val closed: Flow<Unit> = closeChannel.receiveAsFlow()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. It
     * carries no field value, so a diagnostics line can never leak what the operator is drafting.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordFeedbackModalOpened(logger)
    }

    /** Clears a stale inline submit error when the dialog re-opens (web `submit.reset()` on the open->closed edge). */
    fun resetSubmitError() {
        submitErrorState.update { false }
    }

    /**
     * Validates + submits [draft] with the auto-collected [context] (web `onSubmit`). An invalid draft sends no
     * request (web disabled submit + `if (!validation.success) return`); otherwise the submit runs and the result
     * raises the [closed] signal or the inline [submitError] flag. A submit while one is in flight is ignored.
     */
    fun submit(
        draft: FeedbackDraft,
        context: FeedbackContext,
    ) {
        if (submittingState.value) return
        if (!FeedbackModalProjection.isValid(draft)) return
        val input = FeedbackModalProjection.buildSubmitInput(draft, context)
        launch {
            submittingState.update { true }
            submitErrorState.update { false }
            source
                .submitFeedback(input)
                .onSuccess {
                    logger.info("feedbackModal.submitted")
                    closeChannel.trySend(Unit)
                }.onFailure {
                    logger.warn("feedbackModal.submitFailed")
                    submitErrorState.update { true }
                }
            submittingState.update { false }
        }
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: FeedbackModalSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { FeedbackModalViewModel(source, logger) }
            }

        /** Wire the surface from the shared **S8** [FeedbackStore] (web `useSubmitFeedback`). */
        fun create(
            store: FeedbackStore,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): FeedbackModalViewModel = FeedbackModalViewModel(bindFeedbackModalSource(store), logger, scope)
    }
}
