// UI-thread-free state holder backing the Vehicle Hero widget — the native port of the web widget's hook
// composition (web/src/features/dashboard/widgets/VehicleHeroWidget.tsx). It binds the shared Vehicles feeds
// (P1/S8) and the app-scoped live session (ADR-009) through [VehicleHeroWidgetSource]: it resolves the
// rendered vehicle from the `useVehicles` list (web `vehicleId ? vehicles?.find(...) ?? vehicles?.[0] :
// vehicles?.[0]`), folds the `useVehicleState` cache-then-network envelope, and resolves the firmware string
// from the `useVehicleLive` signals (web `live.version || live.swUpdateVersion || state.software_version ||
// '\u2014'`) onto the shared [UiState] surface (loading / content / empty / stale / offline / error). It
// exposes the single refresh action plus the PII-safe `view.opened` diagnostic. The view never performs
// HTTP/SSE — it only collects [state] and calls [refresh] / [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/VehicleHeroWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.vehiclehero

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.vehiclehero.VehicleHeroData
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

/**
 * @param source the cache-then-network Vehicles + live seam (a shared-data-layer adapter in production, a
 *   fake in tests). The view-model owns no networking — it only resolves the vehicle and folds the feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param vehicleId the explicitly configured vehicle (web `WidgetProps.vehicleId`). When `null`/non-positive
 *   the first enrolled vehicle is used; an id not present in the list falls back to the first, exactly as the
 *   web `vehicles?.find(...) ?? vehicles?.[0]` resolution does.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleHeroWidgetViewModel(
    private val source: VehicleHeroWidgetSource,
    logger: Logger,
    private val vehicleId: Long? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly as
    // the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The render payload as a lifecycle-aware [UiState]: loading / content / empty (no enrolled vehicle) /
     * stale / offline / error, carrying the freshness stamp + error kind. Empty mirrors the web parent
     * `{vehicle && <VehicleHero/>}` gate (`vehicle == null`).
     */
    val state: StateFlow<UiState<VehicleHeroData>> =
        refreshTrigger
            .flatMapLatest { feed() }
            .asUiState(isEmpty = { it.vehicle == null })

    /** Re-runs the cache-then-network load (the web `useVehicleState().refetch()` + the error-surface retry). */
    fun refresh() {
        logger.info("vehicleHeroWidget.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no battery level / range / location / firmware payload, so a diagnostics line can never leak the
     * vehicle's state. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to VehicleHeroWidgetRegistration.SLUG))
    }

    /**
     * The rendered feed: resolve the vehicle from the live vehicles list (the source of name / model / trim,
     * needed even while asleep), then fold that vehicle's state envelope + live firmware onto the payload.
     * While the list is loading with no cache the surface stays in loading; an empty/unmatched list resolves
     * to the empty state; a list error with no cache surfaces as an error — all without ever issuing HTTP/SSE
     * from the view.
     */
    private fun feed(): Flow<Resource<VehicleHeroData>> =
        source.vehicles().flatMapLatest { vehiclesResource ->
            val vehicle = resolveVehicle(vehiclesResource.cached, vehicleId)
            if (vehicle != null) {
                combine(source.vehicleState(vehicle.id), source.liveFirmware(vehicle.id)) { stateResource, live ->
                    fold(vehicle, stateResource, live)
                }
            } else {
                flowOf(noVehicleResource(vehiclesResource))
            }
        }

    /**
     * Resolve the rendered vehicle from the [list] (web `vehicleId ? vehicles?.find(...) ?? vehicles?.[0] :
     * vehicles?.[0]`): an explicit positive [id] picks that vehicle, falling back to the first when it is not
     * in the list; otherwise the first enrolled vehicle. `null` when nothing is enrolled yet.
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
     * Folds the per-vehicle state [stateResource] + the [live] firmware onto the render payload, always
     * carrying the resolved [vehicle]. The firmware reproduces the web `live.version || live.swUpdateVersion
     * || state.software_version || '\u2014'` chain. A state error is intentionally surfaced as a cache-bearing
     * [Resource.Error] (the hero stays visible with last-known/asleep values + a freshness error chip), never
     * a hard error screen — the web widget passes `isError` to the freshness header but never the blocking
     * `error` chrome, so the hero never blanks while a vehicle is enrolled.
     */
    private fun fold(
        vehicle: Vehicle,
        stateResource: Resource<VehicleStateEnvelope>,
        live: LiveFirmware,
    ): Resource<VehicleHeroData> {
        fun payload(envelope: VehicleStateEnvelope?): VehicleHeroData =
            VehicleHeroData(
                vehicle = vehicle,
                state = envelope?.state,
                firmwareVersion = resolveFirmwareVersion(live, envelope?.state),
            )
        return when (stateResource) {
            is Resource.Loading ->
                stateResource.cached?.let { env ->
                    Resource.Loading(payload(env), stateResource.fetchedAt, stateResource.stale)
                } ?: Resource.Loading(cached = null, fetchedAt = stateResource.fetchedAt, stale = stateResource.stale)

            is Resource.Success ->
                Resource.Success(payload(stateResource.data), stateResource.fetchedAt, stale = false)

            is Resource.Error ->
                Resource.Error(
                    cached = payload(stateResource.cached),
                    fetchedAt = stateResource.fetchedAt,
                    stale = true,
                    error = stateResource.error,
                )
        }
    }

    /**
     * Folds a vehicles feed that yields no usable vehicle onto the surface: a list still loading stays
     * loading; a hard list error becomes a surface error (retry); a resolved-but-empty/unmatched list becomes
     * a `vehicle == null` success so the widget shows its friendly empty state rather than spinning forever.
     */
    private fun noVehicleResource(resource: Resource<List<Vehicle>>): Resource<VehicleHeroData> =
        when (resource) {
            is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = null, stale = false)
            is Resource.Error ->
                Resource.Error(cached = null, fetchedAt = resource.fetchedAt, stale = resource.stale, error = resource.error)

            is Resource.Success ->
                Resource.Success(emptyPayload(), fetchedAt = resource.fetchedAt, stale = false)
        }

    /** The `vehicle == null` empty payload — the friendly "no vehicle" surface (web empty gate). */
    private fun emptyPayload(): VehicleHeroData =
        VehicleHeroData(vehicle = null, state = null, firmwareVersion = VEHICLE_HERO_WIDGET_EM_DASH)
}
