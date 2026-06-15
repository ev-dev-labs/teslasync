// The state holder backing the TemperatureImpactPage maps surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hook (web/src/features/maps/pages/TemperatureImpactPage.tsx). It projects the inline
// `/analytics/temperature-impact` read onto the shared lifecycle-aware [UiState] surface, scoped to the global active
// vehicle (web `useSelectedVehicle`), and derives the live display preferences from the `/settings` document (web
// `useUnits`). All decode/derivation logic lives in the framework-free model (TemperatureImpactPageModel.kt); this
// holder is the thin orchestration layer and performs no HTTP.
//
// The points feed re-collects whenever the active vehicle changes or the refresh trigger bumps. With no vehicle
// selected the web query is disabled (`enabled: vehicleId !== ''`), so a null selection resolves to an empty success
// (the synthetic [emptyPointsFeed]) → UiPhase.Empty rather than a perpetual spinner; a loaded payload with no points
// is likewise empty (web `!points?.length`). The loaded body folds the points through the framework-free model
// (deriveTemperatureStats / scatterPoints / temperatureTips) at the render boundary.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.maps.temperatureimpact

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
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * @param source the P1/S8 data seam (the shared resilient client + the app-scoped active-vehicle selection + the
 *   shared settings holder in production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TemperatureImpactPageViewModel(
    private val source: TemperatureImpactPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The decoded `points[]` as cache-then-network UI state (web `useQuery` ▸ `/analytics/temperature-impact`).
     * Re-collected when the active vehicle changes or refresh bumps; a null selection (web `enabled: vehicleId !==
     * ''`) or an empty payload resolves to the empty surface so the body shows its empty-state fallbacks rather than a grid
     * of zeros.
     */
    val pointsState: StateFlow<UiState<List<TempEfficiencyPoint>>> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }
            .flatMapLatest { id ->
                val vehicleId = id?.takeIf { it > 0L }?.toString()
                if (vehicleId == null) emptyPointsFeed else source.temperatureImpact(vehicleId)
            }
            .map { resource -> resource.mapData(::parseTemperatureImpact) }
            .asUiState(isEmpty = { it.isEmpty() })

    /** The live display preferences derived from the settings document (web `useUnits`). Falls back to metric/2dp. */
    val displayPrefs: StateFlow<TemperatureDisplayPrefs> =
        source
            .settings()
            .map { resource -> TemperatureDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = TemperatureDisplayPrefs.DEFAULT,
            )

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("temperatureImpact.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id / temperature / efficiency payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordTemperatureImpactPageOpened(logger)
    }

    private companion object {
        /** The synthetic "no selection" payload so a null scope resolves to the empty surface rather than a fetch. */
        private val emptyPointsFeed: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonObject(emptyMap()), 0L, false))
    }
}
