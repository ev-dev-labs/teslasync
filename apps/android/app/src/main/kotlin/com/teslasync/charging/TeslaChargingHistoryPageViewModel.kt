// The state holder backing the TeslaChargingHistoryPage charging surface (P1/S8) — the native counterpart of the
// web page's React state + TanStack-Query hooks (web/src/features/charging/pages/TeslaChargingHistoryPage.tsx).
// It owns the page's local interaction state (the VIN filter, the date/energy/cost sort, the location search, and
// the bulk-export row selection) as a single immutable [TeslaChargingHistoryInteraction] snapshot, and projects
// the three cache-then-network reads onto lifecycle-aware surfaces:
//   • the `/tesla/charging/history` feed is the spine driving the loading / empty / error phase, re-collected
//     whenever the selected VIN changes (a new `?vin` read) or the refresh trigger bumps;
//   • the `/vehicles` list (the VIN dropdown) and the `/settings` document (the currency context) fold in as
//     their own light StateFlows so the page chrome (selector, summary, table) never blanks while history loads.
// All derivation logic lives in the framework-free model (TeslaChargingHistoryPageModel.kt); this holder is the
// thin orchestration layer and performs no HTTP. SI stays SI (Wh); display conversion is the render boundary's job.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.teslacharginghistory

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * The page's local interaction snapshot — the union of the web component's `useUrlString('vin')` /
 * `useUrlEnum('sort'|'dir')` / `useUrlString('q')` params + the `selectedKeys` `useState`, folded into one
 * immutable value so the composable reads a single source.
 *
 * @property selectedVin the VIN filter (`''` = all vehicles, web `selectedVin`).
 * @property sortKey the active sort column (`date` | `energy` | `cost`, web `useUrlEnum('sort')`).
 * @property sortDescending whether the sort is descending (web `dir === 'desc'`).
 * @property search the location search query (web `useUrlString('q')`).
 * @property selectedKeys the session ids selected for bulk CSV export (web `selectedKeys`).
 */
data class TeslaChargingHistoryInteraction(
    val selectedVin: String = "",
    val sortKey: String = TeslaChargingHistoryPageRegistration.DEFAULT_SORT_KEY,
    val sortDescending: Boolean = true,
    val search: String = "",
    val selectedKeys: Set<Long> = emptySet(),
) {
    /** The resolved sort column for the model's sort (web `sortKey`). */
    val sortColumn: HistorySortColumn get() = HistorySortColumn.fromKey(sortKey)
}

