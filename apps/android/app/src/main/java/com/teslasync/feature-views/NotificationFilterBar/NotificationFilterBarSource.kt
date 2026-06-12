// The data port the NotificationFilterBar feature view binds to (P1/S8 state-holder seam) — the native
// analogue of the single Notifications data dependency the web component pulls from its hook domain
// (web/src/features/notifications/components/NotificationFilterBar.tsx imports the `NotificationFilters`
// type from `@/api/hooks/useNotifications`, and the Rule dropdown is populated from that same domain's
// alert-rule list). The view never performs HTTP itself; the [NotificationsStore]-backed adapter (or a
// test fake) drives this. Cache-then-network freshness is preserved end to end (ADR-013): the alert-rule
// feed's cached/stale/error flags flow straight through so the view-model can render the full state matrix.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/NotificationFilterBar) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.notificationfilterbar

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.NotificationsStore
import kotlinx.coroutines.flow.Flow

/**
 * Streams the cache-then-network alert-rule list the filter bar offers in its Rule dropdown. A single-method
 * seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete store or
 * the network.
 */
fun interface NotificationFilterBarSource {
    /** The cache-then-network alert-rule feed (cached value first for an instant cold start, then refreshed). */
    fun streamRules(): Flow<Resource<List<AlertRule>>>
}

/**
 * Binds the surface to the shared **S8** [NotificationsStore.alertRules] feed — the `GET /alerts/rules` list
 * every Notifications surface shares (web `useAlertRules`, part of the `useNotifications` hook domain).
 * Re-collecting it performs a genuine cache-then-network re-fetch, backing the bar's manual refresh
 * affordance. No HTTP touches the view — the store (S7/S8) owns it.
 */
fun notificationFilterBarSource(notifications: NotificationsStore): NotificationFilterBarSource =
    NotificationFilterBarSource { notifications.alertRules() }
