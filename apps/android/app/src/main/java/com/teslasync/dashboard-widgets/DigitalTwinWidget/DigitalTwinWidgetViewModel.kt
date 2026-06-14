// UI-thread-free state holder backing the Digital Twin widget — the native port of the web component's hook
// composition (web/src/features/dashboard/widgets/DigitalTwinWidget.tsx). It resolves the active vehicle
// from the shared fleet feed (web `vehicleId ? vehicles?.find(…) ?? vehicles?.[0] : vehicles?.[0]`), then
// binds that vehicle's state + security + charging feeds (P1/S8) through [DigitalTwinSource] and combines
// them onto the shared [UiState] surface (loading / content / empty / stale / offline / error) via
// [DigitalTwinProjection.foldState], reproducing the web shell precedence (`isLoading = stateLoading ||
// securityLoading`; a resolved vehicle always renders the twin). It exposes the single refresh action plus
// the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and calls
// [refresh]/[retry]/[onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DigitalTwinWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.digitaltwin

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
 * @param source the cache-then-network vehicles + state + security + charging seam (a shared-data-layer
 *   adapter in production, a fake in tests). The view-model owns no networking — it only resolves the
 *   vehicle, combines the feeds and projects them.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param vehicleId the widget's bound vehicle (web `WidgetProps.vehicleId`); `null` (or non-positive)
 *   defaults to the first enrolled vehicle.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DigitalTwinWidgetViewModel(
    private val source: DigitalTwinSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val vehicleId: Long? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the resolved cache-then-network feeds (the manual refetch affordance),
    // exactly as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The active vehicle's merged twin snapshot as a lifecycle-aware [UiState]: loading / content / empty
     * (no vehicle) / stale / offline / error, carrying the freshness stamp + error kind. The three
     * per-vehicle feeds are combined by [DigitalTwinProjection.foldState]; the empty-fleet branch folds via
     * [DigitalTwinProjection.foldNoVehicle].
     */
    val state: StateFlow<UiState<DigitalTwinData>> =
        refreshTrigger
            .flatMapLatest { resolveAndFold() }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = UiState.loading(),
            )

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no door / lock / location payload, so a diagnostics line can never leak vehicle state.
     * Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to DigitalTwinRegistration.SLUG))
    }

    /** Re-runs the cache-then-network loads (the web per-hook `refetch()` + the header refresh control). */
    fun refresh() {
        logger.info("digitalTwin.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the offline/error freshness chip's retry. */
    fun retry() = refresh()

    /**
     * Resolves the active vehicle from the fleet (web always consults the list, even with a bound prop id)
     * then combines its three feeds; an empty fleet folds onto the no-vehicle surface.
     */
    private fun resolveAndFold(): Flow<UiState<DigitalTwinData>> =
        source.vehicles().flatMapLatest { vehiclesRes ->
            when (val vehicle = resolveVehicle(vehiclesRes.cached, vehicleId)?.toTwinVehicle()) {
                null -> flowOf(DigitalTwinProjection.foldNoVehicle(vehiclesRes))
                else -> combineFeeds(vehicle)
            }
        }

    /** Combines one vehicle's state + security + charging feeds and folds them onto the [UiState]. */
    private fun combineFeeds(vehicle: TwinVehicle): Flow<UiState<DigitalTwinData>> =
        combine(
            source.vehicleState(vehicle.id),
            source.security(vehicle.id),
            source.chargingTelemetry(vehicle.id),
        ) { stateRes, securityRes, chargingRes ->
            DigitalTwinProjection.foldState(vehicle, stateRes, securityRes, chargingRes)
        }

    companion object {
        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: DigitalTwinSource,
            logger: Logger,
            vehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { DigitalTwinWidgetViewModel(source, logger, vehicleId = vehicleId) }
            }
    }
}
