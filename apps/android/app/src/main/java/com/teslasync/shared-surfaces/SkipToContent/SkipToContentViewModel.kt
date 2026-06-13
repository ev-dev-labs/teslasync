// UI-thread-free state holder backing the SkipToContent surface — the native port of the web SkipToContent's
// `onClick` handler (web/src/components/feedback/SkipToContent.tsx). It binds the [SkipTarget] seam (P1/S8) and
// performs no work of its own beyond routing activation through that seam and emitting PII-safe diagnostics;
// the view collects nothing and only calls [onViewOpened] / [skipToContent] (ADR-002).
//
// The web SkipToContent has no async cache-then-network feed — its only bound hook is `useTranslation` and it
// fetches nothing — so there is no loading / empty / error / stale / offline lifecycle to project (the same
// rationale the accepted RouteAnnouncer / VisuallyHidden a11y ports document). The surface's real behaviour is
// the activation: invoke the registered main-content landmark and record the coarse [SkipOutcome].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/SkipToContent) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.skiptocontent

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope

/**
 * State holder backing the Compose [SkipToContent] surface — the Android port of the web SkipToContent's
 * activation handler over its `#main-content` landmark.
 *
 * It binds the injected [SkipTarget] seam (the P1/S8 boundary) and exposes the two things the view drives:
 * [onViewOpened] emits the P1/S11 `view.opened` diagnostic exactly once per surface open, and [skipToContent]
 * moves focus to the main-content landmark through the seam (web `main.focus()` + `scrollIntoView()`) and
 * records the coarse [SkipOutcome] — present-and-moved (web `if (main)`) or no-landmark no-op. Diagnostics
 * never carry the label, a route, or any page content. The view stays a thin renderer.
 *
 * @param target the main-content landmark seam (the process registry in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class SkipToContentViewModel(
    private val target: SkipTarget,
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
        SkipToContentDiagnostics.recordViewOpened(logger)
    }

    /**
     * Activates the skip link — the native port of the web `onClick`. Moves focus to the registered
     * main-content landmark through the [SkipTarget] seam and records the resulting [SkipOutcome] (slug +
     * coarse outcome only, never the label or any page content). A no-op when no landmark is registered, exactly
     * as the web handler does nothing when `getElementById` returns `null`.
     */
    fun skipToContent() {
        val moved = target.focusMainContent()
        SkipToContentDiagnostics.recordSkip(logger, skipOutcome(moved))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            target: SkipTarget,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { SkipToContentViewModel(target, logger) }
            }
    }
}
