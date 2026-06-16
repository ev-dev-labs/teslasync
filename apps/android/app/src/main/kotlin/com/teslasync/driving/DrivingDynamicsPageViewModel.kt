// The state holder backing the DrivingDynamicsPage surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/driving/pages/DrivingDynamicsPage.tsx). It projects the
// five cache-then-network reads onto the shared lifecycle-aware [UiState] / derived-bundle surfaces, scoped to
// the global active vehicle (web `useSelectedVehicle`). All decode/derivation logic lives in the framework-free
// model (DrivingDynamicsPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// The primary feed is the `/motor/latest` read (web `motorLoading`): it re-collects whenever the selected vehicle
// changes or the refresh trigger bumps, and drives the page-level loading / error / content chrome. A null /
// no-vehicle scope folds to a no-snapshot success so the page renders its body with each panel's friendly empty
// state (the web disabled-query case), never a perpetual spinner. The four secondary feeds (motor history,
// drive-dynamics, drives, driving-coach) each fan out into the typed inputs the feature views read, so every
// panel renders its own content / empty surface without hiding a section (web per-section prop guards).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.driving.drivingdynamics

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.drivingcoachsection.DrivingCoachData
import io.teslasync.android.featureviews.livemotorstatus.MotorLive
import io.teslasync.android.featureviews.pedalusage.DriveDynamicsLive
import io.teslasync.shared.core.api.generated.Drive
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
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/**
 * @param source the P1/S8 data seam (the shared Vehicles holder + page-local Driving/Telemetry repositories + the
 *   app-scoped active-vehicle selection in production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DrivingDynamicsPageViewModel(
    private val source: DrivingDynamicsPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The active vehicle id (re-emitted on selection change or refresh) that scopes the per-vehicle reads. */
    private val scopedVehicleId: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    /** The raw active-vehicle selection (web `vehicleId`), threaded to the self-fetching G-Force + Autopilot panels. */
    val vehicleId: StateFlow<Long?> = source.selectedVehicleId()

    /** The autopilot sub-panel's data port (web `useVehicleState` + two `useSignalObservations`). */
    val autopilotSource = source.autopilotSource()

    /**
     * The primary `/motor/latest` snapshot as cache-then-network UI state (web `useMotorLatest`). Drives the
     * page-level loading / error / content chrome (web `loading={motorLoading}`). Re-collected on selection /
     * refresh; with no vehicle it folds to a no-snapshot content state so the page body renders its empty panels.
     * Never "empty" — an absent snapshot still renders the body (each panel shows its own empty state).
     */
    val motorState: StateFlow<UiState<MotorLive?>> =
        scopedVehicleId
            .flatMapLatest { id -> id.active()?.let(source::motorLatest) ?: nullJsonFeed }
            .map { it.mapData(::motorLiveOf) }
            .asUiState(isEmpty = { false })

    /** The `/drive-dynamics/latest` snapshot the PedalUsage panel reads (web `useDriveDynamicsLatest`). */
    val driveDynamics: StateFlow<DriveDynamicsLive?> =
        scopedVehicleId
            .flatMapLatest { id -> id.active()?.let(source::driveDynamicsLatest) ?: nullJsonFeed }
            .map { driveDynamicsOf(it.cached) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), null)

    /** The `/motor` history fanned out into the chart samples + the cross-section statistics (web `useMotorHistory`). */
    val motorHistory: StateFlow<MotorHistoryDerived> =
        scopedVehicleId
            .flatMapLatest { id -> id.active()?.let(source::motorHistory) ?: emptyArrayFeed }
            .map { deriveMotorHistory(it.cached) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), MotorHistoryDerived.EMPTY)

    /** The `/drives` list fanned out into the SpeedGearPanel speed samples + the DriveAnalyticsSection drives. */
    val drives: StateFlow<DrivesDerived> =
        scopedVehicleId
            .flatMapLatest { id -> id.activeStr()?.let(source::drives) ?: emptyDrivesFeed }
            .map { deriveDrives(it.cached) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), DrivesDerived.EMPTY)

    /** The `/analytics/driving-coach` report the DrivingCoachSection reads (web `useDrivingCoach`). */
    val coach: StateFlow<DrivingCoachData?> =
        scopedVehicleId
            .flatMapLatest { id -> id.activeStr()?.let(source::drivingCoach) ?: nullJsonFeed }
            .map { drivingCoachOf(it.cached) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), null)

    /** Re-runs every cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("drivingDynamics.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the page's hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id / motor / coach payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordDrivingDynamicsPageOpened(logger)
    }

    /** A positive selection, or null when nothing usable is selected (web `vehicleId > 0` enabled gate). */
    private fun Long?.active(): Long? = this?.takeIf { it > 0L }

    /** A positive selection as the `vehicle_id` string, or null when nothing is selected (web `vehicleId ? … : ''`). */
    private fun Long?.activeStr(): String? = active()?.toString()

    private companion object {
        /** The synthetic "no selection" payloads so a null scope folds to the empty surface rather than a fetch. */
        private val nullJsonFeed: Flow<Resource<JsonElement>> = flowOf(Resource.Success(JsonNull, 0L, false))
        private val emptyArrayFeed: Flow<Resource<JsonElement>> = flowOf(Resource.Success(JsonArray(emptyList()), 0L, false))
        private val emptyDrivesFeed: Flow<Resource<List<Drive>>> = flowOf(Resource.Success(emptyList(), 0L, false))
    }
}
