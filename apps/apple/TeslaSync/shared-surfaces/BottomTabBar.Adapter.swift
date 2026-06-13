//
//  BottomTabBar.Adapter.swift
//  TeslaSync — P4 shared surface · 0165 · BottomTabBar (Apple)
//
//  The Foundation-only core for the bottom tab bar — the SwiftUI parity of `components/layout/BottomTabBar.tsx`.
//  This file owns the surface identity (the diagnostics slug), the i18n facade seam (the native shape of the
//  web `t(key, default)`), the tab value type (``BottomTabBarTab`` — the web `Tab` row), the canonical
//  ``BottomTabBarCatalog`` (the verbatim port of the web `TABS` constant + the exported `BOTTOM_TAB_PATHS`
//  set), the bound props (``BottomTabBarInput`` — the current route + the tab list), the resolved per-tab
//  ``BottomTabBarTabState`` and whole ``BottomTabBarProjection``, and the pure ``BottomTabBarProjector`` that
//  derives the active tab (the verbatim port of the web `isActive` rule). No SwiftUI and no `@Observable`, so
//  every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<BottomTabBar>` is a PURE presentational primitive. Its only data sources
//  are `useLocation` (the current pathname) and `useTranslation` (the labels) — there is NO fetch, NO
//  React-Query cache, and NO Promise, so it has NO loading, error, stale, or offline branch (there is nothing
//  to fetch, fail, age, or lose connectivity to; the routed pages own their own data states). Inventing such
//  chrome would fabricate states the source does not have, so this surface reproduces only the source's REAL
//  branches — exactly as the accepted sibling presentational primitives Accordion (0203), Label (0218),
//  LinearSidebar (0174), ActiveFilterChips (0147), and StaggerItem (0194) did. The real branches: a tab that
//  is active (route matches its path) vs. inactive, the no-active case (the route matches no tab — e.g. a deep
//  page), and the native "never a blank box" empty catalog.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum BottomTabBarSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "BottomTabBar"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a plain
/// `@Sendable` closure so the pure core has no dependency on a bundle: the production app passes the P1/S10
/// facade, while tests pass an identity-fallback resolver.
public typealias BottomTabBarLocalize = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - BottomTabBarTab (web `Tab`)

/// One tab destination — the native peer of a web `TABS[]` row (`{ path, icon, i18nKey, fallback }`). Carries
/// the route (`path`, the stable id + the navigation target), the SF Symbol (the native peer of the web
/// `lucide-react` glyph), and the label as an i18n key + English fallback (web `i18nKey` / `fallback`) so the
/// sources hold no hardcoded prose.
public struct BottomTabBarTab: Sendable, Equatable, Identifiable {
    /// The route path (web `path`) — the stable id and the value forwarded on navigation.
    public let path: String
    /// The label catalog key (web `i18nKey`).
    public let labelKey: String
    /// The English fallback for the label (web `fallback`).
    public let labelFallback: String
    /// The SF Symbol name (the native peer of the web `lucide-react` icon).
    public let symbol: String

    public var id: String {
        path
    }

    public init(path: String, labelKey: String, labelFallback: String, symbol: String) {
        self.path = path
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.symbol = symbol
    }
}

// MARK: - BottomTabBarCatalog (web `TABS` + `BOTTOM_TAB_PATHS`)

/// Compact factory for a catalog row — keeps each entry on one line within the line-length budget.
private func tab(_ path: String, _ key: String, _ fallback: String, _ symbol: String) -> BottomTabBarTab {
    BottomTabBarTab(path: path, labelKey: key, labelFallback: fallback, symbol: symbol)
}

/// The canonical tab list — the verbatim port of the web `TABS` constant: the top-5 most-trafficked routes a
/// Tesla owner reaches for from their phone (Dashboard → Drives → Charging → Battery → Map), in authored
/// order. The lucide glyphs map to their nearest SF Symbol so the native bar reads the same.
public enum BottomTabBarCatalog {
    /// The five canonical tabs (web `TABS`), in authored order.
    public static let tabs: [BottomTabBarTab] = [
        tab("/", "nav.dashboard", "Home", "house.fill"),
        tab("/drives", "nav.drives", "Drives", "car.fill"),
        tab("/charging", "nav.charging", "Charging", "battery.100.bolt"),
        tab("/battery", "nav.battery", "Battery", "heart.fill"),
        tab("/live", "nav.liveMap", "Map", "mappin.and.ellipse")
    ]

    /// The set of tab routes — the native peer of the web exported `BOTTOM_TAB_PATHS` (used by the shell to
    /// de-emphasize sidebar duplicates on compact idioms).
    public static let paths: Set<String> = Set(tabs.map(\.path))
}

// MARK: - BottomTabBarInput (web props, closure-free)

