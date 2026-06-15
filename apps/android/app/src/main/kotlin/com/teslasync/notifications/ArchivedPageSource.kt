// The data seam the ArchivedPage notifications surface binds to, plus its production binding over the shared
// resilient client (via a [NotificationsRepository]) and the shared S8 VehiclesStore. The view (composable)
// performs NO HTTP — it only collects state from the view-model, which drives this seam, reproducing the web
// page's reads (`useVehicles`, `useAlertRules`) PLUS the notification-log feeds the web ArchivedPage hands to
// <InboxBody archived/> (`useNotificationLogs`, `useNotificationGroups`) and the inbox mutations the shared
// component owns (`useMark…` / `useArchive…` / `useDelete…` / `useBulkMarkRead`).
//
// The two notification-log feeds + the alert-rule feed are the cache-then-network [Resource] streams the
// shared S7 [NotificationsRepository] exposes; binding directly to the repository (rather than the S8
// NotificationsStore) gives the view-model explicit control over the refresh the InboxBody freshness contract
// drives (the store memoizes its feeds but exposes no public refresh). The vehicle list is the shared S8
// [VehiclesStore] feed, read for the row enrichment only. A narrow seam so the view-model depends on an
// abstraction (real adapter ↔ test fake), never on a concrete client or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.notifications.archived

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.NotificationsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.BulkMarkReadVars
import io.teslasync.shared.core.presentation.notifications.DeletedCountResult
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import io.teslasync.shared.core.presentation.notifications.NotificationLogGroup
import io.teslasync.shared.core.presentation.notifications.UpdatedCountResult
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * The single seam the [ArchivedPageViewModel] depends on so it binds to an abstraction (the shared
 * notifications repository + the shared Vehicles holder in production, fakes in tests), never to a concrete
 * client or the network. The two log reads are the page's archived cache-then-network `Resource` feeds (web
 * `useNotificationLogs` / `useNotificationGroups` with `archived=true`); [alertRules] + [vehicles] are the
 * page's two own hooks used to label rows; the mutations are the InboxBody's non-throwing inbox writes. No
 * HTTP touches the view.
 */
interface ArchivedPageSource {
    /** The `GET /notifications/logs?archived=true` flat feed (web `useNotificationLogs`). */
    fun notificationLogs(): Flow<Resource<List<NotificationLog>>>

    /** The `GET /notifications/logs?grouped=true&archived=true` thread feed (web `useNotificationGroups`). */
    fun notificationGroups(): Flow<Resource<List<NotificationLogGroup>>>

    /** The `GET /alerts/rules` feed used to label rows + decide drill-through (web `useAlertRules`). */
    fun alertRules(): Flow<Resource<List<AlertRule>>>

    /** The shared `GET /vehicles` list feed used for the row vehicle label (web `useVehicles`). */
    fun vehicles(): StateFlow<Resource<List<Vehicle>>>

    /** Marks rows read (web `useMarkNotificationsRead`). */
    suspend fun markRead(ids: List<Long>): Result<UpdatedCountResult>

    /** Marks rows unread (web `useMarkNotificationsUnread`). */
    suspend fun markUnread(ids: List<Long>): Result<UpdatedCountResult>

    /** Archives rows (web `useArchiveNotifications`); not offered on the Archive tab itself. */
    suspend fun archive(ids: List<Long>): Result<UpdatedCountResult>

    /** Restores (unarchives) rows (web `useUnarchiveNotifications`) — the Archive tab's primary write. */
    suspend fun unarchive(ids: List<Long>): Result<UpdatedCountResult>

    /** Deletes rows (web `useDeleteNotifications`). */
    suspend fun delete(ids: List<Long>): Result<DeletedCountResult>

    /** Bulk mark-read by ids/all/group (web `useBulkMarkRead`). */
    suspend fun bulkMarkRead(vars: BulkMarkReadVars): Result<UpdatedCountResult>
}

/**
 * Binds the surface to the shared resilient [repo] (its archived log/group/rule feeds + inbox mutations) and
 * the shared S8 [vehiclesStore] (the vehicle list for row labels). The log + rule reads are the same
 * cache-then-network `Resource` flows every repository runs on, scoped to the [ARCHIVED_FILTERS]; the vehicle
 * feed flows through unchanged so the view-model renders the full state matrix (loading / content / empty /
 * stale / offline / error). No HTTP touches the view.
 */
fun archivedPageSourceOf(
    repo: NotificationsRepository,
    vehiclesStore: VehiclesStore,
): ArchivedPageSource =
    object : ArchivedPageSource {
        override fun notificationLogs(): Flow<Resource<List<NotificationLog>>> = repo.notificationLogs(ARCHIVED_FILTERS)

        override fun notificationGroups(): Flow<Resource<List<NotificationLogGroup>>> = repo.notificationGroups(ARCHIVED_FILTERS)

        override fun alertRules(): Flow<Resource<List<AlertRule>>> = repo.alertRules()

        override fun vehicles(): StateFlow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override suspend fun markRead(ids: List<Long>): Result<UpdatedCountResult> = repo.markNotificationsRead(ids)

        override suspend fun markUnread(ids: List<Long>): Result<UpdatedCountResult> = repo.markNotificationsUnread(ids)

        override suspend fun archive(ids: List<Long>): Result<UpdatedCountResult> = repo.archiveNotifications(ids)

        override suspend fun unarchive(ids: List<Long>): Result<UpdatedCountResult> = repo.unarchiveNotifications(ids)

        override suspend fun delete(ids: List<Long>): Result<DeletedCountResult> = repo.deleteNotifications(ids)

        override suspend fun bulkMarkRead(vars: BulkMarkReadVars): Result<UpdatedCountResult> = repo.bulkMarkRead(vars)
    }
