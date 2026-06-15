// The state holder backing the StatisticsPage analytics surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/analytics/pages/StatisticsPage.tsx). It projects the six
// cache-then-network reads onto the shared lifecycle-aware [UiState] surface, scoped to the global active vehicle (web
// `useSelectedVehicle`), and derives the display preferences (distance unit + currency + locale + precision) from the
// live `/settings` document (web `useUnits`/`useFormatting`). All decode/derivation logic lives in the framework-free
// model (StatisticsPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// The primary feed is the period-stats read: it re-collects whenever the selected vehicle changes (a new
// `/analytics/period-stats?vehicle_id={id}` read) or the refresh trigger bumps, and an all-zero / no-vehicle payload
// resolves to UiPhase.Empty via [StatisticsPeriodStats.hasData] so the body shows its `noData` empty-state (the web
// `!stats` guard; see the model's documented divergence note). The four secondary feeds (battery-health, mileage,
// state-summary, fleet comparison) are each their own lifecycle-aware [UiState] so every panel renders its own
// loading / content / empty surface without ever hiding a section (web per-section truthiness guards).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics.statistics

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * @param source the P1/S8 data seam (the page-local period-stats repository + the real Energy/Analytics/Settings
 *   holders + the app-scoped active-vehicle selection in production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class StatisticsPageViewModel(
    private val source: StatisticsPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The active vehicle id (re-emitted on selection change or refresh) that scopes the per-vehicle reads. */
    private val scopedVehicleId: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    /**
     * The primary `/analytics/period-stats` feed as cache-then-network UI state. Re-collected when the active vehicle
     * changes or refresh bumps; an all-zero payload (or no selection — web `enabled: !!activeId`) resolves to the
     * empty surface (web `noData`).
     */
    val state: StateFlow<UiState<StatisticsPeriodStats>> =
        scopedVehicleId
            .flatMapLatest { id -> id.activeId()?.let(source::periodStats) ?: emptyObjectFeed }
            .map { it.mapData(::parsePeriodStats) }
            .asUiState(isEmpty = { !it.hasData })

    /** The `/analytics/battery-health` feed (web `useBatteryHealthAnalytics`) — empty when no usable snapshot. */
    val battery: StateFlow<UiState<StatisticsBatteryHealth>> =
        scopedVehicleId
            .flatMapLatest { id -> id.activeId()?.let(source::batteryHealthAnalytics) ?: emptyObjectFeed }
            .map { it.mapData(::parseBatteryHealth) }
            .asUiState(isEmpty = { !it.hasData })

    /** The `/mileage/stats` feed (web `useMileageStats`) — empty when no mileage has accrued. */
    val mileage: StateFlow<UiState<StatisticsMileage>> =
        scopedVehicleId
            .flatMapLatest { id -> id.activeId()?.let(source::mileageStats) ?: emptyObjectFeed }
            .map { it.mapData(::parseMileage) }
            .asUiState(isEmpty = { !it.hasData })

    /** The `/vehicle-states/summary` feed projected to pie shares (web `useStateSummary` + `stateData`). */
    val states: StateFlow<UiState<List<StatisticsStateShare>>> =
        scopedVehicleId
            .flatMapLatest { id -> id.activeId()?.let(source::stateSummary) ?: emptyArrayFeed }
            .map { resource -> resource.mapData { json -> stateShares(parseStateRows(json)) } }
            .asUiState(isEmpty = { it.isEmpty() })

    /**
     * The fleet `vehicle_comparison` feed (web `useFleetAnalytics`). Fleet-wide (no vehicle scope), re-collected on
     * refresh; empty when fewer than two vehicles exist (web `compData.length > 1`, else `singleVehicle`).
     */
    val comparison: StateFlow<UiState<List<StatisticsVehicleComparison>>> =
        refreshTrigger
            .flatMapLatest { source.fleetAnalytics() }
            .map { it.mapData(::parseVehicleComparison) }
            .asUiState(isEmpty = { it.size <= 1 })

    /** The live display preferences (distance unit + currency symbol + precision + locale), re-derived as settings change. */
    val displayPrefs: StateFlow<StatisticsDisplayPrefs> =
        source
            .settings()
            .map { resource -> StatisticsDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = StatisticsDisplayPrefs.DEFAULT,
            )

    /** Re-runs every cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("statistics.refresh")
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
        recordStatisticsOpened(logger)
    }

    /** A positive selection as the `vehicle_id` string, or null when nothing is selected (web `vehicleId ? … : ''`). */
    private fun Long?.activeId(): String? = this?.takeIf { it > 0L }?.toString()

    private companion object {
        /** The synthetic "no selection" payloads so a null scope resolves to the empty surface rather than a fetch. */
        private val emptyObjectFeed: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonObject(emptyMap()), 0L, false))
        private val emptyArrayFeed: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonArray(emptyList()), 0L, false))
    }
}
