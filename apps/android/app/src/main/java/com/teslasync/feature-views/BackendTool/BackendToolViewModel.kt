// UI-thread-free state holder backing the Compose [BackendTool] — the native port of the web component's
// `useMutation` (web/src/features/admin/components/devtools/BackendTool.tsx). It binds the injected
// [BackendToolPort] (the P1/S8 shared-layer seam) and exposes the mutation lifecycle as a single
// [BackendToolActionState] stream (idle → running → done), driving the Run button's spinner, the
// success/failed badge, and the result panel. The view performs no HTTP (ADR-002) — it only collects the
// state and calls [run]. Every diagnostic is PII-safe: the surface slug and a success/failure flag only,
// never the response payload or error text.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BackendTool) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.backendtool

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * State holder backing the Compose [BackendTool].
 *
 * It consumes the injected [BackendToolPort] (P1/S8) and re-shares the single mutation as a
 * [BackendToolActionState] stream (idle / running / done), exposing the [run] trigger (web
 * `mutation.mutate()`) plus the PII-safe `view.opened` diagnostic. It owns no networking: [run] delegates
 * to the non-throwing port, so a transport failure resolves to a `Done` state whose response carries the
 * error (the `apiFetch` catch contract), exactly as the web renders the failure branch.
 *
 * @param port the dev-tools mutation seam (shared transport ↔ fixed-response fake); never performs HTTP in the view.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class BackendToolViewModel(
    private val port: BackendToolPort,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow<BackendToolActionState>(BackendToolActionState.Idle)
    private var viewOpenedRecorded = false

    /** The live mutation state to render (idle → running → done). */
    val state: StateFlow<BackendToolActionState> = mutableState.asStateFlow()

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, surface slug only. */
    fun onAppear() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to BackendToolRegistration.SLUG))
    }

    /**
     * Runs the configured request once — the web `mutation.mutate()` (the Run button's `onClick`). A no-op
     * while a run is already in flight (the web Button is disabled by `loading`, and TanStack would not
     * start a second mutation), so a double tap never double-fires. On completion the (non-throwing) port
     * result advances the state to [BackendToolActionState.Done]; the diagnostic records only whether it
     * succeeded, never the payload.
     */
    fun run() {
        if (mutableState.value.isRunning) return
        logger.info(EVENT_RUN, mapOf(FIELD_SURFACE to BackendToolRegistration.SLUG))
        mutableState.value = BackendToolActionState.Running
        launch {
            val response = port.run()
            mutableState.value = BackendToolActionState.Done(response)
            val outcomeEvent = if (response.isError) EVENT_RUN_FAIL else EVENT_RUN_OK
            logger.info(outcomeEvent, mapOf(FIELD_SURFACE to BackendToolRegistration.SLUG))
        }
    }

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_RUN = "backendTool.run"
        private const val EVENT_RUN_OK = "backendTool.run.ok"
        private const val EVENT_RUN_FAIL = "backendTool.run.fail"
        private const val FIELD_SURFACE = "surface"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            port: BackendToolPort,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { BackendToolViewModel(port, logger) }
            }
    }
}
