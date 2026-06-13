// UI-thread-free state holder backing the VehicleMultiSelect surface — the native port of the web `useVehicles`
// read behind the component (web/src/components/forms/VehicleMultiSelect.tsx is fed the enrolled fleet its
// callers load via `useVehicles`). It binds the shared enrolled-vehicle feed through [VehicleMultiSelectSource]
// and performs no HTTP itself (ADR-002): the view collects [vehicles] and folds it together with the
// controlled selection through the pure [VehicleMultiSelectProjection]. The enrolled-fleet feed is the genuine
// async dependency a self-contained picker resolves, so its cache-then-network lifecycle drives the surface's
// loading / content / empty / error / stale / offline states. The selection itself stays controlled by the
// host (the web `value` / `onChange` props), so it is intentionally NOT owned here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/VehicleMultiSelect) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehiclemultiselect

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * State holder for the VehicleMultiSelect surface.
 *
 * The enrolled-vehicle feed is re-shared as a lifecycle-aware [UiState] so the composable can switch surfaces —
 * loading (first fetch), content (the selectable trigger + popover), empty (the disabled trigger + add-a-
 * vehicle help, the web `isFleetEmpty` branch), a hard error with retry, and the stale/offline freshness
 * envelope — without re-deriving the cache-then-network contract. [refresh]/[retry] re-collect the feed (web
 * `useVehicles` refetch; the shared store also re-fetches on a vehicle mutation elsewhere), and [onViewOpened]
 * emits the one PII-safe `view.opened` diagnostic (P1/S11) — slug only, never a VIN or vehicle id.
 *
 * @param source the enrolled-fleet seam (a shared-store/-repository adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleMultiSelectViewModel(
    private val source: VehicleMultiSelectSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The enrolled-vehicle list as lifecycle-aware [UiState]. An empty fleet is treated as structurally empty
     * (the web `isFleetEmpty` disabled-trigger branch), so the surface's empty state is honest rather than a
     * blank content frame.
     */
    val vehicles: StateFlow<UiState<List<Vehicle>>> =
        refreshTrigger
            .flatMapLatest { source.vehicles() }
            .asUiState(isEmpty = { it.isEmpty() })

    /** Re-fetches the enrolled-vehicle feed after a hard error (web `refetch`); backs the retry affordance. */
    fun retry() {
        logger.info(VehicleMultiSelectRegistration.EVENT_REFRESH, surfaceField)
        refreshTrigger.update { it + 1 }
    }

    /** Re-fetches the enrolled-vehicle feed; backs the stale freshness chip's auto-refresh. */
    fun refresh() = retry()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no VIN, vehicle id, or selection. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(VehicleMultiSelectRegistration.EVENT_VIEW_OPENED, surfaceField)
    }

    private val surfaceField: Map<String, String>
        get() = mapOf(VehicleMultiSelectRegistration.SURFACE_KEY to VehicleMultiSelectRegistration.SLUG)

    companion object {
        /** Wires the surface from the shared **S8** [VehiclesStore] enrolled-fleet feed (web `useVehicles`). */
        fun create(
            vehiclesStore: VehiclesStore,
            logger: Logger,
        ): VehicleMultiSelectViewModel = VehicleMultiSelectViewModel(vehiclesStore.asVehicleMultiSelectSource(), logger)

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: VehicleMultiSelectSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { VehicleMultiSelectViewModel(source, logger) }
            }
    }
}
