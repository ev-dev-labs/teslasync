// UI-thread-free state holder backing the VehicleCard feature view — the native port of the per-card
// `useVehicleState(vehicle.id)` query the web component runs itself (web/src/features/vehicles/components/
// VehicleCard.tsx + web/src/api/hooks/useVehicles.ts). It binds the shared last-known-state feed (P1/S8)
// through a [VehicleCardSource], projects each cache-then-network emission onto the shared [UiState] surface
// (loading / content / empty / stale / offline / error), and exposes the single refresh action plus the
// PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and calls
// [refresh] / [retry] / [onViewOpened].
//
// Unlike the page-level vehicle ViewModels, this one is keyed to the card's OWN [vehicleId] (the web prop),
// not the app-wide selected vehicle, so each card in a list tracks its own vehicle's state independently — the
// exact composition the web `vehicles.map(v => <VehicleCard vehicle={v} />)` produces.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehicleCard) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclecard

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * @param source the cache-then-network last-known-state seam (a shared-data-layer adapter in production, a
 *   fake in tests). The view-model owns no networking — it only projects this feed.
 * @param vehicleId the card's vehicle (the web `vehicle.id` the component passes to `useVehicleState`).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleCardViewModel(
    private val source: VehicleCardSource,
    private val vehicleId: Long,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly as
    // the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The card's last-known state as a lifecycle-aware [UiState]: loading / content / empty (no live state) /
     * stale / offline / error, carrying the freshness stamp + error kind. Empty mirrors the web `{state && …}`
     * gate — a `null` state is the "asleep" surface, but the card chrome still renders (never a blank box).
     */
    val state: StateFlow<UiState<VehicleStateEnvelope>> =
        refreshTrigger
            .flatMapLatest { source.vehicleState(vehicleId) }
            .asUiState { it.state == null }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no VIN / battery / location, so a diagnostics line can never leak the vehicle's identity or
     * posture. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        VehicleCardDiagnostics.recordViewOpened(logger)
    }

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("vehicleCard.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel for one vehicle. */
        fun factory(
            source: VehicleCardSource,
            vehicleId: Long,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { VehicleCardViewModel(source, vehicleId, logger) }
            }
    }
}
