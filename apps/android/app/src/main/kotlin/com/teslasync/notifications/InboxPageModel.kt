// Pure, framework-free model + metadata for the InboxPage notifications surface — the native analogue of the
// top-level web inbox route (web/src/features/notifications/pages/InboxPage.tsx), which renders the page chrome
// (PageContainer title + subtitle + copy-link + the "View archived" action) and hands the shared
// <InboxBody archived={false}/> the active (non-archived) inbox. No Compose, no Android framework, no HTTP lives
// here so every type is exercised off-device, keeping the composable a thin render layer.
//
// The page owns only two web hooks (`useVehicles`, `useAlertRules`); the shared A3 InboxBody owns the
// notification-log feeds. The rule + vehicle lists are joined onto each notification row by the SAME framework-
// free helpers the sibling ArchivedPage authored (`toInboxNotifications` / `toInboxGroups` / `mapData` in
// ArchivedPageModel.kt, package `io.teslasync.android.notifications.archived`); the web shares that exact join
// inside InboxBody.tsx for both routes, so this surface reuses it rather than duplicating it (DRY) and the
// view-model imports it directly. This file carries only what is unique to the inbox route: its navigation
// metadata, its non-archived feed filter, and its diagnostics slug.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/notifications — the P3 prompt's allowed-files path) cannot form the package the rest of the
// app's `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly
// as the sibling ArchivedPage / FeedbackQueuePage surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.notifications.inbox

import io.teslasync.android.navigation.RouteTable
import io.teslasync.shared.core.data.repo.NotificationFilters
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical metadata for the InboxPage surface. The web page is a top-level notifications route, not a
 * draggable dashboard widget, so there is no web registry row to mirror — this object carries the cross-cutting
 * concerns the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires (already a metadata-only
 * destination at Destinations.kt), the two forward-navigation targets the page links to (the "View archived"
 * action and the empty-state "Configure alert rules" CTA), and the diagnostics [SLUG] emitted with the one-shot
 * `view.opened` event (P1/S11).
 */
object InboxPageRegistration {
    /** The navigation destination id (Destinations.kt `page("notificationsInbox", "/notifications/inbox", …)`). */
    const val ROUTE_ID: String = "notificationsInbox"

    /** The web route this surface mirrors (deep-link target + the copy-link payload). */
    const val WEB_PATH: String = "/notifications/inbox"

    /** The Archive tab this page's "View archived" action links to (web `<Link to="/notifications/archived">`). */
    const val ARCHIVED_PATH: String = "/notifications/archived"

    /** The rules studio the empty-state CTA links to (web `actionTo.to = '/notifications/studio'`). */
    const val STUDIO_PATH: String = "/notifications/studio"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "InboxPage"

    /** The in-app deep-link URI for [ARCHIVED_PATH], fed to the [DeepLinkRouter] for "View archived". */
    val archivedDeepLink: String get() = deepLinkFor(ARCHIVED_PATH)

    /** The in-app deep-link URI for [STUDIO_PATH], fed to the [DeepLinkRouter] for the empty-state CTA. */
    val studioDeepLink: String get() = deepLinkFor(STUDIO_PATH)

    /** Builds the `teslasync://app/...` deep-link the Navigation-Compose graph consumes for [webPath]. */
    private fun deepLinkFor(webPath: String): String = "${RouteTable.APP_SCHEME}://app$webPath"
}

/**
 * The notification-log filter the page scopes its feeds to — the web `archived={false}` prop turned into the
 * `archived=false` server filter the shared `useNotificationLogs` / `useNotificationGroups` reads carry on the
 * active Inbox tab. Every other field defaults so the page asks the backend only for live (non-archived) rows.
 */
val INBOX_FILTERS: NotificationFilters = NotificationFilters(archived = false)

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [InboxPageRegistration.SLUG] (P1/S11);
 * carries no notification content. The composable calls it from its first-composition effect.
 */
internal fun recordInboxPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to InboxPageRegistration.SLUG))
}
