// UI-thread-free state holder backing the Geofence Status widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/GeofenceWidget.tsx). It binds the
// shared cache-then-network [GeofenceWidgetSource] (P1/S8), projects each emission onto the shared
// [UiState] surface (loading / content / empty / stale / offline / error), and exposes the single
// refresh action plus the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only
// collects [state] and calls [refresh] / [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/GeofenceWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.geofence

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.locations.LocationsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [GeofenceWidget]. It consumes the cache-then-network
 * [GeofenceWidgetSource] (P1/S8) and re-shares it as a single [UiState] stream via
 * [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that only renders. An empty
 * geofence list maps to the empty surface (the web `isEmpty` → "No geofences configured" body); a
 * non-empty list maps to content (the fence list, optionally over the inline map). An error keeps the
 * best-effort cached list visible with the offline/error freshness chip, exactly as the web `WidgetShell`
 * surfaces a failed query.
 *
 * It owns no networking. [refresh] re-collects the source (the web `stateRefetch()` + `fenceRefetch()`)
 * and [recordViewOpened] emits the one-shot `view.opened` diagnostics event with the surface
 * [GeofenceRegistration.SLUG] (P1/S11).
 *
 * @param source the cache-then-network geofence seam (a shared-data-layer adapter in production, a fake
 *   in tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class GeofenceWidgetViewModel(
    source: GeofenceWidgetSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance).
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The combined geofence reading as cache-then-network UI state: loading / content (a non-empty fence
     * list) / empty (no configured fences) / stale / offline / error, carrying the freshness stamp +
     * error kind. Empty mirrors the web `isEmpty = fences.length === 0` gate.
     */
    public val state: StateFlow<UiState<GeofenceFeed>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .asUiState(isEmpty = { it.fences.isEmpty() })

    /** Re-runs the cache-then-network load (the web `stateRefetch()` + `fenceRefetch()` affordance). */
    public fun refresh() {
        logger.info("geofence.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no geofence names, coordinates or vehicle id, so a diagnostics line can never leak
     * a vehicle's location. Call from the composable's first-composition effect.
     */
    public fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to GeofenceRegistration.SLUG))
    }

    public companion object {
        /**
         * Wire the surface from the shared [VehiclesStore] + [LocationsStore] (P1/S8). An explicit
         * [vehicleId] overrides the first-enrolled-vehicle default (web `vehicleId` prop precedence).
         */
        public fun create(
            vehiclesStore: VehiclesStore,
            locationsStore: LocationsStore,
            logger: Logger,
            vehicleId: Long? = null,
            scope: CoroutineScope? = null,
        ): GeofenceWidgetViewModel =
            GeofenceWidgetViewModel(
                source = geofenceWidgetSource(vehiclesStore, locationsStore, vehicleId),
                logger = logger,
                scope = scope,
            )
    }
}
