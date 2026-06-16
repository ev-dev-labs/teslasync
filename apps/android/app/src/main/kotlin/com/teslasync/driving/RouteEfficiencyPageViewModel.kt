// The state holder backing the RouteEfficiencyPage driving surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/driving/pages/RouteEfficiencyPage.tsx). It owns the page's local
// date-range interaction as an immutable [RouteEfficiencyDateRange] snapshot, projects the single cache-then-network
// route-efficiency read (`useRouteEfficiency`) onto the shared lifecycle-aware [UiState] surface scoped to the global
// active vehicle (web `useSelectedVehicle`), and derives the live display preferences from the settings document (web
// `useUnits`). All decode/derivation logic lives in the framework-free model (RouteEfficiencyPageModel.kt); this holder
// is the thin orchestration layer and performs no HTTP.
//
// The route-efficiency feed re-collects whenever the active vehicle changes, the date range changes, or the refresh
// trigger bumps; with no vehicle in scope it parks on an empty success (the web disabled-hook / `enabled: !!vehicleId`
// case), which the page renders as its no-routes empty surface. An all-empty payload (no routes in range) resolves to
// UiPhase.Empty via [RouteEfficiencyModel.isEmpty] so the body shows its `noData` empty surface (the web
// `routes.length === 0` case in the metrics panel + the hidden comparison chart).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.driving.routeefficiency

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
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * @param source the P1/S8 data seam (the real [io.teslasync.shared.core.data.repo.DrivingRepository] adapter +
 *   [io.teslasync.android.data.SelectedVehicleStore] + [io.teslasync.shared.core.presentation.settings.SettingsStore]
 *   <-> test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RouteEfficiencyPageViewModel(
    private val source: RouteEfficiencyPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableRange = MutableStateFlow(RouteEfficiencyDateRange.trailingMonth())
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The page's local date scope (web `from`/`to` URL-state cells), defaulting to the trailing 30-day window. */
    val range: StateFlow<RouteEfficiencyDateRange> = mutableRange.asStateFlow()

    /**
     * The vehicle's route efficiency as cache-then-network UI state (web `useRouteEfficiency`). Re-collected whenever
     * the active vehicle changes, the date range changes, or the refresh trigger bumps. Gated on a selected vehicle
     * (web `enabled: !!vehicleId`): with no vehicle it parks on an empty success the page renders as its no-routes
     * empty surface. An empty route set resolves to [UiState.isEmpty].
     */
    val state: StateFlow<UiState<RouteEfficiencyModel>> =
        combine(source.selectedVehicleId(), mutableRange, refreshTrigger) { id, range, _ -> id to range }
            .flatMapLatest { (id, range) ->
                val vehicleId = id?.takeIf { it > 0L }?.toString()
                if (vehicleId == null) {
                    emptyFeed
                } else {
                    source.routeEfficiency(vehicleId, range.startIso, range.endIso)
                }
            }
            .map { it.mapData(::parseRouteEfficiency) }
            .asUiState(isEmpty = { it.isEmpty })

    /**
     * The live display preferences derived from the settings document (web `useUnits`). Shared while observed; falls
     * back to the metric/2dp/en-US defaults before settings load so the first frame is never blank.
     */
    val displayPrefs: StateFlow<RouteEfficiencyDisplayPrefs> =
        source
            .settings()
            .map { resource -> RouteEfficiencyDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = RouteEfficiencyDisplayPrefs.DEFAULT,
            )

    /**
     * Sets the inclusive date scope from the range picker's epoch-day pair, re-collecting the feed (web
     * `setRangeBatch({ from, to })`). A `null` from the picker leaves that bound unchanged so a half-edited range never
     * blanks the read.
     */
    fun setRange(
        startEpochDay: Long?,
        endEpochDay: Long?,
    ) = mutableRange.update { current ->
        RouteEfficiencyDateRange(
            startEpochDay = startEpochDay ?: current.startEpochDay,
            endEpochDay = endEpochDay ?: current.endEpochDay,
        )
    }

    /** Re-runs the cache-then-network load (the web query `refetch` + the error-surface retry affordance). */
    fun refresh() {
        logger.info("routeEfficiency.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the route-efficiency feed's hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no vehicle id / location / efficiency payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordRouteEfficiencyOpened(logger)
    }

    private companion object {
        /** The synthetic "no selection" payload so a null scope resolves to the empty surface rather than a fetch. */
        private val emptyFeed: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonObject(emptyMap()), 0L, false))
    }
}
