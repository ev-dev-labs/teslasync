package io.teslasync.android.widgets

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.notifications.NotificationSettingsStore
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.data.repo.HttpChargingRepository
import io.teslasync.shared.core.data.repo.HttpDashboardRepository
import io.teslasync.shared.core.data.repo.HttpNotificationsRepository
import io.teslasync.shared.core.data.repo.HttpVehiclesRepository
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first

/** The shared cache-then-network repositories the widgets read from / refresh through. */
data class WidgetRepositories(
    val vehicles: HttpVehiclesRepository,
    val charging: HttpChargingRepository,
    val dashboard: HttpDashboardRepository,
    val notifications: HttpNotificationsRepository,
)

/**
 * The non-repository environment seams the reader needs, grouped so the reader stays small and stays
 * trivially fakeable in tests: the freshness [clock], the localized [fallbackVehicleName], and the
 * local-time [nowMinuteOfDay] used to evaluate the quiet-hours window.
 */
class WidgetEnvironment(
    val clock: Clock,
    val fallbackVehicleName: () -> String,
    val nowMinuteOfDay: () -> Int,
)

/** A cached value read back from a repository together with its `fetched_at` stamp (both nullable). */
private data class CachedRead<out T>(
    val value: T?,
    val fetchedAt: Long?,
)

/** The resolved active vehicle (and its id), defaulting to the first enrolled vehicle. */
private data class ResolvedVehicle(
    val vehicle: Vehicle?,
    val id: Long?,
)

/**
 * The widgets' cache/freshness adapter (P3/A8, ADR-013). It reads the LAST-KNOWN cached value of each
 * shared feed WITHOUT touching the network — it collects only the first cache-then-network emission
 * (`Flow.first()`), which the operator emits straight from the offline cache before any fetch — and
 * folds it (plus the last background-sync outcome) into a render-ready [WidgetSnapshot] via the pure
 * [WidgetSnapshotMapper]. The actual network refresh is the separate [WidgetRefresher]'s job, run by
 * WorkManager; this path is fast and side-effect-free so it is safe in `provideGlance`.
 *
 * It stores no secrets: it reads only the shared offline cache (ADR-008 keeps tokens in secure
 * storage) and the device notification settings.
 */
class WidgetDataReader(
    private val repositories: WidgetRepositories,
    private val selectedVehicleStore: SelectedVehicleStore,
    private val unitFormatter: StateFlow<UnitFormatter>,
    private val notificationSettingsStore: NotificationSettingsStore,
    private val environment: WidgetEnvironment,
) {
    /** Builds the vehicle-status snapshot from the cached vehicle list + last-known state. */
    suspend fun vehicleStatus(syncStatus: WidgetSyncStatus): VehicleStatusSnapshot {
        val resolved = resolveVehicle()
        val state =
            resolved.id?.let {
                repositories.vehicles
                    .vehicleState(it)
                    .first()
                    .peek()
            }
        return WidgetSnapshotMapper.vehicleStatus(
            vehicleName = resolved.vehicle?.displayName,
            state = state?.value?.state,
            context = WidgetReadContext(state?.fetchedAt, syncStatus, environment.clock.nowMillis()),
            formatter = unitFormatter.value,
            fallbackVehicleName = environment.fallbackVehicleName(),
        )
    }

    /** Builds the charging snapshot from the cached vehicle state + the latest cached session. */
    suspend fun charging(syncStatus: WidgetSyncStatus): ChargingSnapshot {
        val resolved = resolveVehicle()
        val stateRead =
            resolved.id?.let {
                repositories.vehicles
                    .vehicleState(it)
                    .first()
                    .peek()
            }
        val sessionsRead =
            resolved.id?.let {
                repositories.charging
                    .sessions(it)
                    .first()
                    .peek()
            }
        val latestSession = sessionsRead?.value?.maxByOrNull { it.startedAt }
        val fetchedAt = listOfNotNull(stateRead?.fetchedAt, sessionsRead?.fetchedAt).maxOrNull()
        return WidgetSnapshotMapper.charging(
            state = stateRead?.value?.state,
            latestSession = latestSession,
            context = WidgetReadContext(fetchedAt, syncStatus, environment.clock.nowMillis()),
            formatter = unitFormatter.value,
        )
    }

    /** Builds the quick-stats snapshot from the cached fleet summary. */
    suspend fun quickStats(syncStatus: WidgetSyncStatus): QuickStatsSnapshot {
        val read =
            repositories.dashboard
                .stats()
                .first()
                .peek()
        return WidgetSnapshotMapper.quickStats(
            stats = read.value,
            context = WidgetReadContext(read.fetchedAt, syncStatus, environment.clock.nowMillis()),
            formatter = unitFormatter.value,
        )
    }

    /** Builds the alerts snapshot from the cached inbox + the device quiet-hours setting. */
    suspend fun alerts(syncStatus: WidgetSyncStatus): AlertsSnapshot {
        val read =
            repositories.notifications
                .alerts()
                .first()
                .peek()
        return WidgetSnapshotMapper.alerts(
            alerts = read.value,
            quietHoursActive = quietHoursActive(),
            context = WidgetReadContext(read.fetchedAt, syncStatus, environment.clock.nowMillis()),
        )
    }

    private suspend fun quietHoursActive(): Boolean {
        val settings = notificationSettingsStore.load()
        return settings.quietHours.isQuiet(environment.nowMinuteOfDay())
    }

    private suspend fun resolveVehicle(): ResolvedVehicle {
        val list =
            repositories.vehicles
                .vehicles()
                .first()
                .peek()
                .value
                .orEmpty()
        val selected = selectedVehicleStore.selectedId.value
        val vehicle = list.firstOrNull { it.id == selected } ?: list.firstOrNull()
        return ResolvedVehicle(vehicle = vehicle, id = vehicle?.id ?: selected)
    }
}

/** The cached value + stamp of a cache-then-network [Resource]'s current (cache-only) emission. */
private fun <T> Resource<T>.peek(): CachedRead<T> =
    when (this) {
        is Resource.Loading -> CachedRead(cached, fetchedAt)
        is Resource.Success -> CachedRead(data, fetchedAt)
        is Resource.Error -> CachedRead(cached, fetchedAt)
    }
