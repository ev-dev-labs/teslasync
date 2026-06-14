// UI-thread-free state holder backing the HelpTooltip surface — the native port of the web HelpTooltip's only
// imperative behaviour, the "Learn more" link open (web/src/components/ui/HelpTooltip.tsx). It binds the
// [LinkOpener] seam (P1/S8) and performs no work of its own beyond routing the link open through that seam and
// emitting PII-safe diagnostics; the view collects nothing and only calls [onViewOpened] / [onLearnMore]
// (ADR-002).
//
// The web HelpTooltip has no async cache-then-network feed — its only bound hook is `useTranslation` and it
// fetches nothing — so there is no loading / empty / error / stale / offline lifecycle to project (the same
// rationale the accepted HelpSegment / CopyLinkButton ports document). The surface's real imperative behaviour
// is the link open: hand the chosen URL to the decoupled seam and record the coarse [LinkOutcome].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/HelpTooltip) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.helptooltip

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope

/**
 * State holder backing the Compose [HelpTooltip] surface — the Android port of the web HelpTooltip's
 * "Learn more" click handler over the decoupled new-tab navigation.
 *
 * It binds the injected [LinkOpener] seam (the P1/S8 boundary) and exposes the two things the view drives:
 * [onViewOpened] emits the P1/S11 `view.opened` diagnostic exactly once per surface open, and [onLearnMore]
 * opens the supplied URL through the seam (web `<a target="_blank">`) and records the coarse [LinkOutcome] —
 * opened (the platform launched it) or failed. Diagnostics never carry the URL or any help copy. The view
 * stays a thin renderer.
 *
 * @param opener the decoupled link-open seam (the system browser in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class HelpTooltipViewModel(
    private val opener: LinkOpener,
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
        HelpTooltipDiagnostics.recordViewOpened(logger)
    }

    /**
     * Opens the "Learn more" [url] — the native port of the web new-tab link. Hands [url] to the [LinkOpener]
     * seam and records the resulting [LinkOutcome] (slug + coarse outcome only, never the URL or any content).
     * A no-op-but-recorded failure when the platform has no handler, exactly as a blocked web popup does
     * nothing visible.
     */
    fun onLearnMore(url: String) {
        val opened = opener.open(url)
        HelpTooltipDiagnostics.recordLearnMore(logger, linkOutcomeFor(opened))
    }

    companion object {
        /** A [ViewModelProvider.Factory] the composable binds this surface's holder through. */
        fun factory(
            opener: LinkOpener,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { HelpTooltipViewModel(opener, logger) }
            }
    }
}
