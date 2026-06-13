// UI-thread-free state holder backing the HelpSegment surface — the native port of the web HelpSegment's three
// click handlers (web/src/components/layout/status-bar/HelpSegment.tsx). It binds the [HelpActions] seam
// (P1/S8) and performs no work of its own beyond routing each invocation through that seam and emitting
// PII-safe diagnostics; the view collects nothing and only calls [onViewOpened] / [invoke] (ADR-002).
//
// The web HelpSegment has no async cache-then-network feed — its only bound hook is `useTranslation` and it
// fetches nothing — so there is no loading / empty / error / stale / offline lifecycle to project (the same
// rationale the accepted SkipToContent / CopyLinkButton ports document). The surface's real behaviour is the
// invocation: dispatch the chosen affordance's intent through the decoupled seam and record the coarse
// [HelpDispatchOutcome].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/HelpSegment) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.helpsegment

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope

/**
 * State holder backing the Compose [HelpSegment] surface — the Android port of the web HelpSegment's three
 * decoupled click handlers.
 *
 * It binds the injected [HelpActions] seam (the P1/S8 boundary) and exposes the two things the view drives:
 * [onViewOpened] emits the P1/S11 `view.opened` diagnostic exactly once per surface open, and [invoke]
 * dispatches a help affordance's intent through the seam (web `dispatchEvent` / `dispatchTourLauncherOpen`) and
 * records the coarse [HelpDispatchOutcome] — handled (a listener was mounted) or a no-listener no-op.
 * Diagnostics never carry a label, tooltip, or any content. The view stays a thin renderer.
 *
 * @param actions the decoupled help-action seam (the process registry in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class HelpSegmentViewModel(
    private val actions: HelpActions,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only — at most once per
     * holder. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        HelpSegmentDiagnostics.recordViewOpened(logger)
    }

    /**
     * Invokes a help affordance — the native port of the web click handlers. Dispatches [action]'s intent
     * through the [HelpActions] seam and records the resulting [HelpDispatchOutcome] (slug + coarse action +
     * outcome only, never a label or any content). A no-op when no listener is mounted, exactly as the web
     * `dispatchEvent` does nothing when no listener is registered.
     */
    fun invoke(action: HelpAction) {
        val handled = actions.open(action)
        HelpSegmentDiagnostics.recordInvoke(logger, action, helpDispatchOutcome(handled))
    }

    companion object {
        /** Wires the surface from the process-wide help-action registry (web's shared `window` event bus). */
        fun create(
            actions: HelpActions,
            logger: Logger,
        ): HelpSegmentViewModel = HelpSegmentViewModel(actions, logger)

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            actions: HelpActions,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { HelpSegmentViewModel(actions, logger) }
            }
    }
}
