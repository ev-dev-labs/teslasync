// File hosts the AlertFeed data seam + its shared-layer bindings; named after the surface bundle
// (AlertFeedWidget*) rather than the single interface it declares.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.alertfeed

import io.teslasync.shared.core.data.repo.NotificationsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.notifications.Alert
import io.teslasync.shared.core.presentation.notifications.NotificationsStore
import kotlinx.coroutines.flow.Flow

/**
 * The data port the [AlertFeedWidgetViewModel] binds to — the Android analogue of the web `useAlerts`
 * hook and the Windows `IAlertFeedSource` seam (P1/S8 state-holder boundary). Each [stream] is a fresh
 * cache-then-network [Resource] flow of the alert inbox; the view never performs HTTP itself. A test
 * fake stands in for the whole domain, and a re-collection (the ViewModel's refresh/retry) restarts a
 * fresh upstream so a manual refresh actually re-fetches.
 */
fun interface AlertFeedSource {
    /** Stream the cache-then-network alert snapshots (`GET /alerts`), newest data following cache. */
    fun stream(): Flow<Resource<List<Alert>>>
}

/**
 * Binds the surface to the shared S7 [NotificationsRepository] — the same cache-then-network data
 * port the `NotificationsStore` itself wraps. Each [AlertFeedSource.stream] starts a new
 * `repository.alerts()` collection, so the ViewModel's refresh/retry trigger a real re-fetch.
 */
fun alertFeedSource(repository: NotificationsRepository): AlertFeedSource = AlertFeedSource { repository.alerts() }

/**
 * Binds the surface to the shared S8 [NotificationsStore] holder (web `useAlerts` port). Use this when
 * a host shares one app-wide alert feed across surfaces; the store folds every observer of `alerts()`
 * into a single upstream collection.
 */
fun alertFeedSource(store: NotificationsStore): AlertFeedSource = AlertFeedSource { store.alerts() }
