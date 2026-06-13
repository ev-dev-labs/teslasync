// Pure, framework-free model + projection + diagnostics for the BottomTabBar shared surface — the native
// analogue of everything the web component derives before it returns its <nav> tree
// (web/src/components/layout/BottomTabBar.tsx). No Compose, no Android, no HTTP: every declaration here is
// unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source actually is (and therefore the COMPLETE branch set this surface reproduces): a fixed
// five-item mobile tab bar — Dashboard → Drives → Charging → Battery → Map — over `useLocation()`. The ONLY
// per-render decision the web makes is which single tab is active, computed per tab as:
//
//     isActive = tab.path === '/'
//       ? location.pathname === '/'                                  // the root tab matches ONLY exactly
//       : location.pathname === tab.path                             // an exact match, or…
//         || location.pathname.startsWith(tab.path + '/')            // …a descendant of the tab's section
//
// [BottomTabBarProjection.isActive] reproduces that algorithm verbatim — including the deliberate "+ '/'" that
// stops a sibling section from lighting the tab (e.g. `/charging-curve` must NOT activate the `/charging` tab,
// while `/charging/123` must). The five canonical destinations are taken from the shared
// [io.teslasync.android.navigation.RouteTable.bottomBar] set (which itself "mirrors the web BottomTabBar
// top-5"), so the native bar can never drift from the route table; [BottomTab.entries] is asserted equal to it
// in the projection test.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent here: this
// surface fetches nothing. It is navigation chrome bound to the router state-holder (the `useLocation`
// analogue, P1/S8) whose only input is the already-resolved current path — always present, never a network
// lifecycle. Modelling loading/error/stale/offline would invent behaviour the web spec does not have (honesty
// covenant: no scope narrowing, no silent drift), exactly as the sibling router-driven RouteAnnouncer surface
// documents. The surface's REAL, fully-reproduced state set is: one-of-five tab active, a descendant of a
// section active, and no-tab-active (the current route lives outside the five sections) — each reduced here
// and asserted in the off-device projection test, and rendered (never hidden) by the composable.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/BottomTabBar — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.bottomtabbar

import io.teslasync.android.navigation.Destination
import io.teslasync.android.navigation.Destinations
import io.teslasync.android.navigation.RouteTable
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug is pinned here so the native and web surfaces stay in lockstep.
 */
object BottomTabBarRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "BottomTabBar"
}

/**
 * The five fixed tabs of the mobile bottom bar — the native port of the web `TABS` array, in the same order
 * (Dashboard → Drives → Charging → Battery → Map). Each tab binds to a canonical
 * [io.teslasync.android.navigation.Destination] by id, so the tab's [path] (the web `tab.path`), title key,
 * and icon are read from the single shared route table rather than re-declared. The id set is asserted equal
 * to [RouteTable.bottomBar] in the projection test, so this enum can never silently drift from the app's
 * canonical bottom-bar set.
 *
 * @property destinationId the stable [io.teslasync.android.navigation.Destination] id this tab targets.
 */
enum class BottomTab(
    val destinationId: String,
) {
    /** Web `{ path: '/', icon: Home, i18nKey: 'nav.dashboard' }`. */
    Dashboard("dashboard"),

    /** Web `{ path: '/drives', icon: Car, i18nKey: 'nav.drives' }`. */
    Drives("drives"),

    /** Web `{ path: '/charging', icon: BatteryCharging, i18nKey: 'nav.charging' }`. */
    Charging("charging"),

    /** Web `{ path: '/battery', icon: HeartPulse, i18nKey: 'nav.battery' }`. */
    Battery("batteryHealth"),

    /** Web `{ path: '/live', icon: MapPin, i18nKey: 'nav.liveMap' }`. */
    LiveMap("liveMap"),
    ;

    /** The canonical destination this tab navigates to (web `tab.path` target). */
    val destination: Destination get() = Destinations.require(destinationId)

    /** The tab's web path (web `tab.path`), e.g. `/`, `/drives`, `/charging`, `/battery`, `/live`. */
    val path: String get() = destination.webPath
}