/// The component's props — the current route (web `useLocation().pathname`) plus the tab list (web `TABS`,
/// defaulting to the canonical catalog). A value type so the view, the state-holder, and the pure projection
/// agree on one shape, and so a SwiftUI `.onChange` can detect a route change cheaply when the host renavigates.
public struct BottomTabBarInput: Sendable, Equatable {
    /// The current route path (web `location.pathname`) — drives the active-tab match.
    public let pathname: String
    /// The tabs to render (web `TABS`) — defaults to the canonical five.
    public let tabs: [BottomTabBarTab]

    public init(pathname: String, tabs: [BottomTabBarTab] = BottomTabBarCatalog.tabs) {
        self.pathname = pathname
        self.tabs = tabs
    }
}

// MARK: - BottomTabBarTabState (resolved per-tab)

/// One resolved tab — everything the SwiftUI item needs as a pure function of the props (no derivation in the
/// view). `label` is the resolved web `t(i18nKey, fallback)`; `isActive` is the web `isActive` flag (drives
/// the theme-primary tint, the icon glow, the accent bar, and `aria-current`).
public struct BottomTabBarTabState: Sendable, Equatable, Identifiable {
    /// The route path (web `path`) — the id + the value forwarded on tap.
    public let path: String
    /// The SF Symbol name (the native peer of the web glyph).
    public let symbol: String
    /// The resolved, localized label (web `t(i18nKey, fallback)`).
    public let label: String
    /// Whether this tab matches the current route (web `isActive`).
    public let isActive: Bool

    public var id: String {
        path
    }

    public init(path: String, symbol: String, label: String, isActive: Bool) {
        self.path = path
        self.symbol = symbol
        self.label = label
        self.isActive = isActive
    }
}

// MARK: - BottomTabBarProjection (render-ready)

/// The resolved, view-ready bar — the bundled output of the web component's render: the per-tab states, the
/// active index (web the matched tab, `nil` when the route matches none), and the nav accessibility label
/// (web `aria-label={t('nav.quickNav', …)}`).
public struct BottomTabBarProjection: Sendable, Equatable {
    /// The resolved tabs, in authored order.
    public let tabs: [BottomTabBarTabState]
    /// The index of the active tab (web matched tab), `nil` when the route matches no tab.
    public let activeIndex: Int?
    /// The navigation region's accessibility label (web `aria-label`).
    public let navigationLabel: String

    public init(tabs: [BottomTabBarTabState], activeIndex: Int?, navigationLabel: String) {
        self.tabs = tabs
        self.activeIndex = activeIndex
        self.navigationLabel = navigationLabel
    }

    /// Whether there is no tab to show at all. The web `TABS` is a fixed non-empty constant, so this is never
    /// true in production; the P4 always-render contract turns an empty tab list into a friendly empty state
    /// instead of a blank box (never a blank box).
    public var isEmpty: Bool {
        tabs.isEmpty
    }
}

// MARK: - BottomTabBarProjector (web render body)

/// The pure projection from the props to the view-ready model — the surface's data adapter in the
/// "state → projection" sense the acceptance calls for: it takes the route a host already holds plus the tab
/// list (no fetch, no clock) and derives the rendered bar. Unit tested across the active-path match, the active
/// index, the label resolution, and the whole projection.
public enum BottomTabBarProjector {
    /// Whether `pathname` activates the tab route `to` — the verbatim port of the web `isActive` rule: `/`
    /// matches only itself; every other route matches an exact hit or a `to/` prefix (so `/charging/123`
    /// activates the Charging tab).
    public static func isActivePath(_ pathname: String, _ to: String) -> Bool {
        if to == "/" { return pathname == "/" }
        return pathname == to || pathname.hasPrefix(to + "/")
    }

    /// The index of the first tab the route activates (web the active tab), `nil` when none match.
    public static func activeIndex(pathname: String, tabs: [BottomTabBarTab]) -> Int? {
        tabs.firstIndex { isActivePath(pathname, $0.path) }
    }

    /// Resolves the whole bar from the route + the tab list + the localizer — the native peer of the web
    /// component's render decision. Each tab's label is resolved through the injected facade, and exactly the
    /// matched tab is flagged active.
    public static func resolve(
        pathname: String,
        tabs: [BottomTabBarTab],
        localize: BottomTabBarLocalize
    ) -> BottomTabBarProjection {
        let active = activeIndex(pathname: pathname, tabs: tabs)
        let states = tabs.enumerated().map { index, item in
            BottomTabBarTabState(
                path: item.path,
                symbol: item.symbol,
                label: localize(item.labelKey, item.labelFallback),
                isActive: index == active
            )
        }
        return BottomTabBarProjection(
            tabs: states,
            activeIndex: active,
            navigationLabel: localize("nav.quickNav", "Quick navigation")
        )
    }

    /// Resolves the whole bar from the bound props + the localizer.
    public static func resolve(input: BottomTabBarInput, localize: BottomTabBarLocalize) -> BottomTabBarProjection {
        resolve(pathname: input.pathname, tabs: input.tabs, localize: localize)
    }
}
