package io.teslasync.android.widgets

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlin.coroutines.cancellation.CancellationException

/**
 * Drives the background refresh for the widgets (P3/A8): it collects each shared cache-then-network
 * feed to its terminal emission, which performs exactly one network fetch and writes the fresh SI
 * value through to the offline cache. It returns the per-[WidgetKind] [WidgetSyncStatus] so the worker
 * can record an honest stale / offline / error story for each widget.
 *
 * It is the ONLY widget code that reaches the network, and it is run by WorkManager — never from a
 * held SSE stream (ADR-009). When the network is unreachable the feeds fail with a cached fallback, so
 * a refresh degrades to "offline / last-known" rather than throwing.
 */
class WidgetRefresher(
    private val repositories: WidgetRepositories,
    private val selectedVehicleStore: SelectedVehicleStore,
    private val logger: Logger,
) {
    /** Refreshes every widget feed and returns the resulting sync status per widget. */
    suspend fun refresh(): Map<WidgetKind, WidgetSyncStatus> {
        val (vehiclesStatus, vehicles) = driveVehicles()
        val id = resolveId(vehicles)

        val stateStatus = id?.let { driveStatus(repositories.vehicles.vehicleState(it)) }
        val sessionsStatus = id?.let { driveStatus(repositories.charging.sessions(it)) }
        val dashboardStatus = driveStatus(repositories.dashboard.stats())
        val alertsStatus = driveStatus(repositories.notifications.alerts())

        logger.info("widget.refresh.done")
        return mapOf(
            WidgetKind.VehicleStatus to (stateStatus ?: vehiclesStatus),
            WidgetKind.Charging to chargingStatus(stateStatus, sessionsStatus, vehiclesStatus),
            WidgetKind.QuickStats to dashboardStatus,
            WidgetKind.Alerts to alertsStatus,
        )
    }

    private fun chargingStatus(
        stateStatus: WidgetSyncStatus?,
        sessionsStatus: WidgetSyncStatus?,
        fallback: WidgetSyncStatus,
    ): WidgetSyncStatus {
        val reduced = reduceStatus(listOfNotNull(stateStatus, sessionsStatus))
        return if (reduced == WidgetSyncStatus.Unknown) fallback else reduced
    }

    private fun resolveId(vehicles: List<Vehicle>?): Long? {
        val list = vehicles.orEmpty()
        val selected = selectedVehicleStore.selectedId.value
        val vehicle = list.firstOrNull { it.id == selected } ?: list.firstOrNull()
        return vehicle?.id ?: selected
    }

    private suspend fun driveVehicles(): Pair<WidgetSyncStatus, List<Vehicle>?> {
        val terminal =
            runCatching { repositories.vehicles.vehicles().first(::isTerminal) }
                .getOrElse { error -> return rethrowOrLog(error) to null }
        return statusOf(terminal) to terminal.cached
    }

    private suspend fun <T> driveStatus(flow: Flow<Resource<T>>): WidgetSyncStatus =
        runCatching { statusOf(flow.first(::isTerminal)) }
            .getOrElse { error -> rethrowOrLog(error) }

    private fun rethrowOrLog(error: Throwable): WidgetSyncStatus {
        if (error is CancellationException) throw error
        logger.warn("widget.refresh.feed_error")
        return WidgetSyncStatus.FailedNoCache
    }

    private fun <T> isTerminal(resource: Resource<T>): Boolean = resource is Resource.Success || resource is Resource.Error

    private fun <T> statusOf(resource: Resource<T>): WidgetSyncStatus =
        when (resource) {
            is Resource.Success -> WidgetSyncStatus.Ok
            is Resource.Error -> if (resource.cached != null) WidgetSyncStatus.FailedWithCache else WidgetSyncStatus.FailedNoCache
            is Resource.Loading -> WidgetSyncStatus.Unknown
        }

    private fun reduceStatus(statuses: List<WidgetSyncStatus>): WidgetSyncStatus =
        when {
            statuses.any { it == WidgetSyncStatus.Ok } -> WidgetSyncStatus.Ok
            statuses.any { it == WidgetSyncStatus.FailedWithCache } -> WidgetSyncStatus.FailedWithCache
            statuses.any { it == WidgetSyncStatus.FailedNoCache } -> WidgetSyncStatus.FailedNoCache
            else -> WidgetSyncStatus.Unknown
        }
}
