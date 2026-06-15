// The state holder backing the DrivesListPage surface (P1/S8) — the native counterpart of the web page's React
// state + TanStack-Query hooks (web/src/features/driving/pages/DrivesListPage.tsx). It owns the page's local
// interaction state (sort / collection / trend metric / page / search / bulk selection) as an immutable
// [DrivesListInteraction] snapshot, projects the single cache-then-network drives read (`useDrives`) onto the
// shared lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState], derives the live display
// preferences from the settings document (web `useUnits`/`useFormatting`), and runs the one bulk-delete mutation
// (`useBulkDeleteDrives`). The drives feed re-collects whenever the active vehicle changes (web
// `useSelectedVehicle`) or the refresh trigger bumps; with no vehicle in scope it parks on an empty success (the
// web disabled-hook / `NoVehicleSelected` case), which the page renders as its no-drives empty state. All
// derivation logic lives in the framework-free model (DrivesListPageModel.kt); this holder is the thin
// orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.driving.driveslist

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
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

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.data.repo.DrivingRepository] adapter +
 *   [io.teslasync.android.data.SelectedVehicleStore] + [io.teslasync.shared.core.presentation.settings.SettingsStore]
 *   ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` + `delete`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DrivesListPageViewModel(
    private val source: DrivesListPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableInteraction = MutableStateFlow(DrivesListInteraction())
    private val drivesRefresh = MutableStateFlow(0)
    private val mutableDeleting = MutableStateFlow(false)
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web URL-state cells + the bulk-selection useState). */
    val interaction: StateFlow<DrivesListInteraction> = mutableInteraction.asStateFlow()

    /** Whether a bulk delete is in flight — drives the toolbar action's loading state (web `mutateAsync`). */
    val deleting: StateFlow<Boolean> = mutableDeleting.asStateFlow()

    /**
     * The vehicle's drives as cache-then-network UI state (web `useDrives`). Re-collected whenever the active
     * vehicle changes or the refresh trigger bumps. Gated on a selected vehicle (web `enabled: vehicleId != null`):
     * with no vehicle it parks on an empty success the page renders as its no-drives empty state.
     */
    val drivesState: StateFlow<UiState<List<Drive>>> =
        combine(source.selectedVehicleId(), drivesRefresh) { vehicleId, _ -> vehicleId }
            .flatMapLatest { vehicleId ->
                if (vehicleId == null || vehicleId <= 0L) {
                    flowOf<Resource<List<Drive>>>(Resource.Success(emptyList(), fetchedAt = 0L, stale = false))
                } else {
                    source.drives(vehicleId)
                }
            }
            .asUiState(isEmpty = { it.isEmpty() })

    /**
     * The live display preferences derived from the settings document (web `useUnits` + `useFormatting`). Shared
     * while observed; falls back to the metric/`$`/2dp/$0.12-per-kWh defaults before settings load so the first
     * frame is never blank.
     */
    val displayPrefs: StateFlow<DrivesDisplayPrefs> =
        source.settings()
            .map { resource -> DrivesDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), DrivesDisplayPrefs.default())

    // ── Interaction actions (web setUrlBatch / setState) ──────────────────────────────────────────────────────

    /** Sets the list sort facet (web `setSortBy`). */
    fun setSort(sort: DriveSort) = mutableInteraction.update { it.copy(sort = sort) }

    /** Selects a collection facet, resetting to page 1 (web `setUrlBatch({ coll, page: null })`). */
    fun setCollection(collection: DriveCollection) =
        mutableInteraction.update { it.copy(collection = collection, page = 1) }

    /** Switches the trend-chart metric (web `setTrendMetric`). */
    fun setTrendMetric(metric: TrendMetric) = mutableInteraction.update { it.copy(trendMetric = metric) }

    /** Jumps to a 1-based page (web `setPage`). */
    fun setPage(page: Int) = mutableInteraction.update { it.copy(page = page.coerceAtLeast(1)) }

    /** Updates the search query, resetting to page 1 (web `setUrlBatch({ q, page: null })`). */
    fun setSearch(query: String) = mutableInteraction.update { it.copy(search = query, page = 1) }

    /** Toggles a drive's bulk selection (web `toggleDriveSelected`). */
    fun toggleSelected(
        id: Long,
        on: Boolean,
    ) = mutableInteraction.update {
        val next = it.selectedIds.toMutableSet()
        if (on) next.add(id) else next.remove(id)
        it.copy(selectedIds = next)
    }

    /** Clears the bulk selection (web `clearBulk`). */
    fun clearSelection() = mutableInteraction.update { it.copy(selectedIds = emptySet()) }

    /**
     * Prunes the bulk selection to the currently-visible [visibleIds] (web `useEffect` that drops a selected id
     * once it scrolls out of the filtered set). A no-op when nothing changes, so it is safe to call every frame.
     */
    fun retainSelection(visibleIds: Set<Long>) =
        mutableInteraction.update { state ->
            if (state.selectedIds.isEmpty()) return@update state
            val pruned = state.selectedIds.intersect(visibleIds)
            if (pruned.size == state.selectedIds.size) state else state.copy(selectedIds = pruned)
        }

    /** Resets the search / collection / sort / page filters (web empty-state `Reset filters` CTA). */
    fun resetFilters() =
        mutableInteraction.update {
            it.copy(search = "", collection = DriveCollection.All, sort = DriveSort.Date, page = 1)
        }

    // ── Mutation (web `useBulkDeleteDrives`) ──────────────────────────────────────────────────────────────────

    /**
     * Bulk-deletes the currently-selected drives, then re-collects the drives feed and clears the selection on
     * success (web `mutateAsync(ids)` ▸ `clearBulk()`; the hook also invalidates `['drives']`). A no-op when the
     * selection is empty or a delete is already running.
     */
    fun deleteSelected() {
        val ids = mutableInteraction.value.selectedIds.toList()
        if (ids.isEmpty() || mutableDeleting.value) return
        mutableDeleting.value = true
        launch {
            try {
                logger.info("drives.bulkDelete", mapOf("count" to ids.size.toString()))
                val result = source.bulkDeleteDrives(ids)
                if (result.isSuccess) {
                    clearSelection()
                    drivesRefresh.update { it + 1 }
                }
            } finally {
                mutableDeleting.value = false
            }
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────────────────────────────────────

    /** Re-collect the drives feed — the web query `refetch` / the page error-retry + pull-to-refresh affordance. */
    fun refresh() {
        logger.info("drives.refresh")
        drivesRefresh.update { it + 1 }
    }

    /** Retry affordance for the drives feed's hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordDrivesListPageOpened(logger)
    }
}