/**
 * Localized labels the surface folds into its output. Built from `stringResource` at the render boundary
 * (tests pass a deterministic instance), keeping [BottomTabBarProjection] a pure, locale-stable function.
 * Every string resolves through the web component's exact i18n keys in the P1/S10 catalog: [navLabel] from
 * `nav.quickNav`, and one label per tab from `nav.dashboard` / `nav.drives` / `nav.charging` / `nav.battery` /
 * `nav.liveMap`.
 *
 * @property navLabel the bar's landmark label (web `aria-label={t('nav.quickNav', 'Quick navigation')}`).
 * @property dashboard the Dashboard tab label (web `nav.dashboard`).
 * @property drives the Drives tab label (web `nav.drives`).
 * @property charging the Charging tab label (web `nav.charging`).
 * @property battery the Battery tab label (web `nav.battery`).
 * @property liveMap the Map tab label (web `nav.liveMap`).
 */
data class BottomTabBarStrings(
    val navLabel: String,
    val dashboard: String,
    val drives: String,
    val charging: String,
    val battery: String,
    val liveMap: String,
) {
    /** The localized label for [tab] (web `t(tab.i18nKey, tab.fallback)`). */
    fun label(tab: BottomTab): String =
        when (tab) {
            BottomTab.Dashboard -> dashboard
            BottomTab.Drives -> drives
            BottomTab.Charging -> charging
            BottomTab.Battery -> battery
            BottomTab.LiveMap -> liveMap
        }
}

/**
 * One rendered tab in the bar — a [tab], its already-localized [label], and whether it is the [active]
 * destination for the current route. Pure data so the projection is unit-tested without a UI host; the
 * composable maps it onto a Material 3 `NavigationBarItem` (icon + label + selected state).
 */
data class BottomTabItem(
    val tab: BottomTab,
    val label: String,
    val active: Boolean,
) {
    /** The canonical destination a tap navigates to (web `<PrefetchLink to={tab.path} />`). */
    val destination: Destination get() = tab.destination
}

/**
 * The immutable, render-ready projection the composable draws — the bar's landmark [navLabel] plus the five
 * [items] with their active flags. Pure data so [BottomTabBarProjection] is unit-tested off-device.
 */
data class BottomTabBarDisplay(
    val navLabel: String,
    val items: List<BottomTabItem>,
) {
    /** The single active tab, or `null` when the current route lives outside all five sections. */
    val activeTab: BottomTab? get() = items.firstOrNull(BottomTabItem::active)?.tab
}

/**
 * Pure active-tab logic + projection for the BottomTabBar surface — the native port of the web component's
 * per-tab `isActive` derivation. Framework-free so the whole active-state contract is covered by the JVM unit
 * gate without a Compose host.
 */
object BottomTabBarProjection {
    /** The root path the Dashboard tab matches only exactly (web `tab.path === '/'`). */
    const val ROOT_PATH: String = "/"

    /**
     * Whether the tab at [tabPath] is active for [currentPath] — a verbatim port of the web `isActive`:
     * the root tab (`/`) matches ONLY an exact root path; every other tab matches its own path exactly OR any
     * descendant of it (`startsWith(tab.path + '/')`). The trailing slash is deliberate: it keeps a sibling
     * section from lighting the tab (`/charging-curve` does not activate `/charging`, while `/charging/123`
     * does). [currentPath] is normalized first so a stray trailing slash or query string can never flip the
     * result.
     */
    fun isActive(
        currentPath: String,
        tabPath: String,
    ): Boolean {
        val path = RouteTable.normalize(currentPath)
        return if (tabPath == ROOT_PATH) {
            path == ROOT_PATH
        } else {
            path == tabPath || path.startsWith("$tabPath/")
        }
    }

    /**
     * Folds the current route's [currentPath] (the `useLocation().pathname` analogue) together with the
     * localized [strings] into the render-ready [BottomTabBarDisplay]: the bar's landmark label and the five
     * tabs with each one's active flag resolved by [isActive]. The current path is normalized once so the
     * five per-tab checks share a single canonical input.
     */
    fun project(
        currentPath: String,
        strings: BottomTabBarStrings,
    ): BottomTabBarDisplay {
        val normalized = RouteTable.normalize(currentPath)
        val items =
            BottomTab.entries.map { tab ->
                BottomTabItem(
                    tab = tab,
                    label = strings.label(tab),
                    active = isActive(normalized, tab.path),
                )
            }
        return BottomTabBarDisplay(navLabel = strings.navLabel, items = items)
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the route
 * path nor the active tab — so a diagnostics line can never leak which screen a user is on.
 */
object BottomTabBarDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = BottomTabBarRegistration.SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
