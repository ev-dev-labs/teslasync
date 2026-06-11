// UI-thread-free state holder backing the Range Bar widget — the native port of the web component's hook
// composition (web/src/features/dashboard/widgets/RangeBarWidget.tsx). It binds the shared Vehicles feeds
// (P1/S8) through [RangeBarSource]: when no explicit vehicle is configured it resolves the default vehicle
// from the `useVehicles` list (web `vehicleId ?? vehicles?.[0]?.id ?? 0`), then projects the
// `useVehicleState` cache-then-network envelope onto the shared [UiState] surface (loading / content /
// empty / stale / offline / error). It exposes the single refresh action plus the PII-safe `view.opened`
// diagnostic. The view never performs HTTP — it only collects [state] and calls [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/RangeBarWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.rangebar

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
import kotlinx.coroutines.flow.update

/**
 * @param source the cache-then-network Vehicles seam (a shared-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only resolves the default vehicle and projects the state.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param vehicleId the explicitly configured vehicle (web `WidgetProps.vehicleId`). When `null`/non-positive
 *   the first enrolled vehicle is used, exactly as the web `vehicles?.[0]?.id` fallback does.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RangeBarWidgetViewModel(
    private val source: RangeBarSource,
    logger: Logger,
    private val vehicleId: Long? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly
    // as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The vehicle-state envelope as a lifecycle-aware [UiState]: loading / content / empty / stale /
     * offline / error, carrying the freshness stamp + error kind. Empty mirrors the web `hasData` gate
     * (`state == null` OR both ranges zero) so a present-but-zero state shows the friendly empty surface
     * rather than two empty bars.
     */
    val state: StateFlow<UiState<VehicleStateEnvelope>> =
        refreshTrigger
            .flatMapLatest { stateFeed() }
            .asUiState(isEmpty = { !parseRangeState(it.state).hasData })

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("rangeBar.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no range / vehicle payload, so a diagnostics line can never leak the vehicle's
     * range. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to RangeBarRegistration.SLUG))
    }

    /**
     * The rendered feed: the explicit vehicle's state when one is configured, otherwise the first enrolled
     * vehicle's state resolved from the live vehicles list. While the list is loading (no cached vehicle)
     * the surface stays in loading; an empty list resolves to an empty state (no vehicle ⇒ "No range
     * data"); a list error with no cache surfaces as an error — all without ever issuing HTTP from the view.
     */
    private fun stateFeed(): Flow<Resource<VehicleStateEnvelope>> {
        val explicit = vehicleId
        return if (explicit != null && explicit > 0L) {
            source.vehicleState(explicit)
        } else {
            source.vehicles().flatMapLatest { vehiclesResource ->
                val firstId = vehiclesResource.cached?.firstOrNull()?.id
                if (firstId != null && firstId > 0L) {
                    source.vehicleState(firstId)
                } else {
                    flowOf(noVehicleResource(vehiclesResource))
                }
            }
        }
    }

    /**
     * Folds a vehicles feed that yields no usable vehicle onto the state surface: a list still loading stays
     * loading; a hard list error becomes a state error (retry); a resolved-but-empty list becomes a
     * `state == null` success so the widget shows its friendly empty state rather than spinning forever.
     */
    private fun noVehicleResource(resource: Resource<List<Vehicle>>): Resource<VehicleStateEnvelope> =
        when (resource) {
            is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = null, stale = false)
            is Resource.Error ->
                Resource.Error(cached = null, fetchedAt = resource.fetchedAt, stale = resource.stale, error = resource.error)
            is Resource.Success ->
                Resource.Success(EMPTY_STATE, fetchedAt = resource.fetchedAt, stale = false)
        }

    private companion object {
        /** The "no decodable state" envelope, surfaced when no vehicle resolves (web `state: undefined`). */
        val EMPTY_STATE = VehicleStateEnvelope(state = null, live = false)
    }
}
