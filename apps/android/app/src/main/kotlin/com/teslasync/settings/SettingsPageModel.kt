// Pure, framework-free metadata + diagnostics for the SettingsPage surface — the native analogue of the
// cross-cutting concerns the web page (web/src/features/settings/pages/SettingsPage.tsx) owns outside its
// rendered tree: the route it is wired to, the legacy web path it mirrors (the Data-Export link target and
// the deep-link payload), the edit-lease key it claims (web `settingsLeaseKey = 'settings/general'`), and
// the one-shot PII-safe `view.opened` diagnostic (P1/S11). No Compose, no Android framework, no HTTP lives
// here so every value is exercised off-device.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/settings — the P3 prompt's allowed-files path) cannot form the `io.teslasync.android.*`
// package the rest of the app uses, so the package intentionally diverges from the path, exactly as the
// sibling A7 page surfaces (notifications/archived, dashboard/glance) do. `MatchingDeclarationName` is
// suppressed for the co-located diagnostics helper.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.settings.page

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical metadata for the SettingsPage surface. The web page is a top-level route, not a draggable
 * dashboard widget, so there is no web registry row to mirror — this object carries the navigation
 * [ROUTE_ID] / [WEB_PATH] the host wires (an existing metadata-only destination at Destinations.kt
 * `page("settings", "/settings", …)`), the [DATA_EXPORT_PATH] the Data-Export card deep-links to (web
 * `<a href="/data-export">`), the [LEASE_KEY] the EditConflictBanner claims (web
 * `settingsLeaseKey = 'settings/general'`), and the diagnostics [SLUG] emitted with the one-shot
 * `view.opened` event (P1/S11).
 */
object SettingsPageRegistration {
    /** The navigation destination id (Destinations.kt `page("settings", "/settings", NavGroup.Settings)`). */
    const val ROUTE_ID: String = "settings"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/settings"

    /** The Data-Export card's link target (web `<a href="/data-export">`). */
    const val DATA_EXPORT_PATH: String = "/data-export"

    /** The per-origin edit-lease key the EditConflictBanner claims (web `settingsLeaseKey`). */
    const val LEASE_KEY: String = "settings/general"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SettingsPage"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SettingsPageRegistration.SLUG]
 * (P1/S11); carries no settings content. The composable calls it from its first-composition effect.
 */
internal fun recordSettingsPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SettingsPageRegistration.SLUG))
}
