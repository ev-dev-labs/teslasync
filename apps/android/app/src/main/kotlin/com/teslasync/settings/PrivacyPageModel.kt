// Pure, framework-free metadata + diagnostics for the settings/PrivacyPage surface — the native analogue
// of the cross-cutting concerns the web page owns (web/src/features/settings/pages/PrivacyPage.tsx, the
// dedicated /account/privacy wrapper that promotes the browser-local privacy controls — recently-viewed
// pages + cookie/analytics consent — out of the dense Settings page into a first-class Account route). No
// Compose, no Android framework, no HTTP lives here, so the route id + slug are exercised off-device and
// the composable stays a thin render layer. The web page renders no data of its own — it sets the page
// title/subtitle (plus a copy-link affordance) and embeds the shared PrivacySection component — so this
// surface carries only its navigation identity and the one PII-safe `view.opened` diagnostic, with no
// page-level feed to derive.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/settings — the P3 prompt's allowed-files path) cannot form the package the rest of the
// app's `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path —
// exactly as the sibling notifications ChannelsPage / WebhooksPage surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located registration + recorder.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.settings.privacy

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical metadata for the PrivacyPage surface. The web page is a top-level Account route, not a
 * draggable dashboard widget, so there is no web registry row to mirror — this object carries the
 * cross-cutting concerns the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires (already
 * a metadata-only destination at Destinations.kt `page("accountPrivacy", "/account/privacy", …)`) and the
 * diagnostics [SLUG] emitted with the one-shot `view.opened` event (P1/S11). There is no page size or feed
 * metadata because the page renders no data of its own; the embedded PrivacySection feature view owns the
 * recent-pages + cookie-consent client state and its own diagnostics.
 */
object PrivacyPageRegistration {
    /** The navigation destination id (Destinations.kt `page("accountPrivacy", "/account/privacy", …)`). */
    const val ROUTE_ID: String = "accountPrivacy"

    /** The web route this surface mirrors (deep-link target + the copy-link payload). */
    const val WEB_PATH: String = "/account/privacy"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "PrivacyPage"
}

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no user state. */
internal fun recordPrivacyPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to PrivacyPageRegistration.SLUG))
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"
