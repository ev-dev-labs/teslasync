// The state holder backing the ChargingListPage surface (P1/S8) — the native counterpart of the web page's React
// state + TanStack-Query hooks (web/src/features/charging/pages/ChargingListPage.tsx). It owns the page's local
// interaction state as an immutable [ChargingListInteraction] snapshot, projects the two cache-then-network reads
// (`useChargingSessionsPaginated`, `useChargingOptimizer`) onto the shared lifecycle-aware [UiState] surface via
// [BaseFeedViewModel.asUiState], and runs the bulk-delete mutation (`useBulkDeleteCharging`). Both feeds
// re-collect whenever the active vehicle changes (web `useSelectedVehicle`) or their refresh trigger bumps; with
// no vehicle in scope they park on an empty success (the web disabled-hook case). All derivation logic lives in
// the framework-free model (ChargingListPageModel.kt); this holder is the thin orchestration layer and performs
// no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.charginglist

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import java.time.LocalDate
import java.time.ZoneId

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.data.repo.ChargingRepository] adapter +
 *   [io.teslasync.android.data.SelectedVehicleStore] ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the mutations.
 * @param zone the device zone used for the default date window + day bucketing.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChargingListPageViewModel(
    private val source: ChargingListPageSource,
    logger: Logger,
    val zone: ZoneId = ZoneId.systemDefault(),
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableInteraction = MutableStateFlow(ChargingListInteraction())
    private val sessionsRefresh = MutableStateFlow(0)
    private val optimizerRefresh = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web URL + local state cells). */
    val interaction: StateFlow<ChargingListInteraction> = mutableInteraction.asStateFlow()

    /** The end of the read window — today (web `defaultEndDate`). */
    val windowEnd: String = LocalDate.now(zone).toString()

    /** The start of the read window — today − 30 days (web `defaultStartDate`). */
    val windowStart: String = LocalDate.now(zone).minusDays(ChargingListPageRegistration.DEFAULT_WINDOW_DAYS).toString()

    /** The same-length prior window for the comparison label (web `priorRange`), or `null` when unparseable. */
    val priorRange: DateRange? = priorPeriod(windowStart, windowEnd)

    /**
     * The paginated charging sessions as cache-then-network UI state (web `useChargingSessionsPaginated`).
     * Re-collected whenever the active vehicle changes or the refresh trigger bumps. Gated on a selected vehicle
     * (web `enabled: vehicleId != null`): with no vehicle it parks on an empty success the page renders as its
     * no-sessions empty state.
     */
    val sessionsState: StateFlow<UiState<List<ChargingSession>>> =
        combine(source.selectedVehicleId(), sessionsRefresh) { vehicleId, _ -> vehicleId }
            .flatMapLatest { vehicleId ->
                if (vehicleId == null || vehicleId <= 0L) {
                    flowOf<Resource<List<ChargingSession>>>(Resource.Success(emptyList(), fetchedAt = 0L, stale = false))
                } else {
                    source.sessionsPaginated(vehicleId, windowStart, windowEnd)
                }
            }.asUiState(isEmpty = { it.isEmpty() })

    /**
     * The charging optimizer as cache-then-network UI state (web `useChargingOptimizer`). Gated on a selected
     * vehicle; with none it parks on an empty `JsonNull` success. The page decodes the JSON into the optimizer
     * model at the render boundary and gates the section on the session-count threshold.
     */
    val optimizerState: StateFlow<UiState<JsonElement>> =
        combine(source.selectedVehicleId(), optimizerRefresh) { vehicleId, _ -> vehicleId }
            .flatMapLatest { vehicleId ->
                if (vehicleId == null || vehicleId <= 0L) {
                    flowOf<Resource<JsonElement>>(Resource.Success(JsonNull, fetchedAt = 0L, stale = false))
                } else {
                    source.chargingOptimizer(vehicleId.toString())
                }
            }.asUiState(isEmpty = { false })

    /** Set the structured search query (web `setUrlBatch({ q, page: null })`) — resets to page 1. */
    fun setSearch(query: String) {
        mutableInteraction.update { it.copy(search = query, page = 1) }
    }

    /** Set the active collection filter (web `setUrlBatch({ coll, page: null })`) — resets to page 1. */
    fun setCollection(collection: ChargingCollection) {
        mutableInteraction.update { it.copy(collection = collection, page = 1) }
    }

    /** Set the sort field (web `setSortBy`). */
    fun setSortField(field: ChargingSortField) {
        mutableInteraction.update { it.copy(sortField = field) }
    }

    /** Set the sort direction (web `setSortDesc`). */
    fun setSortDesc(desc: Boolean) {
        mutableInteraction.update { it.copy(sortDesc = desc) }
    }

    /** Set the list row density (web `setDensity`). */
    fun setDensity(density: ChargingListDensity) {
        mutableInteraction.update { it.copy(density = density) }
    }

    /** Set the 1-based page (web `setPage`). */
    fun setPage(page: Int) {
        mutableInteraction.update { it.copy(page = page) }
    }

    /** Set the active trend metric (web `setTrendMetric`). */
    fun setTrendMetric(metric: ChargingTrendMetric) {
        mutableInteraction.update { it.copy(trendMetric = metric) }
    }

    /** Toggle a session's bulk selection (web `toggleSessionSelected`). */
    fun toggleBulkSelected(
        id: Long,
        on: Boolean,
    ) {
        mutableInteraction.update {
            val next = it.bulkSelected.toMutableSet()
            if (on) next += id else next -= id
            it.copy(bulkSelected = next)
        }
    }

    /** Clear the bulk selection (web `clearBulk`). */
    fun clearBulk() {
        mutableInteraction.update { it.copy(bulkSelected = emptySet()) }
    }

    /**
     * Run the `DELETE /charging/bulk` mutation over [ids] then clear the selection and refresh the list (web
     * `bulkDeleteMut.mutateAsync` ▸ `clearBulk`). Logged, never throwing — a failure leaves the selection intact.
     */
    suspend fun deleteCharging(ids: List<Long>) {
        if (ids.isEmpty()) return
        logger.info("chargingList.bulkDelete", mapOf("count" to ids.size.toString()))
        val result = source.bulkDeleteCharging(ids)
        if (result.isSuccess) {
            clearBulk()
            sessionsRefresh.update { it + 1 }
        }
    }

    /** Re-collect both feeds — the web query `refetch` / the page error-retry affordance. */
    fun refresh() {
        logger.info("chargingList.refresh")
        sessionsRefresh.update { it + 1 }
        optimizerRefresh.update { it + 1 }
    }

    /** Retry affordance for the sessions feed's hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordChargingListPageOpened(logger)
    }
}
