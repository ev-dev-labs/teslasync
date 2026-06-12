// The data port the AlertStudioPage feature view binds to (P1/S8 state-holder seam) — the native analogue of
// the web page's data hooks (useAlertRules, useNotificationChannels, useAlertMetrics, useVehicles,
// useSelectedVehicle and the alert-rule mutations). The view never performs HTTP itself; the shared
// NotificationsStore / VehiclesStore / SelectedVehicleStore adapters (or a test fake) drive this. Cache-then-
// network freshness is preserved end to end (ADR-013): every read emission's cached/stale/error flags flow
// through unchanged so the view-model renders the full state matrix (loading / content / empty / error /
// stale / offline) on the rules, channels, metrics, and vehicle feeds.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AlertStudioPage) cannot form a valid Kotlin package identifier, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located binding
// helpers + the lightweight [VehicleRef] projection.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.alertstudiopage

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.AlertRuleSaveRequest
import io.teslasync.shared.core.presentation.notifications.AlertRuleSnoozeRequest
import io.teslasync.shared.core.presentation.notifications.AlertTestRequest
import io.teslasync.shared.core.presentation.notifications.ComputedMetricSummary
import io.teslasync.shared.core.presentation.notifications.NotificationsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map

/** A lightweight vehicle identity for the multi-select + message preview (web `Vehicle` id + display_name). */
data class VehicleRef(
    val id: Long,
    val displayName: String,
)

/** Map the payload of a cache-then-network [Resource] while preserving its freshness flags + variant. */
private fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * The single seam the [AlertStudioPageViewModel] depends on so it binds to an abstraction (real adapter ↔
 * test fake), never to a concrete store or the network. The read members are cache-then-network `Resource`
 * flows (the web read hooks); the suspend members are the alert-rule mutations (the web mutation hooks). No
 * HTTP touches the view — the shared stores (S7/S8) own it.
 */
interface AlertStudioSource {
    /** Stream the alert-rule list (web `useAlertRules`). */
    fun alertRules(): Flow<Resource<List<AlertRule>>>

    /** Stream the external notification channels for test delivery (web `useNotificationChannels`). */
    fun notificationChannels(): Flow<Resource<List<NotificationChannel>>>

    /** Stream the computed-metric registry (web `useAlertMetrics`). */
    fun alertMetrics(): Flow<Resource<List<ComputedMetricSummary>>>

    /** Stream the enrolled-vehicle list for the multi-select (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<VehicleRef>>>

    /** The app-wide selected vehicle id, used by the opt-in AI panels (web `useSelectedVehicle`). */
    fun selectedVehicleId(): StateFlow<Long?>

    /** Create or update a rule (web `useSaveAlertRule`). */
    suspend fun saveAlertRule(request: AlertRuleSaveRequest): Result<Unit>

    /** Delete a rule (web `useDeleteAlertRule`). */
    suspend fun deleteAlertRule(id: Long): Result<Unit>

    /** Flip a rule's enabled flag (web `useToggleAlertRule`). */
    suspend fun toggleAlertRule(
        id: Long,
        enabled: Boolean,
    ): Result<Unit>

    /** Send a test notification (web `useTestAlertRule`). */
    suspend fun testAlertRule(request: AlertTestRequest): Result<Unit>

    /** Snooze (or, with `minutes = 0`, cancel a snooze on) a rule (web `useSnoozeAlertRule`). */
    suspend fun snoozeAlertRule(
        id: Long,
        request: AlertRuleSnoozeRequest,
    ): Result<Unit>

    /** Bulk-enable rules (web `useBulkEnableRules`). */
    suspend fun bulkEnableRules(ids: List<Long>): Result<Unit>

    /** Bulk-disable rules (web `useBulkDisableRules`). */
    suspend fun bulkDisableRules(ids: List<Long>): Result<Unit>
}

/**
 * Binds the surface to the shared **S8** holders — the memoized, multi-observer feeds every notifications
 * surface shares app-wide (web `useAlertRules`/`useNotificationChannels`/`useAlertMetrics`/`useVehicles`/
 * `useSelectedVehicle`) plus the alert-rule mutations. Re-collecting a read feed performs a genuine cache-
 * then-network re-fetch, which backs the surface's retry + post-mutation refresh. No HTTP touches the view.
 */
fun alertStudioSource(
    notifications: NotificationsStore,
    vehicles: VehiclesStore,
    selectedVehicle: SelectedVehicleStore,
): AlertStudioSource =
    object : AlertStudioSource {
        override fun alertRules(): Flow<Resource<List<AlertRule>>> = notifications.alertRules()

        override fun notificationChannels(): Flow<Resource<List<NotificationChannel>>> = notifications.notificationChannels()

        override fun alertMetrics(): Flow<Resource<List<ComputedMetricSummary>>> = notifications.alertMetrics()

        override fun vehicles(): Flow<Resource<List<VehicleRef>>> =
            vehicles.vehicles().map { resource ->
                resource.mapData { list -> list.map { VehicleRef(it.id, it.displayName) } }
            }

        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicle.selectedId

        override suspend fun saveAlertRule(request: AlertRuleSaveRequest): Result<Unit> = notifications.saveAlertRule(request).map { }

        override suspend fun deleteAlertRule(id: Long): Result<Unit> = notifications.deleteAlertRule(id)

        override suspend fun toggleAlertRule(
            id: Long,
            enabled: Boolean,
        ): Result<Unit> = notifications.toggleAlertRule(id, enabled).map { }

        override suspend fun testAlertRule(request: AlertTestRequest): Result<Unit> = notifications.testAlertRule(request)

        override suspend fun snoozeAlertRule(
            id: Long,
            request: AlertRuleSnoozeRequest,
        ): Result<Unit> = notifications.snoozeAlertRule(id, request).map { }

        override suspend fun bulkEnableRules(ids: List<Long>): Result<Unit> = notifications.bulkEnableRules(ids).map { }

        override suspend fun bulkDisableRules(ids: List<Long>): Result<Unit> = notifications.bulkDisableRules(ids).map { }
    }
