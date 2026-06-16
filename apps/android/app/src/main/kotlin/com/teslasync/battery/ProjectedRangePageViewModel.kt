// The state holder backing the ProjectedRangePage surface (P1/S8) — the native counterpart of the web page's React
// state + TanStack-Query hook (web/src/features/battery/pages/ProjectedRangePage.tsx). It projects the single
// cache-then-network read onto the shared lifecycle-aware [UiState] surface, scoped to the global active vehicle (web
// `useSelectedVehicle`), and derives the display formatter (distance + speed + temperature + energy units + locale)
// from the live `/settings` document (web `useUnits`). All decode/derivation logic lives in the framework-free model
// (ProjectedRangePageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// The feed re-collects whenever the selected vehicle changes or the refresh trigger bumps, and a no-projection /
// no-vehicle payload resolves to UiPhase.Empty via [RangeProjection.hasData] so the page shows its `empty` state (the
// web `!data` guard while the query is disabled for an empty selection), while a hard failure with no cache resolves to
// UiPhase.Error (the web `error` surface) and a first load to UiPhase.Loading (the web `isLoading` skeleton).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.projectedrange

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
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
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * @param source the P1/S8 data seam (the page-local projection repository + the shared Settings holder + the app-scoped
 *   active-vehicle selection in production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ProjectedRangePageViewModel(
    private val source: ProjectedRangePageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The active vehicle id (re-emitted on selection change or refresh) that scopes the per-vehicle read. */
    private val scopedVehicleId: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    /**
     * The `/analytics/range-projection` feed as cache-then-network UI state (web `data`). Re-collected when the active
     * vehicle changes or refresh bumps; a no-projection payload (or no selection — web `vehicleId == null` disabling the
     * query) resolves to the empty surface via [RangeProjection.hasData].
     */
    val projection: StateFlow<UiState<RangeProjection>> =
        scopedVehicleId
            .flatMapLatest { id -> id.activeId()?.let(source::rangeProjection) ?: emptyObjectFeed }
            .map { it.mapData(::parseRangeProjection) }
            .asUiState(isEmpty = { !it.hasData })

    /** The live display formatter (distance + speed + temperature + energy + locale), re-derived as settings change. */
    val displayPrefs: StateFlow<UnitFormatter> =
        source
            .settings()
            .map { resource -> UnitFormatter(UnitPreferences.fromSettings(resource.cached)) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = UnitFormatter.default(),
            )

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("range.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no vehicle id / capacity / range / temperature payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordProjectedRangeOpened(logger)
    }

    /** A positive selection as the `vehicle_id` string, or null when nothing is selected (web `vehicleId ? … : ''`). */
    private fun Long?.activeId(): String? = this?.takeIf { it > 0L }?.toString()

    private companion object {
        /** The synthetic "no selection" payload so a null scope resolves to the empty surface rather than a fetch. */
        private val emptyObjectFeed: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonObject(emptyMap()), 0L, false))
    }
}
