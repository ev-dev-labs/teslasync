// UI-thread-free state holder backing the Favorite Locations widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/LocationFavoritesWidget.tsx). It
// binds the shared cache-then-network [LocationFavoritesSource] (P1/S8), projects each emission onto the
// shared [UiState] surface (loading / content / empty / stale / offline / error), and exposes the single
// refresh action plus the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only
// collects [state] and calls [refresh] / [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/LocationFavoritesWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.locationfavorites

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
 * Lifecycle-aware state holder backing the Compose [LocationFavoritesWidget]. It consumes the
 * cache-then-network [LocationFavoritesSource] (P1/S8) and re-shares it as a single [UiState] stream via
 * [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that only renders. A payload
 * with neither rows nor a snapshot maps to the empty surface ([LocationFavoritesData.isEmpty]); any
 * resolved rows or snapshot map to content (the location badge always renders, exactly as the web
 * renders the badge even with no favorite rows).
 *
 * It owns no networking. [refresh] re-collects the source (the web `refetch`) and [recordViewOpened]
 * emits the one-shot `view.opened` diagnostics event with the surface
 * [LocationFavoritesRegistration.SLUG] (P1/S11).
 *
 * @param source the cache-then-network combined-feed seam (a shared-data-layer adapter in production, a
 *   fake in tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`
 *   events, never a vehicle id, address, or visit count.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LocationFavoritesWidgetViewModel(
    source: LocationFavoritesSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance).
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The combined Favorite-Locations payload as cache-then-network UI state: loading / content (rows
     * and/or a badge) / empty (nothing resolved) / stale / offline / error, carrying the freshness stamp
     * + error kind. Empty mirrors the web "no data at all" gate; the badge + per-row empty body are
     * handled within the content renderer.
     */
    val state: StateFlow<UiState<LocationFavoritesData>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .asUiState(isEmpty = { it.isEmpty })

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info(EVENT_REFRESH)
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no vehicle id, address, visit count, or destination, so a diagnostics line can
     * never leak a vehicle's locations. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to LocationFavoritesRegistration.SLUG))
    }

    companion object {
        private const val EVENT_REFRESH = "locationFavorites.refresh"
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val FIELD_SURFACE = "surface"

        /**
         * Wire the surface from the shared [LocationsStore] + [VehiclesStore] (P1/S8) and the app-wide
         * active-vehicle selection ([activeVehicleId], typically `SelectedVehicleStore.selectedId`). An
         * explicit [vehicleId] overrides the active selection (web `vehicleId` prop precedence).
         */
        @Suppress("LongParameterList")
        fun create(
            locationsStore: LocationsStore,
            vehiclesStore: VehiclesStore,
            activeVehicleId: StateFlow<Long?>,
            logger: Logger,
            vehicleId: Long? = null,
            scope: CoroutineScope? = null,
        ): LocationFavoritesWidgetViewModel =
            LocationFavoritesWidgetViewModel(
                source = StoreLocationFavoritesSource(locationsStore, vehiclesStore, activeVehicleId, vehicleId),
                logger = logger,
                scope = scope,
            )
    }
}
