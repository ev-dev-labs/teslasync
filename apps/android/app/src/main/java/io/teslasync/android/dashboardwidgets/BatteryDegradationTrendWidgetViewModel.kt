package io.teslasync.android.dashboardwidgets

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.energy.EnergyStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * Widget ViewModel for the BatteryDegradationTrend surface. It binds two shared KMP state holders
 * (P1/S8) exactly as the web widget composes two hooks: [VehiclesStore] (the `useVehicles` port) to
 * resolve the target vehicle id — the explicit [vehicleId] or, failing that, the first enrolled
 * vehicle (web `vehicleId ?? vehicles?.[0]?.id`) — and [EnergyStore.batteryDegradation] (the
 * `useBatteryDegradation` port) for that vehicle's `GET /analytics/battery-degradation` analytics. The
 * combined cache-then-network [Resource] is projected onto a lifecycle-aware [UiState].
 *
 * It owns NO networking: the stores and their repositories do (ADR-002). The view stays a stateless
 * Composable that collects [state] and calls [refresh] / [onAppear]. A host constructs this with the
 * shared stores; nothing here reaches the network directly.
 *
 * Freshness (loading / stale / error / fetchedAt) is driven SOLELY by the degradation read, mirroring
 * the web widget, which destructures those flags from `useBatteryDegradation` only and uses the
 * vehicles list purely to pick the id.
 *
 * @param vehicles the shared Vehicles state holder (S8) used only to resolve the target vehicle id.
 * @param energy the shared Energy state holder (S8) the degradation read routes through.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses the ViewModel scope.
 * @param vehicleId the explicit per-instance vehicle scope, or `null` to track the first vehicle.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BatteryDegradationTrendWidgetViewModel(
    private val vehicles: VehiclesStore,
    private val energy: EnergyStore,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val vehicleId: Long? = null,
) : BaseFeedViewModel(logger, scope) {
    // Owned restart trigger. The shared EnergyStore exposes no per-read network refetch for the
    // analytics reads (only the Tesla-energy-site mutations invalidate families; battery-degradation
    // has none), so — without reaching outside this surface's allowed files to extend the store — a
    // manual refresh re-collects the composed cache-then-network feed via this trigger, the same
    // trigger pattern DashboardStore uses internally. True network refreshes otherwise follow the
    // ADR-013 WhileSubscribed lifecycle (the screen leaving and returning re-pulls).
    private val restart = MutableStateFlow(0)

    /** The resolved degradation snapshot as cache-then-network UI state (loading/content/empty/stale/error). */
    val state: StateFlow<UiState<BatteryDegradationSnapshot>> =
        restart
            .flatMapLatest {
                batteryDegradationResource(
                    vehicles = vehicles.vehicles(),
                    explicitVehicleId = vehicleId,
                    degradation = energy::batteryDegradation,
                )
            }.asUiState(isEmpty = { it.isEmpty })

    /** Emits the P1/S11 `view.opened` diagnostics event for this surface (consent-gated, redacted). */
    fun onAppear() {
        logger.info("view.opened", mapOf("surface" to BatteryDegradationTrendWidgetDescriptor.SURFACE_SLUG))
    }

    /** Re-collects the degradation feed (web `refetch`); see [restart] for the freshness semantics. */
    fun refresh() {
        logger.info("batteryDegradation.refresh")
        restart.update { it + 1 }
    }
}

/**
 * Composes the vehicles feed with the per-vehicle degradation feed into one cache-then-network
 * [Resource] of a [BatteryDegradationSnapshot]. The target id is the [explicitVehicleId] or the first
 * enrolled vehicle (web `vehicleId ?? vehicles?.[0]?.id`); when none resolves the degradation feed is
 * never started (web disables the query with `enabled: vehicleId !== null`) and the vehicles resource
 * is mapped to the no-vehicle snapshot. Otherwise the result tracks the degradation feed alone, so its
 * loading/stale/error/fetchedAt freshness mirrors the web's `useBatteryDegradation` destructuring.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun batteryDegradationResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    explicitVehicleId: Long?,
    degradation: (String) -> Flow<Resource<JsonElement>>,
): Flow<Resource<BatteryDegradationSnapshot>> =
    vehicles.flatMapLatest { vehiclesRes ->
        when (val id = resolveDegradationVehicleId(explicitVehicleId, vehiclesRes.cached)) {
            null -> flowOf(vehiclesRes.toNoVehicleSnapshot())
            else -> degradation(id.toString()).map { it.toDegradationSnapshot() }
        }
    }

/**
 * The explicit id, else the first enrolled vehicle's id (web `vehicleId ?? vehicles?.[0]?.id ?? null`).
 *
 * Named distinctly from the sibling `dashboardwidgets` helpers (e.g. ChargeHistory's `resolveVehicleId`,
 * which returns a `0L`-sentinel `Long`) because two top-level functions with the same signature in one
 * package are conflicting overloads; this one keeps its `null`-sentinel `Long?` contract.
 */
internal fun resolveDegradationVehicleId(
    explicitVehicleId: Long?,
    vehicles: List<Vehicle>?,
): Long? = explicitVehicleId ?: vehicles?.firstOrNull()?.id

/**
 * Maps the vehicles resource to a snapshot resource for the no-target-vehicle case. A still-loading
 * list with nothing cached stays [Resource.Loading] (a skeleton while we learn whether a vehicle
 * exists — the cache-then-network analogue of the web's brief disabled-query window); a resolved list
 * with no vehicle becomes [Resource.Success] of the empty snapshot (→ the empty state); a failure
 * surfaces as [Resource.Error].
 */
private fun Resource<List<Vehicle>>.toNoVehicleSnapshot(): Resource<BatteryDegradationSnapshot> =
    when (this) {
        is Resource.Loading ->
            if (cached == null) {
                Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
            } else {
                Resource.Loading(cached = BatteryDegradationSnapshot.NO_DATA, fetchedAt = fetchedAt, stale = stale)
            }
        is Resource.Success -> Resource.Success(BatteryDegradationSnapshot.NO_DATA, fetchedAt, stale = false)
        is Resource.Error -> Resource.Error(cached?.let { BatteryDegradationSnapshot.NO_DATA }, fetchedAt, stale, error)
    }

/** Maps a raw degradation [Resource] to a parsed snapshot resource, parsing any cached body too. */
private fun Resource<JsonElement>.toDegradationSnapshot(): Resource<BatteryDegradationSnapshot> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(cached?.let { BatteryDegradationSnapshot.fromJson(it) }, fetchedAt, stale)
        is Resource.Success -> Resource.Success(BatteryDegradationSnapshot.fromJson(data), fetchedAt, stale = false)
        is Resource.Error ->
            Resource.Error(cached?.let { BatteryDegradationSnapshot.fromJson(it) }, fetchedAt, stale, error)
    }
