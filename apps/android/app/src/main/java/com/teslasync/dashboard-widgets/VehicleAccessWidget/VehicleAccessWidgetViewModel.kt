// UI-thread-free state holder backing the Vehicle Access widget — the native port of the web component's
// hook composition (web/src/features/dashboard/widgets/VehicleAccessWidget.tsx). It resolves the active
// vehicle from the shared fleet feed (web `vehicleId ?? vehicles?.[0]?.id`), then binds that vehicle's
// drivers + invitations + mobile-access feeds (P1/S8) through [VehicleAccessSource] and combines them onto
// the shared [UiState] surface (loading / content / empty / stale / offline / error) via
// [VehicleAccessProjection.foldState], reproducing the web shell precedence (`isLoading` = OR of the three
// queries; freshness = max stamp; error surfaced only through the freshness chip). It exposes the single
// refresh action plus the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only
// collects [state] and calls [refresh]/[retry]/[onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/VehicleAccessWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.vehicleaccess

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * @param source the cache-then-network vehicles + drivers + invitations + mobile-access seam (a shared
 *   data-layer adapter in production, a fake in tests). The view-model owns no networking — it only
 *   resolves the vehicle, combines the feeds and projects them.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param vehicleId the widget's bound vehicle (web `WidgetProps.vehicleId`); `null` defaults to the first
 *   enrolled vehicle.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleAccessWidgetViewModel(
    private val source: VehicleAccessSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val vehicleId: Long? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the resolved cache-then-network feeds (the manual refetch affordance),
    // exactly as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The active vehicle's access snapshot as a lifecycle-aware [UiState]: loading / content / empty (no
     * drivers, no invitations, unknown mobile) / stale / offline / error, carrying the freshness stamp +
     * error kind. The three per-vehicle feeds are combined by [VehicleAccessProjection.foldState]; the
     * "no vehicle resolved" branch folds via [VehicleAccessProjection.foldNoVehicle].
     */
    val state: StateFlow<UiState<VehicleAccessData>> =
        refreshTrigger
            .flatMapLatest { resolveAndFold() }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = UiState.loading(),
            )

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no driver / invitation / vehicle payload, so a diagnostics line can never leak the
     * vehicle's access list. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to VehicleAccessRegistration.SLUG))
    }

    /** Re-runs the cache-then-network loads (the web `refetch()` affordance + the header refresh control). */
    fun refresh() {
        logger.info("vehicleAccess.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the offline/error freshness chip's retry. */
    fun retry() = refresh()

    /**
     * Resolves the active vehicle (web `vehicleId ?? vehicles?.[0]?.id`) then folds its three feeds. A
     * positive bound [vehicleId] short-circuits straight to its feeds (the fleet list is not consulted when
     * a prop id is supplied); otherwise the first enrolled vehicle drives the feeds, and when neither
     * resolves the fleet resource is folded onto the no-vehicle surface.
     */
    private fun resolveAndFold(): Flow<UiState<VehicleAccessData>> {
        val preferred = vehicleId?.takeIf { it > 0L }
        return if (preferred != null) {
            combineFeeds(preferred.toString())
        } else {
            source.vehicles().flatMapLatest { vehiclesRes ->
                when (val id = firstVehicleId(vehiclesRes.cached)) {
                    null -> flowOf(VehicleAccessProjection.foldNoVehicle(vehiclesRes))
                    else -> combineFeeds(id.toString())
                }
            }
        }
    }

    /** Combines one vehicle's drivers + invitations + mobile feeds and folds them onto the [UiState]. */
    private fun combineFeeds(resolvedVehicleId: String): Flow<UiState<VehicleAccessData>> =
        combine(
            source.drivers(resolvedVehicleId),
            source.invitations(resolvedVehicleId),
            source.mobileEnabled(resolvedVehicleId),
        ) { drivers, invitations, mobile ->
            VehicleAccessProjection.foldState(drivers, invitations, mobile)
        }

    companion object {
        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: VehicleAccessSource,
            logger: Logger,
            vehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { VehicleAccessWidgetViewModel(source, logger, vehicleId = vehicleId) }
            }
    }
}
