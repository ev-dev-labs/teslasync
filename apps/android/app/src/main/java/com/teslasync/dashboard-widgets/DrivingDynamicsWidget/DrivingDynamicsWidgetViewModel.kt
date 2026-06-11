// UI-thread-free state holder backing the Driving Dynamics widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/DrivingDynamicsWidget.tsx). It binds
// the shared data feeds (P1/S8) through [DrivingDynamicsSource]: when no explicit vehicle is configured
// it resolves the default vehicle from the `useVehicles` list (web `vehicleId ?? vehicles?.[0]?.id`),
// then combines the primary `useDrivingDynamics` feed with the supplementary
// `useAccelerationDistribution` feed and projects the result onto the shared [UiState] surface (loading
// / content / empty / stale / offline / error). It exposes the single refresh action plus the PII-safe
// `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and calls
// [refresh]/[retry]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DrivingDynamicsWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.drivingdynamics

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/**
 * @param source the cache-then-network seam (a shared-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only resolves the default vehicle and projects the
 *   feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param vehicleId the explicitly configured vehicle (web `WidgetProps.vehicleId`). When `null`/non-
 *   positive the first enrolled vehicle is used, exactly as the web `vehicles?.[0]?.id` fallback does.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DrivingDynamicsWidgetViewModel(
    private val source: DrivingDynamicsSource,
    logger: Logger,
    private val vehicleId: Long? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feeds (the manual refetch affordance),
    // exactly as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The combined dynamics + distribution payload as cache-then-network UI state (loading / content /
     * empty / stale / offline / error), carrying the freshness stamp + error kind. Empty mirrors the
     * web `dynamics ? … : <EmptyState/>` gate — a bundle whose dynamics payload is not a JSON object
     * (no resolved vehicle ⇒ a synthetic `JsonNull`) is the empty surface.
     */
    val state: StateFlow<UiState<DrivingDynamicsBundle>> =
        refreshTrigger
            .flatMapLatest { feed() }
            .asUiState(isEmpty = { it.dynamics !is JsonObject })

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("drivingDynamics.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no g-force / vehicle payload, so a diagnostics line can never leak driving
     * behaviour. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to DrivingDynamicsRegistration.SLUG))
    }

    /**
     * The rendered feed: the explicit vehicle's dynamics + distribution when one is configured,
     * otherwise the first enrolled vehicle's, resolved from the live vehicles list. While the list is
     * loading (no cached vehicle) the surface stays in loading; an empty list resolves to a synthetic
     * empty bundle (no vehicle ⇒ "No dynamics data") rather than issuing a bogus `vehicle_id=0`
     * request; a list error with no cache surfaces as an error — all without ever issuing HTTP from the
     * view.
     */
    private fun feed(): Flow<Resource<DrivingDynamicsBundle>> {
        val explicit = vehicleId
        return if (explicit != null && explicit > 0L) {
            combined(explicit.toString())
        } else {
            source.vehicles().flatMapLatest { vehiclesResource ->
                val firstId = vehiclesResource.cached?.firstOrNull()?.id
                if (firstId != null && firstId > 0L) {
                    combined(firstId.toString())
                } else {
                    flowOf(noVehicleResource(vehiclesResource))
                }
            }
        }
    }

    /** Combine the primary dynamics feed with the supplementary distribution feed for one vehicle. */
    private fun combined(id: String): Flow<Resource<DrivingDynamicsBundle>> =
        combine(source.drivingDynamics(id), source.accelerationDistribution(id)) { dyn, dist ->
            combineDrivingDynamics(dyn, dist)
        }

    /**
     * Folds a vehicles feed that yields no usable vehicle onto the bundle surface: a list still loading
     * stays loading; a hard list error becomes a bundle error (retry); a resolved-but-empty list
     * becomes a synthetic empty bundle (a `JsonNull` dynamics payload) so the widget shows its friendly
     * empty state rather than spinning forever.
     */
    private fun noVehicleResource(resource: Resource<List<*>>): Resource<DrivingDynamicsBundle> =
        when (resource) {
            is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = resource.fetchedAt, stale = resource.stale)
            is Resource.Error ->
                Resource.Error(cached = null, fetchedAt = resource.fetchedAt, stale = resource.stale, error = resource.error)
            is Resource.Success ->
                Resource.Success(EMPTY_BUNDLE, fetchedAt = resource.fetchedAt, stale = false)
        }

    private companion object {
        /** The "no resolved vehicle" bundle (web `dynamics: undefined`): a non-object dynamics ⇒ empty state. */
        val EMPTY_BUNDLE: DrivingDynamicsBundle = DrivingDynamicsBundle(dynamics = JsonNull, distribution = null)
    }
}
