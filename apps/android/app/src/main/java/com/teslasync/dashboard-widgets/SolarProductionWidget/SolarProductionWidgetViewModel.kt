// UI-thread-free state holder backing the Solar Production widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/SolarProductionWidget.tsx). It binds
// the shared data feeds (P1/S8) through [SolarProductionSource] — resolving the first linked site from
// the `useTeslaEnergySites` list (web `(sites ?? [])[0]?.energy_site_id`) and projecting the
// `useTeslaEnergyHistory` cache-then-network body onto the shared [UiState] surface (loading / content /
// empty / stale / offline / error). It exposes the single refresh action plus the PII-safe
// `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and calls
// [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SolarProductionWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.solarproduction

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.energy.EnergyStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update
import java.time.ZoneId

/**
 * @param source the cache-then-network seam (a shared-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only resolves the first site and projects the feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param nowMillis the clock used to derive the 30-day `since` window start + today's date key. Computed
 *   once at construction so the feed's cache key is stable across re-collections, like the web
 *   `useMemo([])` window.
 * @param zone the time zone used to label history rows (web `shortDate` reads the local `new Date`).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SolarProductionWidgetViewModel(
    private val source: SolarProductionSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    nowMillis: Long = System.currentTimeMillis(),
    private val zone: ZoneId = ZoneId.systemDefault(),
) : BaseFeedViewModel(logger, scope) {
    // The 30-day window start (web `since` memo) + today's date key (web `todayKey`), pinned at
    // construction so the cache key + today-match stay stable across re-collections.
    private val since = SolarProductionRegistration.windowStartDate(nowMillis)
    private val todayKey = SolarProductionRegistration.todayKey(nowMillis)

    // Bumping the trigger re-collects the cache-then-network feeds (the manual refetch affordance).
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The combined site + history payload as cache-then-network UI state (loading / content / empty /
     * stale / offline / error), carrying the freshness stamp + error kind. Empty mirrors the web
     * `!hasSites` gate — no linked Tesla Energy site resolves to the "No Tesla Energy site linked" empty
     * surface, while a linked site with no solar rows stays content and the chart shows its own "No solar
     * data" empty state.
     */
    val state: StateFlow<UiState<SolarProductionSnapshot>> =
        refreshTrigger
            .flatMapLatest { historyFeed() }
            .asUiState(isEmpty = { !it.hasSites })

    /** Re-runs the cache-then-network load (the web `refetchSites()` + `refetchHistory()` affordance + retry). */
    fun refresh() {
        logger.info(EVENT_REFRESH)
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no solar figure, site id or location, so a diagnostics line can never leak the
     * owner's energy system. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SolarProductionRegistration.SLUG))
    }

    private fun historyFeed(): Flow<Resource<SolarProductionSnapshot>> =
        solarProductionResource(
            sites = source.energySites(),
            history = { siteId -> source.energyHistory(siteId, SolarProductionRegistration.PERIOD_DAY, since) },
            todayKey = todayKey,
            zone = zone,
        )

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val FIELD_SURFACE = "surface"
        private const val EVENT_REFRESH = "solarProduction.refresh"

        /**
         * Wire the surface from the shared **S8** [EnergyStore] (P1/S8) — the cross-platform port of the
         * web `useEnergy` domain. The holder runs on `viewModelScope`; a custom scope is a test-only
         * concern handled via the constructor.
         */
        fun create(
            energy: EnergyStore,
            logger: Logger,
        ): SolarProductionWidgetViewModel = SolarProductionWidgetViewModel(solarProductionSource(energy), logger)
    }
}
