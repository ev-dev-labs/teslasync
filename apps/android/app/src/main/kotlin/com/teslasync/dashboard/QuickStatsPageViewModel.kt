// The state holder backing the QuickStatsPage dashboard surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/dashboard/pages/QuickStatsPage.tsx). It projects the
// `useVehicles` + `useAnalyticsSummary` reads onto the single lifecycle-aware [UiState] surface the page renders
// (web `isLoading`/`error` combine + `vehicles?.[0]`), exposes the `useVehicleState` subtitle label as its own
// always-available [StateFlow], and derives the display preferences (distance unit + currency + locale + precision)
// from the live `/settings` document (web `useUnits`/`useFormatting`). All decode/merge logic lives in the
// framework-free model (QuickStatsPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// The primary [state] re-collects whenever the refresh trigger bumps (the web `refetch()` affordance + the
// error-surface retry). The vehicle-state label is chained off the FIRST vehicle's id (web `useVehicleState(
// vehicle?.id ?? 0)`): it re-derives only when that id changes, never blocks the primary surface, and falls back to
// the offline default before a vehicle / reading exists — exactly the web `stateData?.state?.state ?? 'offline'`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/dashboard) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.quickstats

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (the shared Vehicles + Analytics + Settings holders in production ↔ a test fake);
 *   the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class QuickStatsPageViewModel(
    private val source: QuickStatsPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The merged `useVehicles` + `useAnalyticsSummary` surface as cache-then-network UI state (loading / content /
     * empty / error / stale / offline). An absent first vehicle resolves to the empty surface (web noVehicle inside
     * the vehicle panel) while the metric grid still renders; either feed first-loading shows the spinner; either
     * hard error shows the retryable error panel. Re-collected whenever the refresh trigger bumps.
     */
    val state: StateFlow<UiState<QuickStats>> =
        combine(
            refreshTrigger.flatMapLatest { source.vehicles() },
            refreshTrigger.flatMapLatest { source.analyticsSummary() },
        ) { vehicles, analytics -> mergeQuickStats(vehicles, analytics) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = UiState.loading(),
            )

    /**
     * The first vehicle's last-known state label (web `useVehicleState(vehicle?.id ?? 0)` → `state?.state ?? 'offline'`).
     * Chained off the first enrolled vehicle's id so it re-derives only when that id changes; a null / zero id (no
     * vehicle yet) and any missing reading both resolve to the offline default, so the card always shows a state line.
     */
    val vehicleStateLabel: StateFlow<String> =
        refreshTrigger
            .flatMapLatest { source.vehicles() }
            .map { resource -> resource.cached?.firstOrNull()?.id }
            .distinctUntilChanged()
            .flatMapLatest { id ->
                if (id == null || id <= 0L) {
                    flowOf(DEFAULT_VEHICLE_STATE)
                } else {
                    source.vehicleState(id).map { resource -> vehicleStateLabelOf(resource.cached) }
                }
            }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = DEFAULT_VEHICLE_STATE,
            )

    /** The live display preferences (distance unit + currency symbol + precision + locale), re-derived as settings change. */
    val displayPrefs: StateFlow<QuickStatsDisplayPrefs> =
        source
            .settings()
            .map { resource -> QuickStatsDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = QuickStatsDisplayPrefs.DEFAULT,
            )

    /** Re-runs the cache-then-network loads (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("quickStats.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no vehicle id / distance / cost payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordQuickStatsOpened(logger)
    }
}
