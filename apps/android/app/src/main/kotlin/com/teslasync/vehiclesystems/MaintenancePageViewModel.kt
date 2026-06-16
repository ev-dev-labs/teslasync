// The state holder backing the MaintenancePage vehicle-systems surface (P1/S8) — the native counterpart of the web
// page's React state + TanStack-Query hooks (web/src/features/vehicle-systems/pages/MaintenancePage.tsx). It projects
// the two cache-then-network reads (items + service records) onto the shared lifecycle-aware [UiState] surface, scoped
// to the global active vehicle (web `useSelectedVehicle`; the queries are `enabled: vehicleId !== null`), derives the
// display preferences from the live `/settings` document (web `useFormatting`), and owns the toolbar's local
// category-filter + sort state (web `useState`). All decode/derivation logic lives in the framework-free model
// (MaintenancePageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// Both feeds are their own lifecycle-aware [UiState] (items + records) so every panel renders its own
// loading / content / empty / error surface without ever hiding a section (web per-section truthiness guards). A
// null / non-positive selection resolves each feed to the empty surface via the synthetic empty-array feed (web's
// disabled-query "no data" branch), so the page shows its zero-summary + empty states rather than a spinner.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems.maintenance

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
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement

/**
 * @param source the P1/S8 data seam (the page-local maintenance repository + the shared Settings holder + the
 *   app-scoped active-vehicle selection in production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock wall-clock seam for the months-interval progress math; injectable for deterministic tests.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MaintenancePageViewModel(
    private val source: MaintenancePageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The active vehicle id (re-emitted on selection change or refresh) that gates the per-vehicle reads. */
    private val scopedVehicleId: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    /**
     * The `/maintenance` items feed as cache-then-network UI state (web `items`). Re-collected when the active vehicle
     * changes or refresh bumps; a no-selection scope (web `enabled: vehicleId !== null`) resolves to the empty surface.
     */
    val itemsState: StateFlow<UiState<List<MaintenanceItem>>> =
        scopedVehicleId
            .flatMapLatest { id -> if ((id ?: 0L) > 0L) source.items() else emptyArrayFeed }
            .map { resource -> resource.mapData { json -> parseItems(json) } }
            .asUiState(isEmpty = { it.isEmpty() })

    /** The `/maintenance/records` feed as cache-then-network UI state (web `records`) — empty when no records exist. */
    val recordsState: StateFlow<UiState<List<ServiceRecord>>> =
        scopedVehicleId
            .flatMapLatest { id -> if ((id ?: 0L) > 0L) source.records() else emptyArrayFeed }
            .map { resource -> resource.mapData { json -> parseRecords(json) } }
            .asUiState(isEmpty = { it.isEmpty() })

    /** The live display preferences (currency symbol + precision + locale), re-derived as settings change. */
    val displayPrefs: StateFlow<MaintenanceDisplayPrefs> =
        source
            .settings()
            .map { resource -> MaintenanceDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = MaintenanceDisplayPrefs.DEFAULT,
            )

    private val mutableFilter = MutableStateFlow(MaintenanceFilterState())

    /** The toolbar's local category-filter + sort state (web `categoryFilter` + `sortBy` `useState`). */
    val filter: StateFlow<MaintenanceFilterState> = mutableFilter.asStateFlow()

    /** Sets the category filter (web `setCategoryFilter`). */
    fun setCategory(category: MaintenanceCategoryFilter) {
        mutableFilter.update { it.copy(category = category) }
    }

    /** Sets the sort key (web `setSortBy`). */
    fun setSort(key: MaintenanceSortKey) {
        mutableFilter.update { it.copy(sort = key) }
    }

    /** The wall-clock instant used by the render boundary for the months-interval progress (web `Date.now()`). */
    fun nowMillis(): Long = clock()

    /** Re-runs both cache-then-network loads (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("maintenance.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for a hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no vehicle id / mileage / cost payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to MaintenancePageRegistration.SLUG))
    }

    private companion object {
        /** The synthetic "no selection" payload so a null scope resolves to the empty surface rather than a fetch. */
        private val emptyArrayFeed: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonArray(emptyList()), 0L, false))
    }
}