/**
 * @param source the P1/S8 data seam (real Vehicles/Settings stores + charging repository ↔ test fake); the view
 *   never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TeslaChargingHistoryPageViewModel(
    private val source: TeslaChargingHistoryPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableInteraction = MutableStateFlow(TeslaChargingHistoryInteraction())
    private val historyRefresh = MutableStateFlow(0)
    private val mutableRefreshing = MutableStateFlow(false)
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web `useUrlState` group + selection). */
    val interaction: StateFlow<TeslaChargingHistoryInteraction> = mutableInteraction.asStateFlow()

    /** Whether a Tesla refresh is in flight (web `refreshMutation.isPending`) — drives the Refresh button label. */
    val refreshing: StateFlow<Boolean> = mutableRefreshing.asStateFlow()

    /**
     * The Tesla charging-history surface as cache-then-network UI state (loading / content / empty / stale /
     * offline / error). Re-collected whenever the selected VIN changes (a new `?vin` read) or the refresh trigger
     * bumps (web `useTeslaChargingHistory(selectedVin || undefined)` + the post-mutation `invalidateQueries`).
     */
    val state: StateFlow<UiState<TeslaChargingHistoryData>> =
        combine(
            mutableInteraction.map { it.selectedVin }.distinctUntilChanged(),
            historyRefresh,
        ) { vin, _ -> vin }
            .flatMapLatest { vin -> source.teslaChargingHistory(vin.ifEmpty { null }) }
            .map { resource -> resource.mapHistory() }
            .asUiState(isEmpty = { it.isEmpty })

    /** The enrolled-vehicle list for the VIN dropdown (web `useVehicles`); empty until the list loads. */
    val vehicles: StateFlow<List<Vehicle>> =
        source.vehicles()
            .map { it.cached ?: emptyList() }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), emptyList())

    /** The display currency context (web `useFormatting`/`useSettings`); metric default until settings load. */
    val currency: StateFlow<CurrencyContext> =
        source.settings()
            .map { CurrencyContext.from(it.cached) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), CurrencyContext.DEFAULT)

    // ── Interaction setters (web event handlers) ────────────────────────────────────────────────────────────────

    /** Select the VIN filter (web `setSelectedVin`); clears the export selection so it never spans vehicles. */
    fun selectVehicle(vin: String): Unit = mutableInteraction.update { it.copy(selectedVin = vin, selectedKeys = emptySet()) }

    /** Set the location search query (web `setSearch`). */
    fun setSearch(value: String): Unit = mutableInteraction.update { it.copy(search = value) }

    /** Clear the location search (web `onRemove` / `onClearAll`). */
    fun clearSearch(): Unit = mutableInteraction.update { it.copy(search = "") }

    /**
     * Toggle the sort by [key] (web `handleSort`): re-selecting the active column flips the direction; a new
     * column selects it descending-first. Only `date`/`energy`/`cost` are sortable columns.
     */
    fun toggleSort(key: String): Unit =
        mutableInteraction.update {
            if (it.sortKey == key) {
                it.copy(sortDescending = !it.sortDescending)
            } else {
                it.copy(sortKey = key, sortDescending = true)
            }
        }

    /** Replace the bulk-export selection (web `onSelectionChange`). */
    fun setSelectedKeys(keys: Set<Long>): Unit = mutableInteraction.update { it.copy(selectedKeys = keys) }

    // ── Refresh / retry (web mutation + the error-state retry) ───────────────────────────────────────────────────

    /**
     * Pull fresh charging history from Tesla for the selected VIN (web `refreshMutation.mutate`), then re-collect
     * the history feed on success (the web `invalidateQueries` ⇒ refetch). A second tap while a refresh is in
     * flight is ignored (web `disabled={refreshMutation.isPending}`).
     */
    fun refresh() {
        if (mutableRefreshing.value) return
        logger.info("teslaChargingHistory.refresh")
        mutableRefreshing.value = true
        launch {
            val vin = mutableInteraction.value.selectedVin.ifEmpty { null }
            val result = source.refreshHistory(vin)
            result.onSuccess { historyRefresh.update { n -> n + 1 } }
            mutableRefreshing.value = false
        }
    }

    /** Retry affordance for the history feed's hard-error surface (re-collect, web query `refetch`). */
    fun retry(): Unit = historyRefresh.update { it + 1 }

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordTeslaChargingHistoryPageOpened(logger)
    }

    /**
     * Maps the raw-JSON history resource onto the typed [TeslaChargingHistoryData], parsing the cached value on
     * every emission (loading/error keep the last parsed rows visible; success parses fresh). A parse never
     * throws — [TeslaChargingHistoryData.from] tolerates a malformed/absent envelope by returning the empty
     * payload, which the page renders as its no-data empty state.
     */
    private fun Resource<kotlinx.serialization.json.JsonElement>.mapHistory(): Resource<TeslaChargingHistoryData> =
        when (this) {
            is Resource.Loading ->
                Resource.Loading(cached?.let { TeslaChargingHistoryData.from(it) }, fetchedAt, stale)
            is Resource.Error ->
                Resource.Error(cached?.let { TeslaChargingHistoryData.from(it) }, fetchedAt, stale, error)
            is Resource.Success ->
                Resource.Success(TeslaChargingHistoryData.from(data), fetchedAt, stale)
        }
}
