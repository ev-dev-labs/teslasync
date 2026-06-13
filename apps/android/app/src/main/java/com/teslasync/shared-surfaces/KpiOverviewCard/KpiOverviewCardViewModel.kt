// UI-thread-free state holder backing the KpiOverviewCard shared surface — the native port of the props the web
// component reads from its parent (web/src/components/data-display/KpiOverviewCard.tsx). It binds the
// [KpiOverviewCardSource] seam (P1/S8), folds each emission into the immutable [KpiOverviewData] the render
// boundary projects, and exposes the PII-safe one-shot `view.opened` diagnostic. The view never performs HTTP —
// it only collects [state] and calls [onViewOpened].
//
// The card is presentational: its overview is caller-supplied and has no async cache-then-network lifecycle of
// its own, so there is nothing to load / error / stale / offline beyond what the streamed projection already
// expresses (the documented Avatar / VisuallyHidden rationale). The holder therefore stays a thin reducer over
// the seam (ADR-002) and owns no networking.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/KpiOverviewCard) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.kpioverviewcard

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
 * Lifecycle-aware state holder backing the Compose [KpiOverviewCardSurface] — the Android port of the web
 * card's prop binding.
 *
 * It subscribes to the injected [KpiOverviewCardSource] seam (the P1/S8 boundary) for its whole lifetime and
 * folds each emission into [state], so the render boundary can project the header, the KPI grid and the
 * secondary line. The overview is caller-supplied, so there is no further lifecycle to model (the same
 * documented rationale as the accepted Avatar sibling); the view stays a thin renderer. It owns no networking.
 *
 * [onViewOpened] emits the P1/S11 `view.opened` diagnostic exactly once per surface open.
 *
 * @param source the overview seam (a shared-S8-layer adapter in production, a fake in tests). The view-model
 *   owns no networking — it only reduces this port's emissions.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` event carrying
 *   only the non-PII surface slug.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class KpiOverviewCardViewModel(
    private val source: KpiOverviewCardSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(KpiOverviewData.EMPTY)
    private var viewOpenedRecorded = false

    /** The live overview projection the render boundary draws; the content-free zero value until the seam emits. */
    val state: StateFlow<KpiOverviewData> = mutableState.asStateFlow()

    init {
        // Bind the overview seam for the holder's lifetime so a period change or a new drive re-renders the grid.
        launch { source.overview().collect { overview -> mutableState.value = overview } }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no caller value, so a diagnostics line can never leak what an overview showed. Call from the
     * composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordKpiOverviewCardOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: KpiOverviewCardSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { KpiOverviewCardViewModel(source, logger) }
            }
    }
}
