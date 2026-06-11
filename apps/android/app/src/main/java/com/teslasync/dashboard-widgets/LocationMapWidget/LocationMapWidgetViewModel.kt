// UI-thread-free state holder backing the Vehicle Location Map widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/LocationMapWidget.tsx). It binds the
// shared cache-then-network [LocationMapSource] (P1/S8), projects each emission onto the shared
// [UiState] surface (loading / content / empty / stale / offline / error), and exposes the single
// refresh action plus the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only
// collects [state] and calls [refresh] / [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/LocationMapWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.locationmap

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [LocationMapWidget]. It consumes the
 * cache-then-network [LocationMapSource] (P1/S8) and re-shares it as a single [UiState] stream via
 * [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that only renders. A
 * reading with no fix — a `null` value (no vehicle / no state resolved) OR a present reading whose
 * coordinates are `0,0` — maps to the empty surface, exactly the web combined `!hasCoords` "No location
 * data available" gate; a reading with real coordinates maps to content (the map).
 *
 * It owns no networking. [refresh] re-collects the source (the web `refetch`) and [recordViewOpened]
 * emits the one-shot `view.opened` diagnostics event with the surface [LocationMapRegistration.SLUG]
 * (P1/S11).
 *
 * @param source the cache-then-network latest-state seam (a shared-data-layer adapter in production, a
 *   fake in tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LocationMapWidgetViewModel(
    source: LocationMapSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance).
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The latest location reading as cache-then-network UI state: loading / content (a real fix) /
     * empty (no vehicle, no state, or a `0,0` fix) / stale / offline / error, carrying the freshness
     * stamp + error kind. Empty mirrors the web combined `!hasCoords` gate.
     */
    val state: StateFlow<UiState<VehicleLocationData?>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .asUiState(isEmpty = { it == null || !it.hasCoords })

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("locationMap.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no coordinates, heading or vehicle id, so a diagnostics line can never leak a
     * vehicle's location. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to LocationMapRegistration.SLUG))
    }

    companion object {
        /**
         * Wire the surface from the shared [VehiclesStore] (P1/S8) and the app-wide active-vehicle
         * selection ([activeVehicleId], typically `SelectedVehicleStore.selectedId`). An explicit
         * [vehicleId] overrides the active selection (web `vehicleId` prop precedence).
         */
        fun create(
            vehiclesStore: VehiclesStore,
            activeVehicleId: StateFlow<Long?>,
            logger: Logger,
            vehicleId: Long? = null,
            scope: CoroutineScope? = null,
        ): LocationMapWidgetViewModel =
            LocationMapWidgetViewModel(
                source = VehiclesStoreLocationMapSource(vehiclesStore, activeVehicleId, vehicleId),
                logger = logger,
                scope = scope,
            )
    }
}
