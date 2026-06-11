package io.teslasync.android.dashboardwidgets.speedprofile

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.driving.DrivingStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
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
import kotlinx.serialization.json.JsonElement

/**
 * State holder backing the Compose [SpeedProfileWidget] — the Android port of the web
 * `SpeedProfileWidget`'s hook composition
 * (`web/src/features/dashboard/widgets/SpeedProfileWidget.tsx`).
 *
 * It binds three shared P1/S8 holders and performs no HTTP itself (ADR-002): the [VehiclesStore] list
 * to resolve the target vehicle (web `vehicleId ?? vehicles?.[0]?.id`), the [DrivingStore.speedProfile]
 * feed for that vehicle's `GET /analytics/speed-profile` analytics (web `useSpeedProfile`), and the
 * [SettingsStore] document to derive the speed display unit (web `useUnits`). The combined
 * cache-then-network [Resource] is parsed into a [SpeedProfileSnapshot] and projected onto a
 * lifecycle-aware [UiState]; the live [prefs] are folded separately so a unit change re-projects without
 * re-fetching.
 *
 * Freshness (loading / stale / error / fetchedAt) is driven SOLELY by the speed-profile read, mirroring
 * the web widget which destructures those flags from `useSpeedProfile` only and uses the vehicles list
 * purely to pick the id.
 *
 * [refresh]/[retry] bump a trigger that restarts a fresh upstream collection (the web `refetch()`), and
 * [onViewOpened] emits the P1/S11 `view.opened` diagnostics event exactly once per surface open.
 *
 * @param driving the shared cache-then-network driving holder (the speed-profile analytics feed).
 * @param vehicles the shared vehicles holder (primary-vehicle resolution).
 * @param settings the shared settings holder (speed unit preference).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param explicitVehicleId an explicit vehicle id; when null/≤0 the primary cached vehicle is used.
 * @param scope test seam; production uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SpeedProfileWidgetViewModel(
    private val driving: DrivingStore,
    private val vehicles: VehiclesStore,
    settings: SettingsStore,
    logger: Logger,
    private val explicitVehicleId: Long? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The resolved speed profile as cache-then-network UI state (loading / content / empty / stale / error). */
    val state: StateFlow<UiState<SpeedProfileSnapshot>> =
        refreshTrigger
            .flatMapLatest {
                speedProfileResource(
                    vehicles = vehicles.vehicles(),
                    explicitVehicleId = explicitVehicleId,
                    speedProfile = { vehicleId -> driving.speedProfile(vehicleId) },
                )
            }.asUiState(isEmpty = { it.isEmpty })

    /** The live speed unit preference (web `useUnits`), re-derived as settings change. */
    val prefs: StateFlow<SpeedProfilePrefs> =
        settings
            .settings()
            .map { resource -> SpeedProfilePrefs.from(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = SpeedProfilePrefs.DEFAULT,
            )

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf("surface" to SpeedProfileRegistration.SLUG))
    }

    /** Re-fetches the speed-profile feed (web `refetch()`); restarts a fresh collection. */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf("surface" to SpeedProfileRegistration.SLUG))
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "speedProfile.refresh"

        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            driving: DrivingStore,
            vehicles: VehiclesStore,
            settings: SettingsStore,
            logger: Logger,
            explicitVehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer {
                    SpeedProfileWidgetViewModel(driving, vehicles, settings, logger, explicitVehicleId)
                }
            }
    }
}

/**
 * Composes the vehicles feed with the per-vehicle speed-profile feed into one cache-then-network
 * [Resource] of a [SpeedProfileSnapshot]. The target id is the [explicitVehicleId] or the first enrolled
 * vehicle (web `vehicleId ?? vehicles?.[0]?.id`); when none resolves the speed-profile feed is never
 * started (web disables the query with `enabled: !!vehicleId`) and the vehicles resource is mapped to the
 * empty snapshot. Otherwise the result tracks the speed-profile feed alone, so its
 * loading/stale/error/fetchedAt freshness mirrors the web's `useSpeedProfile` destructuring.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun speedProfileResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    explicitVehicleId: Long?,
    speedProfile: (String) -> Flow<Resource<JsonElement>>,
): Flow<Resource<SpeedProfileSnapshot>> =
    vehicles.flatMapLatest { vehiclesRes ->
        when (val id = resolveSpeedProfileVehicleId(explicitVehicleId, vehiclesRes.cached)) {
            null -> flowOf(vehiclesRes.toNoVehicleSnapshot())
            else -> speedProfile(id.toString()).map { it.toSnapshotResource() }
        }
    }

/**
 * The explicit id (when positive), else the first enrolled vehicle's id (web `vehicleId ??
 * vehicles?.[0]?.id`, gated by `vid > 0`). Returns `null` when there is no usable vehicle yet.
 */
internal fun resolveSpeedProfileVehicleId(
    explicitVehicleId: Long?,
    vehicles: List<Vehicle>?,
): Long? {
    val explicit = explicitVehicleId?.takeIf { it > 0L }
    if (explicit != null) return explicit
    return vehicles?.firstOrNull()?.id?.takeIf { it > 0L }
}

/**
 * Maps the vehicles resource to a snapshot resource for the no-target-vehicle case. A still-loading list
 * with nothing cached stays [Resource.Loading] (a skeleton while we learn whether a vehicle exists — the
 * cache-then-network analogue of the web's brief disabled-query window); a resolved list with no vehicle
 * becomes [Resource.Success] of the empty snapshot (→ the empty state); a failure surfaces as
 * [Resource.Error].
 */
private fun Resource<List<Vehicle>>.toNoVehicleSnapshot(): Resource<SpeedProfileSnapshot> =
    when (this) {
        is Resource.Loading ->
            if (cached == null) {
                Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
            } else {
                Resource.Loading(cached = SpeedProfileSnapshot.EMPTY, fetchedAt = fetchedAt, stale = stale)
            }
        is Resource.Success -> Resource.Success(SpeedProfileSnapshot.EMPTY, fetchedAt, stale = false)
        is Resource.Error -> Resource.Error(cached?.let { SpeedProfileSnapshot.EMPTY }, fetchedAt, stale, error)
    }

/** Maps a raw speed-profile [Resource] to a parsed snapshot resource, parsing any cached body too. */
private fun Resource<JsonElement>.toSnapshotResource(): Resource<SpeedProfileSnapshot> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(cached?.let { SpeedProfileSnapshot.fromJson(it) }, fetchedAt, stale)
        is Resource.Success -> Resource.Success(SpeedProfileSnapshot.fromJson(data), fetchedAt, stale = false)
        is Resource.Error ->
            Resource.Error(cached?.let { SpeedProfileSnapshot.fromJson(it) }, fetchedAt, stale, error)
    }
