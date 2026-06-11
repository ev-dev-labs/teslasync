// UI-thread-free state holder backing the Vehicle Hero Card widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/VehicleHeroCardWidget.tsx). It binds
// the shared Vehicles feeds (P1/S8) through [VehicleHeroCardSource]: it resolves the rendered vehicle
// from the `useVehicles` list (web `vehicleId ? vehicles?.find(...) ?? vehicles?.[0] : vehicles?.[0]`),
// then folds the `useVehicleState` cache-then-network envelope onto the shared [UiState] surface
// (loading / content / empty / stale / offline / error). It exposes the single refresh action plus the
// PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and calls
// [refresh] / [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/VehicleHeroCardWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.vehicleherocard

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
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * @param source the cache-then-network Vehicles seam (a shared-data-layer adapter in production, a fake
 *   in tests). The view-model owns no networking — it only resolves the vehicle and folds the state.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param vehicleId the explicitly configured vehicle (web `WidgetProps.vehicleId`). When `null`/non-positive
 *   the first enrolled vehicle is used; an id not present in the list falls back to the first, exactly as
 *   the web `vehicles?.find(...) ?? vehicles?.[0]` resolution does.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleHeroCardWidgetViewModel(
    private val source: VehicleHeroCardSource,
    logger: Logger,
    private val vehicleId: Long? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance),
    // exactly as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The render payload as a lifecycle-aware [UiState]: loading / content / empty (no enrolled
     * vehicle) / stale / offline / error, carrying the freshness stamp + error kind. Empty mirrors the
     * web `vehicle ? … : <EmptyState/>` gate (`vehicle == null`).
     */
    val state: StateFlow<UiState<VehicleHeroCardData>> =
        refreshTrigger
            .flatMapLatest { feed() }
            .asUiState(isEmpty = { it.vehicle == null })

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("vehicleHeroCard.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no battery level / range / location payload, so a diagnostics line can never leak
     * the vehicle's state. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to VehicleHeroCardRegistration.SLUG))
    }

    /**
     * The rendered feed: resolve the vehicle from the live vehicles list (the source of name / model /
     * trim, needed at every footprint), then fold that vehicle's state envelope onto the payload. While
     * the list is loading with no cache the surface stays in loading; an empty/unmatched list resolves
     * to the empty state ("No vehicle data"); a list error with no cache surfaces as an error — all
     * without ever issuing HTTP from the view.
     */
    private fun feed(): Flow<Resource<VehicleHeroCardData>> =
        source.vehicles().flatMapLatest { vehiclesResource ->
            val vehicle = resolveVehicle(vehiclesResource.cached, vehicleId)
            if (vehicle != null) {
                source.vehicleState(vehicle.id).map { stateResource -> combine(vehicle, stateResource) }
            } else {
                flowOf(noVehicleResource(vehiclesResource))
            }
        }

    /**
     * Resolve the rendered vehicle from the [list] (web `vehicleId ? vehicles?.find(...) ?? vehicles?.[0]
     * : vehicles?.[0]`): an explicit positive [id] picks that vehicle, falling back to the first when it
     * is not in the list; otherwise the first enrolled vehicle. `null` when nothing is enrolled yet.
     */
    private fun resolveVehicle(
        list: List<Vehicle>?,
        id: Long?,
    ): Vehicle? =
        list?.takeIf { it.isNotEmpty() }?.let { vehicles ->
            if (id != null && id > 0L) {
                vehicles.firstOrNull { it.id == id } ?: vehicles.first()
            } else {
                vehicles.first()
            }
        }

    /**
     * Folds the per-vehicle state [stateResource] onto the render payload, always carrying the resolved
     * [vehicle]. A state error is intentionally surfaced as a cache-bearing [Resource.Error] (the card
     * stays visible with last-known/fallback values + a freshness error chip), never as a hard error
     * screen — the web `VehicleHeroCardWidget` passes `isError` to the freshness header but never the
     * blocking `error` chrome, so the hero card never blanks while a vehicle is enrolled.
     */
    private fun combine(
        vehicle: Vehicle,
        stateResource: Resource<VehicleStateEnvelope>,
    ): Resource<VehicleHeroCardData> =
        when (stateResource) {
            is Resource.Loading ->
                stateResource.cached?.let { env ->
                    Resource.Loading(VehicleHeroCardData(vehicle, env.state), stateResource.fetchedAt, stateResource.stale)
                } ?: Resource.Loading(cached = null, fetchedAt = stateResource.fetchedAt, stale = stateResource.stale)

            is Resource.Success ->
                Resource.Success(VehicleHeroCardData(vehicle, stateResource.data.state), stateResource.fetchedAt, stale = false)

            is Resource.Error ->
                Resource.Error(
                    cached = VehicleHeroCardData(vehicle, stateResource.cached?.state),
                    fetchedAt = stateResource.fetchedAt,
                    stale = true,
                    error = stateResource.error,
                )
        }

    /**
     * Folds a vehicles feed that yields no usable vehicle onto the surface: a list still loading stays
     * loading; a hard list error becomes a surface error (retry); a resolved-but-empty/unmatched list
     * becomes a `vehicle == null` success so the widget shows its friendly empty state rather than
     * spinning forever.
     */
    private fun noVehicleResource(resource: Resource<List<Vehicle>>): Resource<VehicleHeroCardData> =
        when (resource) {
            is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = null, stale = false)
            is Resource.Error ->
                Resource.Error(cached = null, fetchedAt = resource.fetchedAt, stale = resource.stale, error = resource.error)

            is Resource.Success ->
                Resource.Success(VehicleHeroCardData(vehicle = null, state = null), fetchedAt = resource.fetchedAt, stale = false)
        }
}
