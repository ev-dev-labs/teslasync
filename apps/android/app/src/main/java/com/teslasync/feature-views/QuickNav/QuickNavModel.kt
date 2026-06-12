// Pure, framework-free model + projection + diagnostics for the QuickNav feature view — the native analogue of
// the static composition the web component owns
// (web/src/features/dashboard/components/QuickNav.tsx). No Compose, no Android, no HTTP: every declaration here
// is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// QuickNav is a presentational dashboard surface — the web component renders a fixed 2×2 / 1×4 grid of four
// navigation shortcuts (Drives, Charging, Analytics, Battery), each a GlassPanel with an accent-tinted icon, a
// title, a one-line description, and a trailing chevron, wrapped in a router <Link>. Its ONLY web hook is
// `useTranslation`; it binds NO data hook and performs NO fetch. As in the sibling ToolCard port (another
// zero-data-source presentational surface), there is therefore no loading / error / stale / offline lifecycle to
// model here — inventing those states would fabricate behaviour the web spec does not have (honesty covenant:
// no silent drift). What the surface genuinely varies is its content: the populated four-item grid (the web
// `NAV_ITEMS.map(...)`) and a defensive empty path (shown only if the catalogue is ever empty) so the panel is
// never a blank box. This pure file owns the parts the web render derives before returning JSX:
//   • the ordered nav catalogue — the web `NAV_ITEMS` array, in fixed Drives→Charging→Analytics→Battery order;
//   • each item's navigation target — the web `nav.to` ('/drives' → the Navigation-Compose route "drives", etc.);
//   • each item's accent — the web per-item `color` hex, modelled as a token-mapped [QuickNavAccent] (resolved to
//     a design-token Color at the Compose boundary, never a hard-coded hex — see the composable).
//
// Icon parity: the web uses lucide `Route` / `BatteryCharging` / `Gauge` / `Activity`. The first three map 1:1 to
// the vendored component glyphs; the vendored components layer ships no `Activity`/pulse glyph, so the Battery
// item substitutes the components `Battery` glyph (the same family the app's own BatteryEnergy nav group uses) —
// the one documented, intentional icon divergence. The icon → glyph mapping lives at the Compose boundary.
//
// i18n parity: the web `t('nav.x', 'fallback')` keys are inline-fallback keys that are NOT present in the shared
// i18n catalog; the canonical catalog (P1/S10, generated from web/src/i18n) is the source of truth. Each item's
// label + description resolve through that catalog at the Compose boundary (no English literal in native code).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/QuickNav — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen segment is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling ToolCard / AcDcStatsPanel surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.quicknav

import io.teslasync.shared.core.diagnostics.Logger

/**
 * One quick-navigation target — the native analogue of a web `NAV_ITEMS` entry's `to` path. The [route] is the
 * Navigation-Compose route the host navigates to (the web `nav.to` with its leading slash removed, matching the
 * canonical [io.teslasync.android.navigation.Destinations] route for the same destination), so the view stays
 * decoupled from the NavController (it emits a [QuickNavDestination], the host performs the navigation).
 *
 * @property route the Navigation-Compose route id (web `nav.to`: `/drives` → `drives`, `/battery` → `battery`).
 */
enum class QuickNavDestination(
    val route: String,
) {
    /** Web `{ to: '/drives' }` — trip/drive history. */
    Drives("drives"),

    /** Web `{ to: '/charging' }` — charging sessions & costs. */
    Charging("charging"),

    /** Web `{ to: '/analytics' }` — fleet analytics & insights. */
    Analytics("analytics"),

    /** Web `{ to: '/battery' }` — battery health & degradation. */
    Battery("battery"),
}

/**
 * A quick-nav accent — the native, theme-safe analogue of a web `NAV_ITEMS` entry's `color` hex. Kept as a
 * semantic enum (not a raw hex) so the Compose boundary resolves it to a design token that adapts to
 * light/dark/high-contrast, exactly as the sibling ToolCard port maps its accents. The dark-theme tokens equal
 * the web hexes: [Cyan] #00F0FF, [Green] #10B981, [Purple] #A855F7, [Amber] #F59E0B.
 */
enum class QuickNavAccent {
    /** Web `#00f0ff` (Drives). */
    Cyan,

    /** Web `#10b981` (Charging). */
    Green,

    /** Web `#a855f7` (Analytics). */
    Purple,

    /** Web `#f59e0b` (Battery). */
    Amber,
}

/**
 * One render-ready quick-nav item — the native mirror of a web `NAV_ITEMS` entry. Pure data (no Compose/Android
 * types) so the catalogue is fully covered by the off-device unit gate; the localized label/description, the
 * glyph, and the accent Color are resolved at the Compose boundary keyed off [destination] and [accent].
 *
 * @property destination the navigation target (carries the route + identity).
 * @property accent the per-item accent (web `color`).
 */
data class QuickNavItem(
    val destination: QuickNavDestination,
    val accent: QuickNavAccent,
)

/**
 * The static quick-nav projection — the native analogue of the web `NAV_ITEMS` constant the component maps over.
 * QuickNav has no data source, so the "projection" is a fixed catalogue rather than a transform of fetched data;
 * it is exposed (and unit-tested) here so the composable never hard-codes the list inline and the order /
 * routes / accents are verified off-device.
 */
object QuickNavProjection {
    /**
     * The four quick-nav items in the exact web order (Drives → Charging → Analytics → Battery), each paired
     * with the accent the web entry carries. This is THE list the composable renders.
     */
    val items: List<QuickNavItem> =
        listOf(
            QuickNavItem(QuickNavDestination.Drives, QuickNavAccent.Cyan),
            QuickNavItem(QuickNavDestination.Charging, QuickNavAccent.Green),
            QuickNavItem(QuickNavDestination.Analytics, QuickNavAccent.Purple),
            QuickNavItem(QuickNavDestination.Battery, QuickNavAccent.Amber),
        )

    /**
     * True when there is nothing to navigate to — drives the composable's defensive empty state so the panel is
     * never a blank box. Always `false` for the static catalogue; exposed for the empty render path + its test.
     */
    val isEmpty: Boolean get() = items.isEmpty()
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never any user
 * data (QuickNav has none) — so a diagnostics line can never leak anything about the user.
 */
object QuickNavDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "quick-nav"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "QuickNav"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
