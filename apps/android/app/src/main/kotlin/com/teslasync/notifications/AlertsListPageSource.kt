// The data seam the AlertsListPage notifications surface binds to, plus its production binding over the shared-core
// Notifications + Pinned repositories. The view (composable) performs NO HTTP — it only collects state from the
// view-model, which drives this seam, reproducing the web page's reads (`useAlerts` + `useAlertRules` +
// `useAlertDetail` + `usePinned('alert_rule')` and the device-local quiet-hours snapshot) and its three mutations
// (`useMarkAlertRead` -> `POST /alerts/{id}/read`, `useAcknowledgeAlert` -> `POST /alerts/{id}/ack`,
// `useReopenAlert` -> `POST /alerts/{id}/reopen`).
//
// The alert + rule + detail feeds are the shared-core cache-then-network `Resource` streams the S7
// [NotificationsRepository] exposes; the pin feed is the S7 [PinnedRepository] `alert_rule` bucket. The Android DI
// graph ([io.teslasync.android.data.DataContainer]) wires no NotificationsStore yet, so the host constructs the shared
// [io.teslasync.shared.core.data.repo.HttpNotificationsRepository] + [io.teslasync.shared.core.data.repo.HttpPinnedRepository]
// over the SAME resilient client + offline cache the other repositories use (so the ADR-013 freshness contract +
// SI-verbatim caching are identical) and hands them in here — exactly as the sibling DrivesList / Statistics surfaces
// do for their page-local reads. A narrow seam so the view-model depends on an abstraction (real adapters ↔ a test
// fake), never on a concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.notifications.alertslist

import io.teslasync.android.notifications.QuietHours
import io.teslasync.shared.core.data.repo.NotificationsRepository
import io.teslasync.shared.core.data.repo.PinnedRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.notifications.Alert
import io.teslasync.shared.core.presentation.notifications.AlertDetail
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import io.teslasync.shared.core.presentation.pinned.PinnedItemType
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [AlertsListPageViewModel] depends on so it binds to an abstraction (the shared notifications +
 * pinned repositories + a device-local quiet-hours snapshot in production, a fake in tests), never to a concrete
 * repository or the network. The alert / rule / detail / pin reads are cache-then-network `Resource` flows (the web
 * read hooks); the three alert mutations are the page's writes. No HTTP touches the view.
 */
interface AlertsListPageSource {
    /** The cache-then-network `GET /alerts` feed (web `useAlerts`). */
    fun alerts(): Flow<Resource<List<Alert>>>

    /** The cache-then-network `GET /alerts/rules` feed (web `useAlertRules`). */
    fun alertRules(): Flow<Resource<List<AlertRule>>>

    /** The cache-then-network `GET /pinned?type=alert_rule` feed (web `usePinned('alert_rule')`). */
    fun pinnedRules(): Flow<Resource<List<PinnedItem>>>

    /** The cache-then-network `GET /alerts/{id}` feed with its audit timeline (web `useAlertDetail`). */
    fun alertDetail(id: Long): Flow<Resource<AlertDetail>>

    /**
     * The device-local quiet-hours snapshot (web `loadQuietHours()` localStorage read). Returns [QuietHours.Disabled]
     * by default in production — identical to the web's default render when no preference is stored, since the
     * canonical quiet-hours editor lives on the `/notifications/quiet-hours` route (per the web page's own comment);
     * the seam lets a test inject an enabled window to exercise the badge.
     */
    fun quietHours(): QuietHours

    /** Marks an alert read (web `useMarkAlertRead` -> `POST /alerts/{id}/read`). */
    suspend fun markAlertRead(id: Long): Result<Unit>

    /** Acknowledges an alert with an optional note (web `useAcknowledgeAlert` -> `POST /alerts/{id}/ack`). */
    suspend fun acknowledgeAlert(
        id: Long,
        note: String?,
    ): Result<AlertDetail>

    /** Reopens a previously-acknowledged alert (web `useReopenAlert` -> `POST /alerts/{id}/reopen`). */
    suspend fun reopenAlert(id: Long): Result<AlertDetail>
}

/**
 * Binds the surface to the shared **S7** [NotificationsRepository] + [PinnedRepository] (the page-local HTTP adapters
 * the host builds over the shared resilient client + offline cache) and a device-local [quietHours] snapshot. The live
 * cache-then-network values flow through unchanged so the view-model renders the full state matrix (loading / content
 * / empty / error / stale / offline). No HTTP touches the view.
 */
fun alertsListPageSourceOf(
    notifications: NotificationsRepository,
    pinned: PinnedRepository,
    quietHours: QuietHours = QuietHours.Disabled,
): AlertsListPageSource =
    object : AlertsListPageSource {
        override fun alerts(): Flow<Resource<List<Alert>>> = notifications.alerts()

        override fun alertRules(): Flow<Resource<List<AlertRule>>> = notifications.alertRules()

        override fun pinnedRules(): Flow<Resource<List<PinnedItem>>> = pinned.pinned(PinnedItemType.AlertRule)

        override fun alertDetail(id: Long): Flow<Resource<AlertDetail>> = notifications.alertDetail(id)

        override fun quietHours(): QuietHours = quietHours

        override suspend fun markAlertRead(id: Long): Result<Unit> = notifications.markAlertRead(id)

        override suspend fun acknowledgeAlert(
            id: Long,
            note: String?,
        ): Result<AlertDetail> = notifications.acknowledgeAlert(id, note)

        override suspend fun reopenAlert(id: Long): Result<AlertDetail> = notifications.reopenAlert(id)
    }
