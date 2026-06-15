// State holder backing the PresetGallery page surface (P1/S8) — the native counterpart of the data the web
// component binds (web/src/features/automations/pages/PresetGallery.tsx → `useAutomationPresets(category)`).
// The web page's one data dependency is the preset gallery (`GET /automations/presets[?category=]`); this
// page-layer holder projects that shared cache-then-network feed (the shared S8 [AutomationsStore]
// .automationPresets via [PresetGallerySource]) onto the lifecycle-aware [UiState] surface the stateless
// screen renders, so the same loading / empty / success chrome the shared feature view implements is reachable
// from a single [StateFlow]. It performs NO HTTP and owns no business logic — the preset fetch lives entirely
// in the shared data layer, and this binding is the standard [BaseFeedViewModel.asUiState] page-VM job.
//
// The empty branch mirrors the web `presetList.length === 0`: an empty preset list is the surface's empty
// state (NOT valid content), so [asUiState] is told the payload is "empty" when the list is empty. A failed
// refresh over a cached list keeps the best-effort cached gallery visible with an offline/error chip + retry
// (refresh), exactly as the sibling surfaces degrade gracefully.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations)
// diverges from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling page
// surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.automations

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.presetgallery.AutomationPresetData
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.automations.AutomationsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder for the PresetGallery page surface. It consumes the cache-then-network preset
 * [source] (P1/S8) and re-shares it as a single [UiState] stream via [BaseFeedViewModel.asUiState], so the
 * screen stays a stateless Composable that only renders. The install navigation itself is caller-owned (web
 * `useNavigate` → `/automations/new?preset=…`), exactly like the web component, so it is NOT held here.
 *
 * The states are honest cache-then-network projections: a first frame of [UiState.loading] until the feed
 * emits (the web four-skeleton grid), then content (the card grid) or empty (web `presetList.length === 0`),
 * with the offline/error chip + retry surfacing when a refresh fails over cached data. It owns no networking.
 * [refresh] re-collects the feed (the web `useAutomationPresets` refetch / error-state retry) and
 * [recordViewOpened] emits the one-shot `view.opened` diagnostic with [PresetGalleryPageRegistration.SLUG]
 * (P1/S11).
 *
 * @param source the cache-then-network preset seam (an [AutomationsStore] adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + refresh events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PresetGalleryPageViewModel(
    source: PresetGallerySource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refresh/retry affordance).
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The preset gallery as cache-then-network UI state: loading / content / empty / stale / offline / error,
     * carrying the freshness stamp + error kind. An empty list is the surface's empty state (web
     * `presetList.length === 0`), so the payload is treated as empty when the list is empty.
     */
    val state: StateFlow<UiState<List<AutomationPresetData>>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .asUiState(isEmpty = { it.isEmpty() })

    /** Re-runs the cache-then-network preset load (the web `useAutomationPresets` refetch / error-state retry). */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to PresetGalleryPageRegistration.SLUG))
        refreshTrigger.update { it + 1 }
    }

    /** Emits the one-shot PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordPresetGalleryPageOpened(logger)
    }

    companion object {
        private const val EVENT_REFRESH = "presetGallery.refresh"
        private const val FIELD_SURFACE = "surface"

        /** A [ViewModelProvider.Factory] the page composable uses to construct this surface's ViewModel. */
        fun factory(
            source: PresetGallerySource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { PresetGalleryPageViewModel(source, logger) }
            }

        /**
         * Wire the surface from the shared [AutomationsStore] (P1/S8) — the web `useAutomationPresets(category)`
         * seam. The [category] filter is baked into the bound feed, so the page composable need not carry it.
         */
        fun create(
            store: AutomationsStore,
            logger: Logger,
            category: String? = null,
            scope: CoroutineScope? = null,
        ): PresetGalleryPageViewModel =
            PresetGalleryPageViewModel(
                source = presetGallerySource(store, category),
                logger = logger,
                scope = scope,
            )
    }
}
