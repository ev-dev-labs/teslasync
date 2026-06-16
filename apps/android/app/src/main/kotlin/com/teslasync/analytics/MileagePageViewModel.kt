// The state holder backing the analytics MileagePage surface (P1/S8) — the native counterpart of the web
// page's TanStack-Query hooks + `useSelectedVehicle` (web/src/features/analytics/pages/MileagePage.tsx).
// It resolves the active vehicle from the app-scoped [SelectedVehicleStore] (the header vehicle picker —
// web `useSelectedVehicle`), falling back to the first enrolled vehicle when nothing is selected yet (the
// app's self-healing selection, matching the web default-to-first behaviour), then projects the three
// cache-then-network reads (`/mileage/stats` spine + `/mileage/daily` + `/mileage/monthly`) onto the shared
// lifecycle-aware [UiState] surface. The stats feed drives the loading / empty / error phase; the daily +
// monthly feeds fold in best-effort (web reads each independently) so a still-loading or failed daily/
// monthly read never blanks the summary metrics. All derivation lives in the framework-free model
// (MileagePageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics)
// diverges from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics.mileage

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * @param source the P1/S8 data seam (real Vehicles+Analytics adapter ↔ test fake); the view never performs HTTP.
 * @param selection the app-scoped active-vehicle selection (web `useSelectedVehicle` / the header picker).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MileagePageViewModel(
    private val source: MileageSource,
    private val selection: SelectedVehicleStore,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The combined mileage surface as cache-then-network UI state (loading / content / empty / stale /
     * offline / error). Re-collected whenever the active vehicle changes or the refresh trigger bumps. The
     * stats feed drives the phase + freshness; daily + monthly fold in best-effort. The empty phase is the
     * no-vehicle case (web `<NoVehicleSelected />`); a resolved vehicle always renders content (all-zero
     * metrics + per-panel empty states) even with no recorded drives.
     */
    val state: StateFlow<UiState<MileageData>> =
        combine(selection.selectedId, refreshTrigger) { selectedId, _ -> selectedId }
            .flatMapLatest { selectedId -> mileageFeed(selectedId) }
            .asUiState(isEmpty = { it.isEmpty })

    /** Re-collect all three cache-then-network feeds (the web query `refetch` / error-state retry). */
    fun refresh() {
        logger.info("mileage.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordMileagePageOpened(logger)
    }

    /**
     * The rendered feed for the active vehicle. The vehicles list resolves the active id (the explicit
     * [selectedId] when it is still enrolled, otherwise the first vehicle — web `vehicles?.[0]?.id`); a
     * resolved id switches the three mileage feeds, while a loading list stays loading, a list error
     * surfaces an error (retry), and an empty fleet resolves to the no-vehicle empty page — all without
     * issuing a bogus `vehicle_id=0` request from the view.
     */
    private fun mileageFeed(selectedId: Long?): Flow<Resource<MileageData>> =
        source.vehicles().flatMapLatest { vehiclesResource ->
            val activeId = resolveActiveId(selectedId, vehiclesResource.cached?.map { it.id }.orEmpty())
            if (activeId != null) {
                combine(
                    source.mileageStats(activeId.toString()),
                    source.dailyMileage(activeId.toString(), MileagePageRegistration.DAILY_DAYS),
                    source.monthlyMileage(activeId.toString()),
                ) { stats, daily, monthly -> combineResources(stats, daily, monthly) }
            } else {
                flowOf(noVehicleResource(vehiclesResource))
            }
        }

    /**
     * Resolves the active vehicle id: the explicit [selectedId] when it is still in [availableIds], otherwise
     * the first available vehicle (web default-to-first), or `null` when the fleet is empty.
     */
    private fun resolveActiveId(
        selectedId: Long?,
        availableIds: List<Long>,
    ): Long? {
        val usable = availableIds.filter { it > 0L }
        return when {
            selectedId != null && selectedId in usable -> selectedId
            else -> usable.firstOrNull()
        }
    }

    /**
     * Composes the stats (spine) + daily + monthly resources into one [Resource] of the combined payload,
     * mirroring the sibling surfaces: the stats feed dictates the phase + freshness, while daily + monthly
     * are read from whatever is cached so a still-loading / failed read never blanks the summary metrics.
     */
    private fun combineResources(
        stats: Resource<JsonElement>,
        daily: Resource<JsonElement>,
        monthly: Resource<JsonElement>,
    ): Resource<MileageData> {
        val data = MileageData.from(stats.cached, daily.cached, monthly.cached, vehicleResolved = true)
        return when {
            stats is Resource.Error && stats.cached == null ->
                Resource.Error(cached = null, fetchedAt = stats.fetchedAt, stale = stats.stale, error = stats.error)
            stats is Resource.Loading && stats.cached == null ->
                Resource.Loading(cached = null, fetchedAt = stats.fetchedAt, stale = stats.stale)
            stats is Resource.Loading ->
                Resource.Loading(cached = data, fetchedAt = stats.fetchedAt, stale = stats.stale)
            stats is Resource.Error ->
                Resource.Error(cached = data, fetchedAt = stats.fetchedAt, stale = true, error = stats.error)
            else ->
                Resource.Success(data = data, fetchedAt = (stats as Resource.Success).fetchedAt, stale = stats.stale)
        }
    }

    /**
     * Folds a vehicles feed that yields no usable vehicle onto the mileage surface: a list still loading
     * stays loading; a hard list error becomes a mileage error (retry); a resolved-but-empty fleet becomes a
     * no-vehicle empty payload so the page shows its friendly empty surface rather than spinning forever.
     */
    private fun noVehicleResource(resource: Resource<List<*>>): Resource<MileageData> =
        when (resource) {
            is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = null, stale = false)
            is Resource.Error ->
                Resource.Error(cached = null, fetchedAt = resource.fetchedAt, stale = resource.stale, error = resource.error)
            is Resource.Success ->
                Resource.Success(MileageData.EMPTY, fetchedAt = resource.fetchedAt, stale = false)
        }
}
