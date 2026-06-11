// File hosts the BatteryGauge data seam + its shared-layer binding + the state holder; named after the
// surface bundle (BatteryGaugeWidget*) rather than the single class it leads with.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * The data port the [BatteryGaugeWidgetViewModel] binds to — the Android analogue of the web
 * `useVehicles` + `useVehicleState` hook pair the widget composes
 * (`web/src/features/dashboard/widgets/BatteryGaugeWidget.tsx`) and the P1/S8 state-holder boundary.
 * The view never performs HTTP itself: it reads these two cache-then-network [Resource] streams. A test
 * fake stands in for the whole domain, and a fresh collection (the ViewModel's refresh/retry) restarts
 * the upstreams so a manual refresh re-resolves the default vehicle and re-reads its state.
 */
interface BatteryGaugeSource {
    /** Stream the enrolled-vehicle list (`GET /vehicles`) — used only to resolve the default vehicle id. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream the cache-then-network last-known state envelope for [vehicleId] (`GET /vehicles/{id}/state`). */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>
}

/**
 * Binds the surface to the shared S8 [VehiclesStore] holder (the web `useVehicles` / `useVehicleState`
 * port). The store folds every observer of the same `(feed, params)` into one upstream collection, so a
 * host sharing one Vehicles holder across surfaces does not multiply network reads.
 */
fun batteryGaugeSource(store: VehiclesStore): BatteryGaugeSource =
    object : BatteryGaugeSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = store.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = store.vehicleState(vehicleId)
    }

/**
 * State holder backing the Compose [BatteryGaugeWidget] — the Android port of the web
 * `BatteryGaugeWidget`'s hook composition (`web/src/features/dashboard/widgets/BatteryGaugeWidget.tsx`).
 *
 * It composes the injected [BatteryGaugeSource] (the P1/S8 shared-layer seam) exactly as the web does:
 * the vehicle list resolves the default vehicle id (`vehicleId ?? vehicles?.[0]?.id ?? 0`, an explicit
 * [explicitVehicleId] winning), then the per-vehicle state feed drives a lifecycle-aware [UiState] of the
 * [VehicleStateEnvelope]. That covers every state the web widget renders: loading (no cache), content
 * (the gauge), empty (`state == null` ⇒ the "No battery data" surface), hard error, and — through the
 * ADR-013 freshness contract — stale / offline (the cached envelope kept visible with the staleness +
 * error flags). The view stays a thin renderer; it performs no HTTP and owns no business logic (ADR-002).
 *
 * [refresh]/[retry] bump a trigger that restarts the composed upstream (the web `refetch()`), and
 * [onViewOpened] emits the P1/S11 `view.opened` diagnostics event exactly once per surface open.
 *
 * @param source the shared cache-then-network vehicles + vehicle-state seam.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses `viewModelScope`.
 * @param explicitVehicleId an optional pinned vehicle id (web `WidgetProps.vehicleId`); `null` ⇒ default.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BatteryGaugeWidgetViewModel(
    private val source: BatteryGaugeSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val explicitVehicleId: Long? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The resolved vehicle's last-known state as cache-then-network UI state. An absent state envelope
     * (`state == null`) maps to [io.teslasync.android.data.UiPhase.Empty] so the surface shows its
     * "No battery data" empty state rather than a blank panel (web `state ? gauge : EmptyState`).
     */
    val battery: StateFlow<UiState<VehicleStateEnvelope>> =
        refreshTrigger
            .flatMapLatest { batteryFeed() }
            .asUiState(isEmpty = { it.state == null })

    /**
     * Compose the vehicle list with the per-vehicle state feed: re-resolve the default vehicle id from the
     * latest vehicles snapshot, then switch to that vehicle's state stream (web `id` recompute + the
     * dependent `useVehicleState(id)` query).
     */
    private fun batteryFeed(): Flow<Resource<VehicleStateEnvelope>> =
        source.vehicles().flatMapLatest { vehiclesRes ->
            source.vehicleState(BatteryGaugeProjection.resolveVehicleId(explicitVehicleId, vehiclesRes.cached))
        }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to BatteryGaugeRegistration.SLUG))
    }

    /** Re-fetches the vehicle state (web `refetch()`); restarts a fresh cache-then-network collection. */
    fun refresh() {
        logger.info("batteryGauge.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: BatteryGaugeSource,
            logger: Logger,
            explicitVehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { BatteryGaugeWidgetViewModel(source, logger, explicitVehicleId = explicitVehicleId) }
            }
    }
}
