// UI-thread-free state holder backing the Route Efficiency widget — the native port of the web component's
// hook composition (web/src/features/dashboard/widgets/RouteEfficiencyWidget.tsx). It binds the shared
// vehicles + route-efficiency feeds (P1/S8) through [RouteEfficiencySource]: when no explicit vehicle is
// configured it resolves the default vehicle from the `useVehicles` list (web `vehicleId ??
// vehicles?.[0]?.id`), then projects the `useRouteEfficiency` cache-then-network feed onto the shared
// [UiState] surface (loading / content / empty / stale / offline / error). It exposes the single refresh
// action plus the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects
// [state] and calls [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/RouteEfficiencyWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.routeefficiency

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
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
 * @param source the cache-then-network vehicles + route-efficiency seam (a shared-data-layer adapter in
 *   production, a fake in tests). The view-model owns no networking — it only resolves the default vehicle
 *   and projects the rendered feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param vehicleId the explicitly configured vehicle (web `WidgetProps.vehicleId`). When `null`/non-positive
 *   the first enrolled vehicle is used, exactly as the web `vehicles?.[0]?.id` fallback does.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RouteEfficiencyWidgetViewModel(
    private val source: RouteEfficiencySource,
    logger: Logger,
    private val vehicleId: Long? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly
    // as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The route-efficiency surface as a lifecycle-aware [UiState]: loading / content / empty (no recurring
     * routes) / stale / offline / error, carrying the freshness stamp + error kind. The feed is folded by
     * [RouteEfficiencyProjection.foldState], which reproduces the web shell precedence (loading → error →
     * content, content gated on `routes.length > 0`).
     */
    val state: StateFlow<UiState<RouteEfficiencySnapshot>> =
        refreshTrigger
            .flatMapLatest { snapshotFeed() }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = UiState.loading(),
            )

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("routeEfficiency.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no route / location / efficiency payload, so a diagnostics line can never leak
     * driving behaviour. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to RouteEfficiencyRegistration.SLUG))
    }

    /**
     * The rendered feed: the explicit vehicle's routes when one is configured, otherwise the first enrolled
     * vehicle resolved from the live vehicles list. While the list is loading (no cached vehicle) the
     * surface stays in loading; an empty/unresolved list resolves to the empty state (web's disabled query
     * ⇒ no routes ⇒ empty) — all without ever issuing HTTP from the view.
     */
    private fun snapshotFeed(): Flow<UiState<RouteEfficiencySnapshot>> {
        val explicit = vehicleId?.takeIf { it > 0L }
        return if (explicit != null) {
            feedFor(explicit)
        } else {
            source.vehicles().flatMapLatest { vehiclesResource ->
                val firstId = vehiclesResource.cached?.firstOrNull()?.id
                when {
                    firstId != null && firstId > 0L -> feedFor(firstId)
                    vehiclesResource is Resource.Loading -> flowOf(UiState.loading())
                    else -> flowOf(RouteEfficiencyProjection.emptyState())
                }
            }
        }
    }

    /** Projects the route-efficiency feed for one vehicle onto the [UiState] (web `useRouteEfficiency(idStr)`). */
    private fun feedFor(vid: Long): Flow<UiState<RouteEfficiencySnapshot>> =
        source.routeEfficiency(vid.toString()).map { RouteEfficiencyProjection.foldState(it) }

    companion object {
        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: RouteEfficiencySource,
            logger: Logger,
            vehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { RouteEfficiencyWidgetViewModel(source, logger, vehicleId) }
            }
    }
}
