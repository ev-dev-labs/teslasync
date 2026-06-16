// The state holder backing the TirePressurePage surface (P1/S8) — the native counterpart of the web page's React state
// + the two TanStack-Query hooks (web/src/features/vehicle-systems/pages/TirePressurePage.tsx). It projects the two
// cache-then-network reads (`/tire-pressure/latest` + `/tire-pressure`) onto the shared lifecycle-aware [UiState]
// surface, scoped to the global active vehicle (web `useSelectedVehicle`), and derives the display preferences (the
// pressure unit + locale) from the live `/settings` document (web `useUnits`/`useFormatting`). All decode/derivation
// logic lives in the framework-free model (TirePressurePageModel.kt); this holder is the thin orchestration layer and
// performs no HTTP.
//
// The page phase follows the `latest` feed (web `loading={loadingLatest && !latest}` / `error={latestError}`): a
// first load with nothing cached is Loading, a hard failure with nothing cached is Error, otherwise the panels render.
// The combined snapshot carries the history list plus the history feed's own loading/error flags so the chart + table
// show their own internal loading / empty surfaces without the page ever hiding a section (ADR-011). A no-selection
// scope resolves to the empty snapshot kept as content, so the panels always render with their internal empty
// surfaces rather than a blank page — exactly like the web.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems.tirepressure

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

/**
 * @param source the P1/S8 data seam (the shared VehicleSystems + Settings holders + the app-scoped active-vehicle
 *   selection in production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TirePressurePageViewModel(
    private val source: TirePressurePageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The active vehicle id (re-emitted on selection change or refresh) that scopes the per-vehicle reads. */
    private val scopedVehicleId: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    /**
     * The combined `/tire-pressure/latest` + `/tire-pressure` feed as cache-then-network UI state. The page phase
     * follows the latest feed (web page-level loading/error); the snapshot carries the history list + its own
     * loading/error flags for the chart/table. A no-selection scope (web `activeVehicleId === null`) resolves to the
     * empty snapshot kept as content (`isEmpty = { false }`) so the panels always render.
     */
    val state: StateFlow<UiState<TirePressureSnapshot>> =
        scopedVehicleId
            .flatMapLatest { id ->
                val activeId = id.activeId() ?: return@flatMapLatest emptySnapshotFeed
                combine(
                    source.tirePressureLatest(activeId),
                    source.tirePressureHistory(activeId),
                ) { latestRes, historyRes ->
                    latestRes.mapData { latestJson ->
                        TirePressureSnapshot(
                            latest = parseTirePressureLatest(latestJson),
                            historyAsc = parseTirePressureHistory(historyRes.cached),
                            historyLoading = historyRes is Resource.Loading && historyRes.cached == null,
                            historyError = historyRes is Resource.Error,
                        )
                    }
                }
            }
            .asUiState(isEmpty = { false })

    /** The live display preferences (pressure unit + locale), re-derived as the settings document changes. */
    val displayPrefs: StateFlow<TireDisplayPrefs> =
        source
            .settings()
            .map { resource -> TireDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = TireDisplayPrefs.DEFAULT,
            )

    /** Re-runs the cache-then-network loads (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("tirePressure.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug, at most once per holder. Carries no
     * vehicle id / pressure figure payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordTirePressureOpened(logger)
    }

    /** A positive selection as the `vehicle_id` string, or null when nothing is selected (web disabled-query gate). */
    private fun Long?.activeId(): String? = this?.takeIf { it > 0L }?.toString()

    private companion object {
        /** The synthetic "no selection" feed so a null scope resolves to the empty snapshot rather than a fetch. */
        private val emptySnapshotFeed: Flow<Resource<TirePressureSnapshot>> =
            flowOf(Resource.Success(TirePressureSnapshot.EMPTY, fetchedAt = 0L, stale = false))
    }
}
