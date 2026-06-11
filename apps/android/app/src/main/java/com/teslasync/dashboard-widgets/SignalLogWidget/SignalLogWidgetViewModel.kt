// UI-thread-free state holder backing the Signal Log widget — the native port of the web component's hook
// composition (web/src/features/dashboard/widgets/SignalLogWidget.tsx). It binds the shared Vehicles +
// Telemetry feeds (P1/S8) through [SignalLogSource]: when no explicit vehicle is configured it resolves the
// default vehicle from the `useVehicles` list (web `vehicleId ?? vehicles?.[0]?.id ?? 0`), exposes that
// vehicle's cache-then-network observation feed as a lifecycle-aware [UiState] (the web `WidgetShell` is
// bound to `useSignalObservations`), and exposes the fleet-wide signals/sec [rate] the compact hero renders
// (web `useMQTTStatus`). It also exposes the single refresh action plus the PII-safe `view.opened`
// diagnostic. The pause/resume freeze is a pure render-layer concern (web `useState`), so it lives in the
// composable, not here. The view never performs HTTP — it only collects [state] / [rate] and calls
// [refresh] / [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SignalLogWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.signallog

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SignalObservationsParams
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.SignalObservation
import io.teslasync.shared.core.presentation.telemetry.TelemetryStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * @param source the cache-then-network Vehicles + Telemetry seam (a shared-data-layer adapter in
 *   production, a fake in tests). The view-model owns no networking — it only resolves the default vehicle
 *   and projects these feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param vehicleId the explicitly configured vehicle (web `WidgetProps.vehicleId`). When `null`/non-positive
 *   the first enrolled vehicle is used, exactly as the web `vehicles?.[0]?.id` fallback does.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SignalLogWidgetViewModel(
    private val source: SignalLogSource,
    logger: Logger,
    private val vehicleId: Long? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feeds (the web `refetch()` affordance), exactly
    // as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The resolved vehicle's observation feed as a lifecycle-aware [UiState]: loading / content / empty (no
     * observations) / stale / offline / error, carrying the freshness stamp + error kind. The empty branch
     * mirrors the web feed showing "No signal updates yet"; with no usable vehicle (list loading, empty, or
     * errored — the web's disabled-query branch) it resolves to an empty content surface rather than
     * spinning forever.
     */
    val state: StateFlow<UiState<List<SignalObservation>>> =
        refreshTrigger
            .flatMapLatest { observationsFeed() }
            .asUiState(isEmpty = { it.isEmpty() })

    /**
     * The fleet-wide signals/sec rate (web `useMQTTStatus` → `rate` `useMemo`): the sum of each streaming
     * vehicle's `signalsPerSecond`, the figure the compact hero renders. Independent of the resolved
     * vehicle and of the observation feed's lifecycle, exactly as the web calls `useMQTTStatus()`
     * unconditionally. Defaults to `0.0` until the first MQTT status arrives.
     */
    val rate: StateFlow<Double> =
        refreshTrigger
            .flatMapLatest { source.mqttStatus() }
            .map { SignalLogProjection.aggregateSignalRate(it.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = 0.0,
            )

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the freshness/error retry). */
    fun refresh() {
        logger.info("signalLog.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no signal name, value, or VIN payload, so a diagnostics line can never leak what the
     * vehicle reported. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to SignalLogRegistration.SLUG))
    }

    /**
     * The rendered observation feed: the explicit vehicle's observations when one is configured, otherwise
     * the first enrolled vehicle's observations resolved from the live vehicles list. With no usable vehicle
     * (list loading, empty, or errored — the web's `enabled: !!vehicleId` disabled-query branch) it emits an
     * empty content surface, all without ever issuing HTTP from the view.
     */
    private fun observationsFeed(): Flow<Resource<List<SignalObservation>>> {
        val explicit = vehicleId
        return if (explicit != null && explicit > 0L) {
            source.signalObservations(observationsParams(explicit))
        } else {
            source.vehicles().flatMapLatest { vehiclesResource ->
                val firstId = firstVehicleId(vehiclesResource.cached)
                if (firstId != null) source.signalObservations(observationsParams(firstId)) else emptyObservations()
            }
        }
    }

    private fun observationsParams(id: Long): SignalObservationsParams =
        SignalObservationsParams(vehicleId = id, limit = SignalLogRegistration.OBSERVATIONS_LIMIT)

    // The no-vehicle surface: an empty, never-fetched success so the widget shows its friendly empty state
    // (web disabled-query ⇒ empty feed). fetchedAt = 0 is suppressed by the header (it renders freshness
    // only for a stamp > 0), so the surface never claims a real fetch happened.
    private fun emptyObservations(): Flow<Resource<List<SignalObservation>>> =
        flowOf(Resource.Success(data = emptyList(), fetchedAt = NO_VEHICLE_FETCHED_AT, stale = false))

    /** The first enrolled vehicle's id, or `null` when the fleet list is absent or empty (web `vehicles?.[0]?.id`). */
    private fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }

    companion object {
        private const val NO_VEHICLE_FETCHED_AT = 0L

        /**
         * Wire the surface from the shared **S7** [VehiclesRepository] + [TelemetryRepository] — the cold
         * cache-then-network feeds where the refresh trigger re-subscribing performs a genuine re-fetch.
         */
        fun create(
            vehicles: VehiclesRepository,
            telemetry: TelemetryRepository,
            logger: Logger,
            vehicleId: Long? = null,
        ): SignalLogWidgetViewModel = SignalLogWidgetViewModel(signalLogSource(vehicles, telemetry), logger, vehicleId)

        /**
         * Wire the surface from the shared **S8** [VehiclesStore] + [TelemetryStore] — the memoized,
         * multi-observer feeds every Vehicles / Telemetry surface shares.
         */
        fun create(
            vehicles: VehiclesStore,
            telemetry: TelemetryStore,
            logger: Logger,
            vehicleId: Long? = null,
        ): SignalLogWidgetViewModel = SignalLogWidgetViewModel(signalLogSource(vehicles, telemetry), logger, vehicleId)
    }
}
