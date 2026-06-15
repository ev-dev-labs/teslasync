// The state holder backing the LifetimeStatsPage analytics surface (P1/S8) — the native counterpart of the web
// page's React state + TanStack-Query hooks (web/src/features/analytics/pages/LifetimeStatsPage.tsx). It projects
// the `useLifetimeStats` cache-then-network read onto the shared lifecycle-aware [UiState] surface, scoped to the
// global active vehicle (web `useSelectedVehicle`), and derives the display preferences (distance/speed unit +
// currency) from the live `/settings` document (web `useUnits`/`useFormatting`). All decode/derivation logic lives
// in the framework-free model (LifetimeStatsPageModel.kt); this holder is the thin orchestration layer and performs
// no HTTP.
//
// The lifetime feed re-collects whenever the selected vehicle changes (a new `/analytics/lifetime?vehicle_id={id}`
// read) or the refresh trigger bumps; it is never blocked on a selection (web `vehicleId ? … : ''` ⇒ a null id
// requests the fleet-wide totals), so the surface still loads while the selection reconciles. An all-zero payload
// resolves to UiPhase.Empty via [LifetimeStats.hasData] so each section shows its empty-state (see the model's
// documented divergence note).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics.lifetimestats

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real [AnalyticsStore] + [SettingsStore] + [SelectedVehicleStore] adapter ↔
 *   test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LifetimeStatsPageViewModel(
    private val source: LifetimeStatsPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The decoded lifetime payload as cache-then-network UI state (loading / content / empty / stale / offline /
     * error), carrying the freshness stamp + error kind. Re-collected whenever the active vehicle changes or the
     * refresh trigger bumps. Empty mirrors the [LifetimeStats.hasData] gate — an all-zero payload (no drives /
     * distance / energy / ownership days) resolves to the empty surface.
     */
    val state: StateFlow<UiState<LifetimeStats>> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }
            .flatMapLatest { id -> source.lifetimeStats(id?.takeIf { it > 0L }?.toString()) }
            .map { resource -> resource.mapData(::parseLifetimeStats) }
            .asUiState(isEmpty = { !it.hasData })

    /** The live display preferences (distance/speed unit + currency symbol + precision + locale), re-derived as settings change. */
    val displayPrefs: StateFlow<LifetimeStatsDisplayPrefs> =
        source
            .settings()
            .map { resource -> LifetimeStatsDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = LifetimeStatsDisplayPrefs.DEFAULT,
            )

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("lifetimeStats.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id / distance / cost / achievement payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordLifetimeStatsOpened(logger)
    }
}
