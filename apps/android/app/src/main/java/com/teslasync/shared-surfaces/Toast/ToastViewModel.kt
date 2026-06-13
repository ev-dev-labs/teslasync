// UI-thread-free state holder backing the Toast surface — the native port of the state the web
// `ToastProvider` owns (web/src/components/feedback/Toast.tsx, where the provider owns the `toasts`
// array and schedules each toast's `setTimeout(() => dismiss(id), duration)`). It observes the shared
// [ToastController] queue (no HTTP touches the view, ADR-002), folds it through the pure
// [projectToastHost], runs the per-toast auto-dismiss timer, routes dismiss + action invocation back
// to the controller, and emits the one PII-safe `view.opened` diagnostic (P1/S11). The view never
// performs HTTP or timing — it only collects [state] and forwards the actions.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Toast) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.toast

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * State holder for the toast host.
 *
 * The visible queue is folded from the shared [ToastController] through the pure [projectToastHost],
 * so the surface renders the real populated-vs-empty lifecycle the web source has. On top of it the
 * holder runs the per-toast auto-dismiss clock — each newly-seen toast with a positive duration
 * schedules a [ToastMessage.durationMillis] timer that removes it from the controller queue (the web
 * per-toast `setTimeout(() => dismiss(id), duration)`), and a toast that leaves the queue (manual
 * dismiss, or being replaced) cancels its timer. [dismiss] removes a toast immediately,
 * [invokeAction] runs its navigate/callback affordance then dismisses it (web `handleAction`), and
 * [recordViewOpened] emits the single PII-safe `view.opened` diagnostic.
 *
 * @param controller the shared toast queue holder (the app-scoped `ToastProvider` analogue; a fake in
 *   tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` event.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class ToastViewModel(
    private val controller: ToastController,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(ToastHostState.Empty)

    /** The live host state the view collects; `.value` is always the latest folded queue. */
    val state: StateFlow<ToastHostState> = mutableState.asStateFlow()

    private val dismissJobs = mutableMapOf<String, Job>()
    private var viewOpenedRecorded = false

    init {
        stateScope.launch {
            controller.toasts.collect { queue ->
                val folded = projectToastHost(queue)
                mutableState.value = folded
                reconcileAutoDismiss(folded.toasts)
            }
        }
    }

    /**
     * Removes the toast for [id] now (web manual `dismiss`) — cancels its pending auto-dismiss timer
     * and removes it from the shared controller queue.
     */
    fun dismiss(id: String) {
        dismissJobs.remove(id)?.cancel()
        controller.dismiss(id)
    }

    /**
     * Fires a toast's action then dismisses it — the web `handleAction`: a [ToastAction.Navigate]
     * routes its target via [onNavigate] (the `useNavigate` seam) then dismisses (web `<Link onClick>`
     * dismiss); a [ToastAction.Callback] runs its handler then dismisses (web `<button onClick>`). A
     * toast with no action is a no-op.
     */
    fun invokeAction(
        message: ToastMessage,
        onNavigate: (String) -> Unit,
    ) {
        when (val action = message.action) {
            is ToastAction.Navigate -> {
                onNavigate(action.route)
                dismiss(message.id)
            }
            is ToastAction.Callback -> {
                action.onInvoke()
                dismiss(message.id)
            }
            null -> Unit
        }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once
     * per holder. Carries no toast title / message / action target, so a diagnostics line can never
     * leak the content of a confirmation. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordToastHostOpened(logger)
    }

    /**
     * Schedules a [ToastMessage.durationMillis] auto-dismiss for every newly-seen auto-dismissing
     * toast and cancels the timer for any toast no longer in the queue — the native port of the web
     * per-toast `setTimeout` (enqueue → schedule, removal → `clearTimeout`). Idempotent per id, so a
     * re-projection of the same queue never double-schedules. Pinned toasts (duration ≤ 0) get no
     * timer.
     */
    private fun reconcileAutoDismiss(toasts: List<ToastMessage>) {
        val present = toasts.mapTo(mutableSetOf()) { it.id }
        dismissJobs.keys
            .filterNot { it in present }
            .forEach { dismissJobs.remove(it)?.cancel() }
        toasts
            .filter { it.autoDismisses && it.id !in dismissJobs }
            .forEach { message ->
                dismissJobs[message.id] =
                    stateScope.launch {
                        delay(message.durationMillis)
                        dismissJobs.remove(message.id)
                        controller.dismiss(message.id)
                    }
            }
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            controller: ToastController,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ToastViewModel(controller, logger) }
            }
    }
}
