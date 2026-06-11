package io.teslasync.android.dashboardwidgets.chargecosttracker

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.charging.ChargingStore
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

/**
 * State holder backing the Compose [ChargeCostTrackerWidget] — the Android port of the web
 * `ChargeCostTrackerWidget`'s hook composition
 * (`web/src/features/dashboard/widgets/ChargeCostTrackerWidget.tsx`).
 *
 * It binds three shared P1/S8 holders and performs no HTTP itself (ADR-002): the [ChargingStore]
 * paginated-sessions feed for the trailing 30-day window (web `useQuery('/charging?vehicle_id=…&
 * limit=100&start=…')`), the [VehiclesStore] list to resolve the primary vehicle when no explicit
 * one is supplied (web `vehicleId ?? vehicles?.[0]?.id`), and the [SettingsStore] document to derive
 * the cost rate + unit preferences (web `useFormatting`/`useUnits`). Each is folded onto a
 * lifecycle-aware [UiState]/[ChargeCostPrefs] so the view stays a thin renderer that covers every
 * state the web widget draws (loading / content / empty / error, plus stale / offline via the
 * ADR-013 freshness flags).
 *
 * [refresh]/[retry] bump a trigger that restarts a fresh upstream collection (the web `refetch()`),
 * and [onViewOpened] emits the P1/S11 `view.opened` diagnostics event exactly once per surface open.
 *
 * @param charging the shared cache-then-network charging holder.
 * @param vehicles the shared vehicles holder (primary-vehicle resolution).
 * @param settings the shared settings holder (cost rate + unit preferences).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param explicitVehicleId an explicit vehicle id; when null/≤0 the primary cached vehicle is used.
 * @param scope test seam; production uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChargeCostTrackerWidgetViewModel(
    private val charging: ChargingStore,
    private val vehicles: VehiclesStore,
    settings: SettingsStore,
    logger: Logger,
    private val explicitVehicleId: Long? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // The web `thirtyDaysAgo` is memoised once at mount; the ViewModel is created once per surface.
    private val startIso: String = isoDaysAgo(SystemClock.nowMillis(), ChargeCostTrackerRegistration.WINDOW_DAYS)
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The 30-day charging sessions as cache-then-network UI state (empty list → empty surface). */
    val sessions: StateFlow<UiState<List<ChargingSession>>> =
        refreshTrigger
            .flatMapLatest { vehicleSessionsFlow() }
            .asUiState { it.isEmpty() }

    /** The live cost + unit preferences (web `useFormatting`/`useUnits`), re-derived as settings change. */
    val prefs: StateFlow<ChargeCostPrefs> =
        settings
            .settings()
            .map { resource -> ChargeCostPrefs.from(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = ChargeCostPrefs.DEFAULT,
            )

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf("slug" to ChargeCostTrackerRegistration.SLUG))
    }

    /** Re-fetches the charging-sessions feed (web `refetch()`); restarts a fresh collection. */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf("slug" to ChargeCostTrackerRegistration.SLUG))
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    /**
     * Resolves the vehicle to scope the charging read to, then streams that vehicle's 30-day sessions.
     * An explicit id binds directly; otherwise the primary cached vehicle is used (web
     * `vehicles?.[0]?.id`). With no vehicle yet the upstream short-circuits — loading while vehicles
     * are still resolving, empty once resolved with none (web's disabled `enabled: id > 0` query).
     */
    private fun vehicleSessionsFlow(): Flow<Resource<List<ChargingSession>>> {
        val explicit = explicitVehicleId?.takeIf { it > 0L }
        if (explicit != null) return paginatedSessions(explicit)

        return vehicles.vehicles().flatMapLatest { vehiclesResource ->
            val id = vehiclesResource.cached?.firstOrNull()?.id ?: 0L
            when {
                id > 0L -> paginatedSessions(id)
                vehiclesResource is Resource.Loading && vehiclesResource.cached == null ->
                    flowOf<Resource<List<ChargingSession>>>(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                else ->
                    flowOf<Resource<List<ChargingSession>>>(
                        Resource.Success(data = emptyList(), fetchedAt = SystemClock.nowMillis(), stale = false),
                    )
            }
        }
    }

    private fun paginatedSessions(vehicleId: Long): Flow<Resource<List<ChargingSession>>> =
        charging.sessionsPaginated(
            vehicleId = vehicleId,
            limit = ChargeCostTrackerRegistration.MAX_SESSIONS,
            offset = 0,
            start = startIso,
            end = null,
        )

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "chargeCost.refresh"

        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            charging: ChargingStore,
            vehicles: VehiclesStore,
            settings: SettingsStore,
            logger: Logger,
            explicitVehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer {
                    ChargeCostTrackerWidgetViewModel(charging, vehicles, settings, logger, explicitVehicleId)
                }
            }
    }
}
