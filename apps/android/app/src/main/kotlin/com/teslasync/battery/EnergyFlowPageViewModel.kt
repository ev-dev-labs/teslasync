// The state holder backing the EnergyFlowPage battery surface (P1/S8) — the native counterpart of the web page's React
// state + TanStack-Query hooks (web/src/features/battery/pages/EnergyFlowPage.tsx). It projects the two cache-then-network
// reads onto the shared lifecycle-aware [UiState] surface, scoped to the global active vehicle (web `useSelectedVehicle`)
// and the selected trailing-day window, and derives the display preferences (distance unit + energy unit + locale +
// precision) from the live `/settings` document (web `useUnits`). All decode/derivation logic lives in the framework-free
// model (EnergyFlowPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// The primary feed is the historical energy-stats read: it re-collects whenever the selected vehicle changes, the
// day window changes, or the refresh trigger bumps (a new `/vehicles/{id}/energy?days=N` read), and an absent /
// no-vehicle payload resolves to UiPhase.Empty via [EnergyStats.hasData] so the body shows its `No Data` empty-state
// (the web `!stats` guard; see the model's documented divergence note). The real-time flow feed (web `useEnergyFlow`)
// is its own lifecycle-aware [UiState] so the energy-flow diagram always renders — with live values when present and
// the greyed-out `N/A` fallbacks otherwise — without ever hiding the section (web renders it with `?? 0` reads).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.energyflow

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
 * @param source the P1/S8 data seam (the real Energy/Settings holders + the app-scoped active-vehicle selection in
 *   production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class EnergyFlowPageViewModel(
    private val source: EnergyFlowPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val dayWindow = MutableStateFlow(DEFAULT_DAYS)
    private var viewOpenedRecorded = false

    /** The active vehicle id (re-emitted on selection change or refresh) that scopes the per-vehicle reads. */
    private val scopedVehicleId: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    /**
     * The primary historical `/vehicles/{id}/energy?days=N` feed as cache-then-network UI state. Re-collected when the
     * active vehicle changes, the day window changes, or refresh bumps; an absent payload (or no selection — web
     * `enabled: activeId != null`) resolves to the empty surface (web `!stats` ▸ `No Data`).
     */
    val state: StateFlow<UiState<EnergyStats>> =
        combine(scopedVehicleId, dayWindow) { id, days -> id to days }
            .flatMapLatest { (id, days) -> id.activeId()?.let { source.energyStats(it, days) } ?: emptyObjectFeed }
            .map { it.mapData(::parseEnergyStats) }
            .asUiState(isEmpty = { !it.hasData })

    /**
     * The real-time `/vehicles/{id}/energy/flow` feed (web `useEnergyFlow`) as UI state. The diagram reads
     * [UiState.data] (or [EnergyFlow.EMPTY]) directly so the section always renders; an all-zero / no-vehicle snapshot
     * resolves to the empty case, where the diagram shows its greyed-out `N/A` fallbacks (web `?? 0` reads).
     */
    val flow: StateFlow<UiState<EnergyFlow>> =
        scopedVehicleId
            .flatMapLatest { id -> id.activeId()?.let(source::energyFlow) ?: emptyObjectFeed }
            .map { it.mapData(::parseEnergyFlow) }
            .asUiState(isEmpty = { !it.hasLive })

    /** The live display preferences (distance unit + energy unit + precision + locale), re-derived as settings change. */
    val displayPrefs: StateFlow<EnergyFlowDisplayPrefs> =
        source
            .settings()
            .map { resource -> EnergyFlowDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = EnergyFlowDisplayPrefs.DEFAULT,
            )

    /** The selected trailing-day window driving the stats read (web `RangePicker` ▸ `days`). */
    val selectedDays: StateFlow<Int> = dayWindow.asStateFlow()

    /** Selects a new trailing-day window (web `setRange`); a non-positive value is clamped to one day. */
    fun selectDays(days: Int) {
        dayWindow.value = days.coerceAtLeast(MIN_DAYS)
    }

    /** Re-runs every cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("energyFlow.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no vehicle id / energy / state-of-charge payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordEnergyFlowOpened(logger)
    }

    /** A positive selection as the `vehicle_id` string, or null when nothing is selected (web `vehicleId ? … : null`). */
    private fun Long?.activeId(): String? = this?.takeIf { it > 0L }?.toString()

    private companion object {
        /** The web default range preset (`defaultPresetId: '7d'`) ▸ a trailing 7-day window. */
        const val DEFAULT_DAYS = 7

        /** The backend accepts a trailing `?days=N >= 1` window (web `Math.max(1, …)`). */
        const val MIN_DAYS = 1

        /** The synthetic "no selection" payload so a null scope resolves to the empty surface rather than a fetch. */
        private val emptyObjectFeed: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonObject(emptyMap()), 0L, false))
    }
}
