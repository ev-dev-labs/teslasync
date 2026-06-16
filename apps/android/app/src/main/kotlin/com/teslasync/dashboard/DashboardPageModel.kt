// Pure, framework-free model + projection for the DashboardPage command-center surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/dashboard/pages/DashboardPage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it references only the shared-core
// AuthStatus DTO and the shared Logger), so the composable stays a thin render layer and the whole derivation can
// be asserted off-device.
//
// The web DashboardPage is a large layout host (widget grid, kiosk mode, undo/redo, templates). The parity
// manifest distils it to its first-run onboarding/auth surface rendered across two GlassPanels:
//   • GlassPanel 1 (onboarding) — the welcome/sync panel whose title, description, and primary action switch on
//     whether the Tesla account is connected (web `auth?.authenticated`): connected ⇒ "Sync Your Vehicles" + the
//     Sync action (web `useSyncVehicles`); not connected ⇒ "Welcome to TeslaSync" + the Connect action.
//   • GlassPanel 2 (feature tiles) — the four capability tiles (Real-time Tracking / Drive History /
//     Charge Analytics / Vehicle Control) the web renders inside the onboarding panel.
// [authenticatedOrDefault] is the 1:1 port of the web `auth?.authenticated ?? false` guard that selects the panel
// copy + action, kept framework-free so the onboarding branch is unit-testable off-device.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/dashboard) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.dashboard

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settings.AuthStatus

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `DashboardPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("dashboard", "/", …)`, so [io.teslasync.android.navigation.PageHosts] binds this surface to that
 * destination (the home `/` route) without the nav module depending on it.
 */
object DashboardPageRegistration {
    /** The navigation destination id (Destinations.kt `page("dashboard", "/", …)`; the `/` route maps here). */
    const val ROUTE_ID: String = "dashboard"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no account state. */
    const val SLUG: String = "DashboardPage"
}

/**
 * Whether the Tesla account is connected — the 1:1 port of the web `auth?.authenticated ?? false` guard the
 * onboarding panel uses to choose its title/description/primary action. A `null` snapshot (auth status not yet
 * loaded, or a hard error with no cache) defaults to `false`, exactly as the web nullish coalesce does, so the
 * panel falls back to the "connect your account" copy rather than promising a sync that cannot run.
 */
fun authenticatedOrDefault(authStatus: AuthStatus?): Boolean = authStatus?.authenticated ?: false

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [DashboardPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no account state, vehicle id, or user identity.
 */
fun recordDashboardPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to DashboardPageRegistration.SLUG))
}
