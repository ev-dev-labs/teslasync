// The state holder backing the BatteryDegradationPage surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/battery/pages/BatteryDegradationPage.tsx). It projects the
// two cache-then-network analytics reads onto the shared lifecycle-aware [UiState] surface, scoped to the global
// active vehicle (web `useSelectedVehicle`), and derives the display preferences (distance unit + locale +
// precision) from the live `/settings` document (web `useUnits`). All decode/derivation logic lives in the
// framework-free model (BatteryDegradationPageModel.kt); this holder is the thin orchestration layer and performs
// no HTTP.
//
// The primary feed is the battery-health read: it re-collects whenever the selected vehicle changes (a new
// `/analytics/battery-health?vehicle_id={id}` read) or the refresh trigger bumps, and an all-zero / no-vehicle
// payload resolves to the empty surface via [BatteryHealth.hasData] (web `data ?` truthiness). The secondary feed
// is the degradation read (prediction, projections, risk factors, recommendations, charging habits); it is its own
// lifecycle-aware [UiState] so every degradation-derived section renders its own loading / content / empty surface
// without ever hiding a section (web per-section truthiness guards).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.degradation

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
 * @param source the P1/S8 data seam (the shared Energy + Settings holders + the app-scoped active-vehicle
 *   selection in production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BatteryDegradationPageViewModel(
    private val source: BatteryDegradationPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The active vehicle id (re-emitted on selection change or refresh) that scopes the per-vehicle reads. */
    private val scopedVehicleId: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    /**
     * The primary `/analytics/battery-health` feed as cache-then-network UI state (web `useBatteryHealthAnalytics`).
     * Re-collected when the active vehicle changes or refresh bumps; an all-zero payload (or no selection — web
     * `enabled: !!vehicleId`) resolves to the empty surface.
     */
    val health: StateFlow<UiState<BatteryHealth>> =
        scopedVehicleId
            .flatMapLatest { id -> id.activeId()?.let(source::batteryHealthAnalytics) ?: emptyObjectFeed }
            .map { it.mapData(::parseBatteryHealth) }
            .asUiState(isEmpty = { !it.hasData })

    /**
     * The secondary `/analytics/battery-degradation` feed (web `useBatteryDegradation`) — empty when no prediction,
     * projection, risk, recommendation or habit data is present, so each derived section shows its own empty state.
     */
    val degradation: StateFlow<UiState<DegradationData>> =
        scopedVehicleId
            .flatMapLatest { id -> id.activeId()?.let(source::batteryDegradation) ?: emptyObjectFeed }
            .map { it.mapData(::parseDegradation) }
            .asUiState(isEmpty = { !it.hasData })

    /** The live display preferences (distance unit + locale + precision), re-derived as settings change. */
    val displayPrefs: StateFlow<BatteryDisplayPrefs> =
        source
            .settings()
            .map { resource -> BatteryDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = BatteryDisplayPrefs.DEFAULT,
            )

    /** Re-runs every cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("batteryDegradation.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id / SoH / capacity payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordBatteryDegradationOpened(logger)
    }

    /** A positive selection as the `vehicle_id` string, or null when nothing is selected (web `vehicleId ? … : ''`). */
    private fun Long?.activeId(): String? = this?.takeIf { it > 0L }?.toString()

    private companion object {
        /** The synthetic "no selection" payload so a null scope resolves to the empty surface rather than a fetch. */
        private val emptyObjectFeed: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonObject(emptyMap()), 0L, false))
    }
}
