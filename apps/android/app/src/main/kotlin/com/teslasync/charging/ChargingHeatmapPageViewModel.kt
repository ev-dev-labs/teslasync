// The state holder backing the ChargingHeatmapPage surface (P1/S8) — the native counterpart of the web page's React
// state + TanStack-Query hook (web/src/features/charging/pages/ChargingHeatmapPage.tsx). It projects the single
// cache-then-network read onto the shared lifecycle-aware [UiState] surface, scoped to the global active vehicle (web
// `useSelectedVehicle`), and derives the display preferences (energy/duration units + precision + locale) from the live
// `/settings` document (web `useUnits`). All decode/derivation logic lives in the framework-free model
// (ChargingHeatmapPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// The feed re-collects whenever the selected vehicle changes or the refresh trigger bumps; a no-selection scope resolves
// to the empty surface (web `vehicleId ? … : ''`) rather than a fetch, and an empty session list resolves to UiPhase.Empty
// so the page shows its empty state while still drawing every panel. The web page's optional date `RangePicker` resolves
// to its default `all` preset (undefined start/end → the whole history); that picker is a separate shared surface outside
// this page's allowed-files scope, so the feed reads the same all-time window the web's default state requests
// (Honesty Covenant #9 — documented, not silent).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.chargingheatmap

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.ChargingSession
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
 * @param source the P1/S8 data seam (the shared Charging repository + Settings holder + the app-scoped active-vehicle
 *   selection in production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChargingHeatmapPageViewModel(
    private val source: ChargingHeatmapPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The active vehicle id (re-emitted on selection change or refresh) that scopes the paginated read. */
    private val scopedVehicleId: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    /**
     * The paginated `/charging` feed as cache-then-network UI state (web `useChargingSessionsPaginated`). Re-collected
     * when the active vehicle changes or refresh bumps; no selection (web `vehicleId == ''`) or an empty list resolves
     * to the empty surface so the page draws every panel in its empty form rather than hiding a section.
     */
    val sessions: StateFlow<UiState<List<ChargingSession>>> =
        scopedVehicleId
            .flatMapLatest { id ->
                id.positiveId()?.let { source.chargingSessionsPaginated(it, RANGE_START, RANGE_END) } ?: emptySessionsFeed
            }.asUiState(isEmpty = { it.isEmpty() })

    /** The live display preferences (energy/duration units + precision + locale), re-derived as settings change. */
    val displayPrefs: StateFlow<ChargingHeatmapDisplayPrefs> =
        source
            .settings()
            .map { resource -> ChargingHeatmapDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = ChargingHeatmapDisplayPrefs.DEFAULT,
            )

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("charging.heatmap.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no vehicle id / session / location payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordChargingHeatmapOpened(logger)
    }

    /** A positive selection, or null when nothing is selected (web `vehicleId ? … : ''`). */
    private fun Long?.positiveId(): Long? = this?.takeIf { it > 0L }

    private companion object {
        /** The web default `all` range preset reads the whole history (undefined start/end). */
        private val RANGE_START: String? = null
        private val RANGE_END: String? = null

        /** The "no selection" payload so a null scope resolves to the empty surface rather than a fetch. */
        private val emptySessionsFeed: Flow<Resource<List<ChargingSession>>> =
            flowOf(Resource.Success(emptyList<ChargingSession>(), 0L, false))
    }
}
