// UI-thread-free state holder backing the DiagnosticPage system surface (P1/S8) — the native port of the web page's
// `useRunDiagnostic` mutation + `latestError`/`isPending`/`data` composition
// (web/src/features/system/pages/DiagnosticPage.tsx). It owns the run phase as an immutable [DiagnosticUiState]
// (idle → running → loaded → failed), exposes the single run action + the PII-safe `view.opened` diagnostic, and
// performs NO HTTP (it delegates to the injected [DiagnosticPageSource], the shared SystemDiagnosticStore seam). The
// screen never mutates state directly — it only collects [uiState] and calls [run] / [recordViewOpened].
//
// The phase lives here (not in remembered composable state) so a resolved report + the running flag survive
// recomposition + configuration changes — the native analogue of the web TanStack mutation cache surviving a
// Strict-Mode unmount/remount, hoisted into the lifecycle-scoped holder per ADR-002. The page intentionally does NOT
// auto-run on first composition (the endpoint is expensive + rate-limited), so the initial phase is [Idle].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.diagnostic

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real shared SystemDiagnosticStore ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` carrying only the surface
 *   slug (never report contents).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class DiagnosticPageViewModel(
    private val source: DiagnosticPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow<DiagnosticUiState>(DiagnosticUiState.Idle)
    private var viewOpenedRecorded = false

    /**
     * The live run phase: [DiagnosticUiState.Idle] (no run yet → no-report empty state) → [DiagnosticUiState.Running]
     * (probe set in flight → spinner) → [DiagnosticUiState.Loaded] (report resolved → hero + check cards) /
     * [DiagnosticUiState.Failed] (run rejected → error banner + no-report empty state). The render boundary draws a
     * non-blank region for every phase.
     */
    val uiState: StateFlow<DiagnosticUiState> = mutableState.asStateFlow()

    /**
     * Runs the aggregated self-test (web `handleRun` → `runDiagnostic.mutate`). Clears any prior error, flips to
     * [DiagnosticUiState.Running], then resolves to [DiagnosticUiState.Loaded] on success or [DiagnosticUiState.Failed]
     * on a transport/HTTP error (web `onError` → `latestError`; the prior report is dropped, exactly as the mutation
     * resets `data`). A run already in flight is ignored so a double-tap cannot fan out two probe sets.
     */
    fun run() {
        if (mutableState.value.isRunning) return
        logger.info(EVENT_RUN)
        mutableState.value = DiagnosticUiState.Running
        launch {
            val phase =
                source.runDiagnostic().fold(
                    onSuccess = { DiagnosticUiState.Loaded(it) },
                    onFailure = { DiagnosticUiState.Failed(it.message) },
                )
            mutableState.update { phase }
        }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no report data, so a diagnostics line can never leak a probe detail. Call from the composable's first-composition
     * effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordDiagnosticPageOpened(logger)
    }

    companion object {
        private const val EVENT_RUN = "diagnostic.run"

        /** A [ViewModelProvider.Factory] the host uses to construct this surface's ViewModel over the [source]. */
        fun factory(
            source: DiagnosticPageSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { DiagnosticPageViewModel(source, logger) }
            }
    }
}
