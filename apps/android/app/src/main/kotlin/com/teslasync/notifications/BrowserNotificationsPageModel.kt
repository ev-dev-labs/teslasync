// Pure, framework-free metadata + diagnostics for the BrowserNotificationsPage notifications surface — the
// native analogue of the cross-cutting concerns the web page owns
// (web/src/features/notifications/pages/BrowserNotificationsPage.tsx, the dedicated /notifications/browser
// wrapper that promotes the browser/OS push-notification setup surface to a first-class notifications route).
// No Compose, no Android framework, no HTTP lives here, so the route id + slug are exercised off-device and the
// composable stays a thin render layer. The web page renders no data of its own — it sets the page
// title/subtitle and embeds the shared NotificationSettings component — so this surface carries only its
// navigation identity and the one PII-safe `view.opened` diagnostic, with no page-level feed to derive.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/notifications — the P3 prompt's allowed-files path) cannot form the package the rest of the
// app's `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly
// as the sibling A7 surfaces do. `MatchingDeclarationName` is suppressed for the co-located registration +
// recorder.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.notifications.browser

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical metadata for this surface. The web page is a top-level notifications route, not a draggable
 * dashboard widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns
 * the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires and the diagnostics [SLUG] emitted
 * with the one-shot `view.opened` event (P1/S11). There is no page size or feed metadata because the page
 * renders no data of its own; the embedded NotificationSettings feature view owns the `/settings` feed and the
 * device-local notification preferences.
 */
object BrowserNotificationsPageRegistration {
    /** The navigation destination id (Destinations.kt `page("notificationsBrowser", "/notifications/browser", …)`). */
    const val ROUTE_ID: String = "notificationsBrowser"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/notifications/browser"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "BrowserNotificationsPage"
}

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no notification content. */
internal fun recordBrowserNotificationsPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to BrowserNotificationsPageRegistration.SLUG))
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"
