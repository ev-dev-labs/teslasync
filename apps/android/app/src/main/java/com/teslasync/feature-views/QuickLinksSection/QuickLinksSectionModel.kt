// Pure, framework-free model + projection + diagnostics for the QuickLinks feature view — the native analogue
// of the static composition the web component owns
// (web/src/features/vehicles/components/vehicle-detail/QuickLinksSection.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// QuickLinksSection is a presentational vehicle-detail surface — the web component renders a responsive grid
// (grid-cols-2 sm:grid-cols-3 lg:grid-cols-6) of six navigation shortcuts (Drives, Charging, Battery, Climate,
// Efficiency, Settings), each a GlassPanel wrapped in a router <Link> with a muted icon above a centered label.
// Its ONLY web hook is `useTranslation`; it binds NO data hook and performs NO fetch. As in the sibling QuickNav
// port (another zero-data-source presentational surface), there is therefore no loading / error / stale / offline
// lifecycle to model here — inventing those states would fabricate behaviour the web spec does not have (honesty
// covenant: no silent drift). What the surface genuinely varies is its content: the populated six-item grid (the
// web `quickLinks.map(...)`) and a defensive empty path (shown only if the catalogue is ever empty) so the panel
// is never a blank box. This pure file owns the parts the web render derives before returning JSX:
//   • the ordered shortcut catalogue — the web `quickLinks` array, in fixed
//     Drives → Charging → Battery → Climate → Efficiency → Settings order;
//   • each item's navigation target — the web `link.to` ('/drives' → the Navigation-Compose route "drives", etc.);
//   • the responsive column policy — the native adaptation of the web grid breakpoints.
//
// Navigation parity: the native routes are the canonical `io.teslasync.android.navigation.Destinations` ids for
// the same destination. Most map 1:1 to the web `link.to` path (drives, charging, efficiency, settings). Two are
// documented divergences (never silent): the web `/battery` is the native route id "batteryHealth" (whose path is
// still "/battery"), and the web `/climate` has no exact native page — the equivalent destination is
// "climateControl" (path "/climate-control"), so Climate routes there. The view only emits a [QuickLinkDestination]
// through its callback; the host performs the actual navigation, so the surface stays decoupled from the NavController.
//
// i18n parity: the web `t('nav.x', 'fallback')` keys resolve here through the canonical generated catalog (P1/S10,
// generated from web/src/i18n) at the Compose boundary — no English literal lives in native code.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/QuickLinksSection — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment is illegal in a package identifier), so the package intentionally diverges from the
// path — exactly as the sibling QuickNav / ReferenceLinksSection surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.quicklinks

import io.teslasync.shared.core.diagnostics.Logger

/**
 * One quick-link target — the native analogue of a web `quickLinks` entry's `to` path. The [route] is the
 * Navigation-Compose route the host navigates to (the canonical [io.teslasync.android.navigation.Destinations]
 * route id for the same destination), so the view stays decoupled from the NavController (it emits a
 * [QuickLinkDestination]; the host performs the navigation).
 *
 * @property route the Navigation-Compose route id the host routes to when the tile is tapped.
 */
enum class QuickLinkDestination(
    val route: String,
) {
    /** Web `{ to: '/drives' }` — trip / drive history. */
    Drives("drives"),

    /** Web `{ to: '/charging' }` — charging sessions & costs. */
    Charging("charging"),

    /** Web `{ to: '/battery' }` — battery health & degradation (native route id `batteryHealth`, path `/battery`). */
    Battery("batteryHealth"),

    /** Web `{ to: '/climate' }` — climate control (native `climateControl`, path `/climate-control`; see header). */
    Climate("climateControl"),

    /** Web `{ to: '/efficiency' }` — efficiency analysis. */
    Efficiency("efficiency"),

    /** Web `{ to: '/settings' }` — application settings. */
    Settings("settings"),
}

/**
 * The static quick-link projection — the native analogue of the web `quickLinks` constant the component maps over,
 * plus the responsive column policy. QuickLinksSection has no data source, so the "projection" is a fixed catalogue
 * rather than a transform of fetched data; it is exposed (and unit-tested) here so the composable never hard-codes
 * the list inline and the order / routes / breakpoints are verified off-device.
 */
object QuickLinksProjection {
    /**
     * The six quick-link destinations in the exact web order
     * (Drives → Charging → Battery → Climate → Efficiency → Settings). This is THE list the composable renders.
     */
    val items: List<QuickLinkDestination> = QuickLinkDestination.entries

    /**
     * True when there is nothing to navigate to — drives the composable's defensive empty state so the panel is
     * never a blank box. Always `false` for the static catalogue; exposed for the empty render path + its test.
     */
    val isEmpty: Boolean get() = items.isEmpty()

    /** Inner column count below the medium breakpoint — the web base `grid-cols-2`. */
    const val COMPACT_COLUMNS: Int = 2

    /** Inner column count at the medium breakpoint — the web `sm:grid-cols-3`. */
    const val MEDIUM_COLUMNS: Int = 3

    /** Inner column count at the expanded breakpoint — the web `lg:grid-cols-6`. */
    const val EXPANDED_COLUMNS: Int = 6

    /** Width (dp) at which the grid widens to [MEDIUM_COLUMNS] — the web Tailwind `sm` (~640px) breakpoint. */
    const val MEDIUM_MIN_WIDTH_DP: Int = 600

    /** Width (dp) at which the grid widens to [EXPANDED_COLUMNS] — the web Tailwind `lg` (~1024px) breakpoint. */
    const val EXPANDED_MIN_WIDTH_DP: Int = 1024

    /**
     * The inner column count for the given available width in dp — the native adaptation of the web responsive grid
     * (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`). Framework-free `Int` in / `Int` out so it is JVM-unit-tested
     * without a Compose host.
     *
     * @param maxWidthDp the available width in dp (the composable passes its `BoxWithConstraints` `maxWidth`).
     */
    fun columnsFor(maxWidthDp: Int): Int =
        when {
            maxWidthDp >= EXPANDED_MIN_WIDTH_DP -> EXPANDED_COLUMNS
            maxWidthDp >= MEDIUM_MIN_WIDTH_DP -> MEDIUM_COLUMNS
            else -> COMPACT_COLUMNS
        }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never any user data
 * (QuickLinksSection has none) — so a diagnostics line can never leak anything about the user.
 */
object QuickLinksDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "quick-links"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "QuickLinksSection"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
