// The state holder backing the EfficiencyPage surface (P1/S8) — the native counterpart of the web page's React state +
// TanStack-Query hooks (web/src/features/driving/pages/EfficiencyPage.tsx). It projects the two cache-then-network reads
// (`useDrives` + `useDrivingStats`) onto the shared lifecycle-aware [UiState] surface, scoped to the global active
// vehicle (web `useSelectedVehicle`), owns the page-local date-range cell (web `from`/`to` URL state, defaulting to the
// last 30 days) and derives the live display preferences from the `/settings` document (web `useUnits`/`useSettings`).
// All decode/derivation logic lives in the framework-free model (EfficiencyPageModel.kt); this holder is the thin
// orchestration layer and performs no HTTP.
//
// Both feeds re-collect whenever the active vehicle changes or the refresh trigger bumps; with no vehicle in scope they
// park on an empty success (the web disabled-hook / `enabled: !!vehicleId` case), which the page renders as its no-data
// empty states. The stats feed decodes the raw SI `/drives/stats` JSON into [EfficiencyStats] and resolves to
// `UiPhase.Empty` when the aggregate is absent (web `!stats`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.driving.efficiency

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Drive
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
import kotlinx.serialization.json.JsonNull

/**
 * @param source the P1/S8 data seam (the shared [io.teslasync.shared.core.data.repo.DrivingRepository] adapter +
 *   [io.teslasync.android.data.SelectedVehicleStore] + [io.teslasync.shared.core.presentation.settings.SettingsStore]
 *   ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class EfficiencyPageViewModel(
    private val source: EfficiencyPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val mutableDateRange = MutableStateFlow(EfficiencyDateRange.default())
    private var viewOpenedRecorded = false

    /** The active vehicle id (re-emitted on selection change or refresh) that scopes the per-vehicle reads. */
    private val scopedVehicleId: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    /** The page-local inclusive date range the charts filter on (web `from`/`to`, default last 30 days). */
    val dateRange: StateFlow<EfficiencyDateRange> = mutableDateRange.asStateFlow()

    /**
     * The vehicle's drives as cache-then-network UI state (web `useDrives`). Re-collected whenever the active vehicle
     * changes or the refresh trigger bumps; gated on a selected vehicle (web `enabled: vehicleId != null`): with no
     * vehicle it parks on an empty success the page renders as its no-data empty state.
     */
    val drivesState: StateFlow<UiState<List<Drive>>> =
        scopedVehicleId
            .flatMapLatest { id -> if (id != null && id > 0L) source.drives(id) else EMPTY_DRIVES_FEED }
            .asUiState(isEmpty = { it.isEmpty() })

    /**
     * The vehicle's aggregate driving stats as cache-then-network UI state (web `useDrivingStats`). The raw SI
     * `/drives/stats` JSON is decoded into [EfficiencyStats]; a no-aggregate / no-vehicle payload resolves to the empty
     * surface (web `!stats`), which the stats-driven panels render as their per-section empty states.
     */
    val statsState: StateFlow<UiState<EfficiencyStats>> =
        scopedVehicleId
            .flatMapLatest { id -> if (id != null && id > 0L) source.drivingStats(id) else EMPTY_STATS_FEED }
            .map { it.mapData(::parseEfficiencyStats) }
            .asUiState(isEmpty = { !it.hasData })

    /**
     * The live display preferences (distance + speed + temperature unit + precision + locale) derived from the settings
     * document (web `useUnits`/`useSettings`). Shared while observed; falls back to the metric/2dp/en-US defaults before
     * settings load so the first frame is never blank.
     */
    val displayPrefs: StateFlow<EfficiencyDisplayPrefs> =
        source
            .settings()
            .map { resource -> EfficiencyDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = EfficiencyDisplayPrefs.DEFAULT,
            )

    /**
     * Sets the chart date range (web `setRangeBatch({ from, to })`). A null bound keeps the current value, so a partial
     * range edit never blanks the filter; an inverted range is normalized so `start <= end`.
     */
    fun setDateRange(startEpochDay: Long?, endEpochDay: Long?) {
        mutableDateRange.update { current ->
            val start = startEpochDay ?: current.startEpochDay
            val end = endEpochDay ?: current.endEpochDay
            EfficiencyDateRange(minOf(start, end), maxOf(start, end))
        }
    }

    /** Re-collect both feeds — the web query `refetch` / the page error-retry + pull-to-refresh affordance. */
    fun refresh() {
        logger.info("efficiency.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordEfficiencyPageOpened(logger)
    }

    private companion object {
        /** The synthetic "no selection" payloads so a null scope resolves to the empty surface rather than a fetch. */
        private val EMPTY_DRIVES_FEED: Flow<Resource<List<Drive>>> =
            flowOf(Resource.Success(emptyList(), 0L, false))
        private val EMPTY_STATS_FEED: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonNull, 0L, false))
    }
}
