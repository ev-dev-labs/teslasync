// The state holder backing the BatteryCellsPage battery surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hook (web/src/features/battery/pages/BatteryCellsPage.tsx). It projects the
// `/analytics/battery-cells` cache-then-network read onto the shared lifecycle-aware [UiState] surface, scoped to the
// global active vehicle (web `useSelectedVehicle`), and derives the display preferences (temperature unit + locale)
// from the live `/settings` document (web `useUnits`). All decode/derivation logic lives in the framework-free model
// (BatteryCellsPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// The feed re-collects whenever the selected vehicle changes (a new `/analytics/battery-cells?vehicle_id={id}` read)
// or the refresh trigger bumps. With no selection it resolves to UiPhase.Empty rather than fetching (web
// `enabled: activeId !== ''`), and an all-empty payload (no cells / history / totals) likewise routes to
// UiPhase.Empty via [BatteryCellData.hasData] so the page shows its empty surfaces (see the model's documented
// divergence note).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.batterycells

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
import kotlinx.serialization.json.JsonObject

/**
 * @param source the P1/S8 data seam (the page-local battery-cells repository + the shared Settings holder + the
 *   app-scoped active-vehicle selection in production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BatteryCellsPageViewModel(
    private val source: BatteryCellsPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The active vehicle id (re-emitted on selection change or refresh) that scopes the per-vehicle read. */
    private val scopedVehicleId: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    /**
     * The decoded `/analytics/battery-cells` payload as cache-then-network UI state (loading / content / empty /
     * stale / offline / error), carrying the freshness stamp + error kind. Re-collected whenever the active vehicle
     * changes or the refresh trigger bumps; with no selection (web `enabled: activeId !== ''`) it resolves to the
     * empty surface rather than fetching. Empty mirrors the [BatteryCellData.hasData] gate — a payload with no cells,
     * history or totals resolves to the empty surface.
     */
    val state: StateFlow<UiState<BatteryCellData>> =
        scopedVehicleId
            .flatMapLatest { id -> id.activeId()?.let(source::batteryCells) ?: emptyObjectFeed }
            .map { resource -> resource.mapData(::parseBatteryCellData) }
            .asUiState(isEmpty = { !it.hasData })

    /** The live display preferences (temperature unit + locale), re-derived as settings change. */
    val displayPrefs: StateFlow<BatteryCellsDisplayPrefs> =
        source
            .settings()
            .map { resource -> BatteryCellsDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = BatteryCellsDisplayPrefs.DEFAULT,
            )

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("batteryCells.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no vehicle id / voltage / temperature payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordBatteryCellsOpened(logger)
    }

    /** A positive selection as the `vehicle_id` string, or null when nothing is selected (web `vehicleId ? … : ''`). */
    private fun Long?.activeId(): String? = this?.takeIf { it > 0L }?.toString()

    private companion object {
        /** The synthetic "no selection" payload so a null scope resolves to the empty surface rather than a fetch. */
        private val emptyObjectFeed: Flow<Resource<kotlinx.serialization.json.JsonElement>> =
            flowOf(Resource.Success(JsonObject(emptyMap()), 0L, false))
    }
}
