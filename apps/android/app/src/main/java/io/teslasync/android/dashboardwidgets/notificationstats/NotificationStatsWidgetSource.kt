// File hosts the NotificationStats data seam + its shared-layer bindings; named after the surface
// bundle (NotificationStatsWidget*) rather than the single interface it declares.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.notificationstats

import io.teslasync.shared.core.data.repo.NotificationsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import io.teslasync.shared.core.presentation.notifications.NotificationStats
import io.teslasync.shared.core.presentation.notifications.NotificationsStore
import kotlinx.coroutines.flow.Flow

/**
 * The data port the [NotificationStatsWidgetViewModel] binds to — the Android analogue of the web
 * `useNotificationStats` + `useNotificationLogs` hook pair and the P1/S8 state-holder boundary. The
 * widget reads two feeds: the aggregate delivery [stats] and the recent delivery [logs]. Each call
 * returns a fresh cache-then-network [Resource] flow so the ViewModel's refresh/retry restart a real
 * upstream collection; the view never performs HTTP itself. A test fake stands in for the whole seam.
 */
interface NotificationStatsSource {
    /** Stream the cache-then-network notification stats (`GET /notifications/stats`). */
    fun stats(): Flow<Resource<NotificationStats>>

    /** Stream the cache-then-network recent delivery log (`GET /notifications/logs`). */
    fun logs(): Flow<Resource<List<NotificationLog>>>
}

/**
 * Binds the surface to the shared S7 [NotificationsRepository] — the same cache-then-network data
 * port the `NotificationsStore` wraps. Each [NotificationStatsSource.stats]/[NotificationStatsSource.logs]
 * call starts a new repository collection, so the ViewModel's refresh/retry trigger a real re-fetch.
 */
fun notificationStatsSource(repository: NotificationsRepository): NotificationStatsSource =
    object : NotificationStatsSource {
        override fun stats(): Flow<Resource<NotificationStats>> = repository.notificationStats()

        override fun logs(): Flow<Resource<List<NotificationLog>>> = repository.notificationLogs()
    }

/**
 * Binds the surface to the shared S8 [NotificationsStore] holder (web `useNotificationStats` /
 * `useNotificationLogs` ports). Use this when a host shares one app-wide notifications feed across
 * surfaces; the store folds every observer of each feed into a single upstream collection and owns
 * refresh via its own invalidation triggers.
 */
fun notificationStatsSource(store: NotificationsStore): NotificationStatsSource =
    object : NotificationStatsSource {
        override fun stats(): Flow<Resource<NotificationStats>> = store.notificationStats()

        override fun logs(): Flow<Resource<List<NotificationLog>>> = store.notificationLogs()
    }
