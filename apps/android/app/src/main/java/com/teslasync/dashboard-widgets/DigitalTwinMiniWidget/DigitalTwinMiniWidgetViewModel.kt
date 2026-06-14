// UI-thread-free state holder backing the Digital Twin Mini widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/DigitalTwinMiniWidget.tsx). It binds
// the shared vehicles + per-vehicle state / security / charging feeds (P1/S8) through
// [DigitalTwinMiniSource]: it resolves the rendered vehicle from the `useVehicles` list, then combines
// the three cache-then-network telemetry feeds onto the shared [UiState] surface (loading / content /
// empty / stale / offline / error). The lifecycle + freshness follow the `useVehicleState` feed — the
// web `WidgetShell` binds its freshness header to `useVehicleState` and its loading skeleton to
// `secLoading || stateLoading` — while a failed state refresh keeps the twin visible (the web never
// passes `WidgetShell`'s blocking `error` prop). It exposes the single refresh action plus the PII-safe
// `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and calls
// [refresh] / [retry] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DigitalTwinMiniWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.digitaltwinmini

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
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
 * @param source the cache-then-network vehicles + state / security / charging seam (a shared-data-layer
 *   adapter in production, a fake in tests). The view-model owns no networking — it only resolves the
 *   vehicle and folds the feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param vehicleId the widget's bound vehicle (web `WidgetProps.vehicleId`); `null`/non-positive defaults
 *   to the first enrolled vehicle, falling back to the first when the id is not enrolled.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DigitalTwinMiniWidgetViewModel(
    private val source: DigitalTwinMiniSource,
    logger: Logger,
    private val vehicleId: Long? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects every cache-then-network feed (the manual refetch affordance),
    // exactly as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The render payload as a lifecycle-aware [UiState]: loading / content / empty (no enrolled vehicle)
     * / stale / offline / error, carrying the freshness stamp + error kind. Empty mirrors the web
     * `vehicle ? … : <EmptyState/>` gate (`vehicle == null`).
     */
    val state: StateFlow<UiState<DigitalTwinMiniData>> =
        refreshTrigger
            .flatMapLatest { feed() }
            .asUiState(isEmpty = ::isDigitalTwinMiniEmpty)

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("digitalTwinMini.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no lock / sentry / door / charge payload, so a diagnostics line can never leak the
     * vehicle's physical state. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to DigitalTwinMiniRegistration.SLUG))
    }

    /**
     * The rendered feed: resolve the vehicle from the live vehicles list (the source of identity + the
     * exterior colour the paint is inferred from), then combine that vehicle's state / security / charging
     * feeds into the twin payload. An empty/unmatched list resolves to the empty state; a list error with
     * no cache surfaces as an error — all without ever issuing HTTP from the view.
     */
    private fun feed(): Flow<Resource<DigitalTwinMiniData>> =
        source.vehicles().flatMapLatest { vehiclesResource ->
            val vehicle = resolveVehicle(vehiclesResource.cached, vehicleId)
            if (vehicle != null) {
                combine(
                    source.vehicleState(vehicle.id),
                    source.security(vehicle.id),
                    source.charging(vehicle.id),
                ) { stateRes, securityRes, chargingRes ->
                    merge(vehicle, stateRes, securityRes, chargingRes)
                }
            } else {
                flowOf(noVehicleResource(vehiclesResource))
            }
        }

    /**
     * Folds the three per-vehicle feeds onto the render payload, always carrying the resolved [vehicle].
     * The loading skeleton is shown while the state OR security feed is on its first load with no cache
     * (web `isLoading = secLoading || stateLoading`); otherwise the lifecycle + freshness follow the
     * `useVehicleState` feed: a success is fresh, a refresh-in-flight keeps the cached twin, and a failure
     * keeps the twin visible as a stale/offline card with a retry (web never blanks while a vehicle is
     * enrolled). The charging feed is non-blocking — only its cached value is read.
     */
    private fun merge(
        vehicle: Vehicle,
        stateRes: Resource<VehicleStateEnvelope>,
        securityRes: Resource<JsonElement>,
        chargingRes: Resource<JsonElement>,
    ): Resource<DigitalTwinMiniData> {
        val data =
            DigitalTwinMiniData(
                vehicle = vehicle,
                vehicleState = stateRes.cached?.state,
                security = securityRes.cached,
                charging = chargingRes.cached,
            )
        if (isFirstLoad(stateRes) || isFirstLoad(securityRes)) {
            return Resource.Loading(cached = null, fetchedAt = null, stale = false)
        }
        return when (stateRes) {
            is Resource.Success -> Resource.Success(data, stateRes.fetchedAt, stale = false)
            is Resource.Loading -> Resource.Loading(data, stateRes.fetchedAt, stateRes.stale)
            is Resource.Error -> Resource.Error(cached = data, fetchedAt = stateRes.fetchedAt, stale = true, error = stateRes.error)
        }
    }

    /** True while a feed is on its first load with nothing cached to show (web query `isLoading`). */
    private fun isFirstLoad(resource: Resource<*>): Boolean = resource is Resource.Loading && resource.cached == null

    /**
     * Folds a vehicles feed that yields no usable vehicle onto the surface: a list still loading stays
     * loading; a hard list error becomes a surface error (retry); a resolved-but-empty/unmatched list
     * becomes a `vehicle == null` success so the widget shows its friendly empty state ("No vehicle
     * data") rather than spinning forever.
     */
    private fun noVehicleResource(resource: Resource<List<Vehicle>>): Resource<DigitalTwinMiniData> =
        when (resource) {
            is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = null, stale = false)
            is Resource.Error ->
                Resource.Error(cached = null, fetchedAt = resource.fetchedAt, stale = resource.stale, error = resource.error)

            is Resource.Success ->
                Resource.Success(
                    DigitalTwinMiniData(vehicle = null, vehicleState = null, security = null, charging = null),
                    fetchedAt = resource.fetchedAt,
                    stale = false,
                )
        }

    companion object {
        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: DigitalTwinMiniSource,
            logger: Logger,
            vehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { DigitalTwinMiniWidgetViewModel(source, logger, vehicleId) }
            }
    }
}
