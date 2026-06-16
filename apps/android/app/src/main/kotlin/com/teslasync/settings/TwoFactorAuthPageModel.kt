// Pure, framework-free metadata + diagnostics for the TwoFactorAuthPage account-security surface — the native
// analogue of the cross-cutting concerns the web page owns (web/src/features/settings/pages/TwoFactorAuthPage.tsx,
// the dedicated /account/2fa wrapper that promotes per-user TOTP enrollment out of the dense Settings page into a
// first-class "Account" route). No Compose, no Android framework, no HTTP lives here, so the route id + slug are
// exercised off-device and the composable stays a thin render layer. The web page renders no data of its own — it
// sets the page title/subtitle (plus a copy-link affordance) and embeds the shared TOTPEnrollmentSection component
// — so this surface carries only its navigation identity and the one PII-safe `view.opened` diagnostic, with no
// page-level feed to derive (the embedded feature view owns the TOTP status feed + enroll/verify/revoke/regenerate
// mutations).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/settings — the P3 prompt's allowed-files path) cannot form the package the rest of the app's
// `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly as the
// sibling ChannelsPage / ArchivedPage / TeslaRegionPage surfaces do. `MatchingDeclarationName` is suppressed for
// the co-located registration + recorder.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.settings.twofactor

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical metadata for the TwoFactorAuthPage surface. The web page is a top-level account route, not a
 * draggable dashboard widget, so there is no web registry row to mirror — this object carries the cross-cutting
 * concerns the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires (already a metadata-only
 * destination at Destinations.kt) and the diagnostics [SLUG] emitted with the one-shot `view.opened` event
 * (P1/S11). There is no page size or feed metadata because the page renders no data of its own; the embedded
 * TOTPEnrollmentSection feature view owns the TOTP status feed + the enroll/verify/revoke/regenerate mutations.
 */
object TwoFactorAuthPageRegistration {
    /** The navigation destination id (Destinations.kt `page("account2fa", "/account/2fa", …)`). */
    const val ROUTE_ID: String = "account2fa"

    /** The web route this surface mirrors (deep-link target + the copy-link payload). */
    const val WEB_PATH: String = "/account/2fa"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "TwoFactorAuthPage"
}

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no credential state. */
internal fun recordTwoFactorAuthPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to TwoFactorAuthPageRegistration.SLUG))
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"
