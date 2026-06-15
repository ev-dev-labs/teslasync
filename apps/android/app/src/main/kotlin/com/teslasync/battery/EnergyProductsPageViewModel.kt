// The state holder backing the EnergyProductsPage battery surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/battery/pages/EnergyProductsPage.tsx). It projects the
// `/tesla/energy-sites` catalog read onto the shared lifecycle-aware [UiState] surface, derives the four header summary
// counts, lazily projects each linked site's `…/site-info` detail onto its own [UiState] (the web nested
// `SiteInfoSection` per card), and owns the two refresh mutations. All decode/derivation logic lives in the
// framework-free model (EnergyProductsPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// The catalog feed is NOT vehicle-scoped (web `useTeslaEnergySites()` takes no vehicle id) — energy sites are
// account-wide — so unlike the per-vehicle battery/analytics surfaces there is no selected-vehicle leg. An empty /
// absent catalog resolves to UiPhase.Empty via the list-emptiness gate so the page shows its `energy.products.empty`
// state (the web `sites.length > 0 ? … : <EmptyState />` guard). Each per-site detail feed is its own lifecycle-aware
// [UiState] so every card renders its own loading / content / empty surface without ever hiding a section (web
// per-`SiteInfoSection` truthiness guards), and a JSON-null / dataless detail resolves to Empty (web `info ? … :`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.energyproducts

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * @param source the P1/S8 data seam (the shared Energy + Settings holders in production ↔ a test fake); the view never
 *   performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the two refresh events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class EnergyProductsPageViewModel(
    private val source: EnergyProductsPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /** Memoized per-site detail feeds so a card re-collecting on recomposition rebinds to the same shared flow. */
    private val siteInfoFeeds = mutableMapOf<Long, StateFlow<UiState<EnergySiteInfo?>>>()

    /**
     * The primary `GET /tesla/energy-sites` catalog feed as cache-then-network UI state (web `useTeslaEnergySites`). An
     * empty / non-array payload resolves to the empty surface (web `sites.length > 0 ? … : <EmptyState />`); a hard
     * failure with nothing cached resolves to the retryable error surface (web `PageContainer error`).
     */
    val sites: StateFlow<UiState<List<EnergySite>>> =
        source
            .energySites()
            .map { it.mapData(::parseEnergySites) }
            .asUiState(isEmpty = { it.isEmpty() })

    /** The four header summary counts, re-derived as the catalog changes (web `sites.filter(...).length`). */
    val summary: StateFlow<EnergyProductsSummary> =
        sites
            .map { EnergyProductsSummary.from(it.data.orEmpty()) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = EnergyProductsSummary.EMPTY,
            )

    /** The live display preferences (the locale used for grouped-number + date formatting), re-derived as settings change. */
    val displayPrefs: StateFlow<EnergyDisplayPrefs> =
        source
            .settings()
            .map { resource -> EnergyDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = EnergyDisplayPrefs.DEFAULT,
            )

    /**
     * The cache-then-network detail feed for [siteId] as UI state (web nested `SiteInfoSection` `useTeslaEnergySiteInfo`).
     * Memoized per site so each card binds to one shared, lifecycle-aware flow; a JSON-null / dataless detail resolves
     * to the empty surface (web `info ? … : <EmptyState siteInfo.empty />`).
     */
    fun siteInfo(siteId: Long): StateFlow<UiState<EnergySiteInfo?>> =
        siteInfoFeeds.getOrPut(siteId) {
            source
                .energySiteInfo(siteId)
                .map { it.mapData(::parseSiteInfo) }
                .asUiState(isEmpty = { it == null })
        }

    /**
     * Re-runs the catalog load via `POST /tesla/energy-sites/refresh` (web `useRefreshTeslaEnergySites`). The store
     * re-fetches the catalog family on success, so the refreshed sites flow back through [sites].
     */
    fun refreshSites() {
        logger.info("energyProducts.refresh")
        launch { source.refreshEnergySites() }
    }

    /**
     * Re-runs one site's detail load via `POST /tesla/energy-sites/{siteId}/site-info/refresh` (web nested
     * `useRefreshTeslaEnergySiteInfo`). The store re-fetches that site's detail family, so the refreshed detail flows
     * back through [siteInfo].
     */
    fun refreshSiteInfo(siteId: Long) {
        logger.info("energyProducts.siteInfo.refresh")
        launch { source.refreshEnergySiteInfo(siteId) }
    }

    /**
     * Records the intent to edit one site's time-of-use rate plan (web `setTouModalOpen(true)`). The full rate-plan
     * editor is the separate `TOUSettingsModal` parity surface; this page only owns the entry affordance, so the action
     * emits a PII-safe diagnostic and the modal surface is launched by its own host. Carries no tariff payload.
     */
    fun manageTouPlan(siteId: Long) {
        logger.info("energyProducts.tou.manage")
    }

    /** Retry affordance for the hard-error catalog surface — re-runs the catalog refresh. */
    fun retry(): Unit = refreshSites()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no site id / capacity / location payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordEnergyProductsOpened(logger)
    }
}
