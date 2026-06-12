//
//  Layout.Projector.swift
//  TeslaSync — P4 shared surface · 0169 · Layout (Apple)
//
//  The pure navigation resolver for the app shell — the verbatim port of the web `Layout.tsx` nav derivation
//  (`isVisibleNavItem`, `isActiveNavPath`, `findNavItemByPath` / `findNavItemByExactPath`, `visibleNavSections`,
//  `pinnedNavItems`, `recentNavItems`, `pinNavPath` / `unpinNavPath`, `toggleSection`, and the per-item count
//  badges). Every function is a free, bundle-free transform so the unit tests reach it without a rendered
//  view. No SwiftUI; no clock; no storage.
//

import Foundation

/// The pure nav resolver — the web shell's derivation expressed as free functions over the catalog + the
/// dynamic state (the current route, fleet size, auth mode, pin/recent paths, expanded set, badge counts).
public enum LayoutProjector {
    // MARK: Visibility (web `isVisibleNavItem`)

    /// Whether an item is visible — the verbatim port of `isVisibleNavItem`: hidden when the fleet is below
    /// its `minVehicles` floor, or when it `requiresAuth` and the deployment is not behind ForwardAuth.
    public static func isVisible(_ item: LayoutNavItem, vehicleCount: Int, isForwardAuth: Bool) -> Bool {
        if item.minVehicles > 0, vehicleCount < item.minVehicles { return false }
        if item.requiresAuth, !isForwardAuth { return false }
        return true
    }

    // MARK: Active path (web `isActiveNavPath`)

    /// Whether `pathname` activates the route `to` — the verbatim port of `isActiveNavPath`: `/` matches only
    /// itself; every other route matches an exact hit or a `to/` prefix.
    public static func isActivePath(_ pathname: String, _ to: String) -> Bool {
        if to == "/" { return pathname == "/" }
        return pathname == to || pathname.hasPrefix(to + "/")
    }

    // MARK: Lookups (web `findNavItemByPath` / `findNavItemByExactPath`)

    /// The first item whose route activates `pathname` (web `findNavItemByPath`), with its owning section.
    public static func findByPath(_ pathname: String, in sections: [LayoutNavSection]) -> LayoutActiveEntry? {
        for section in sections {
            if let item = section.items.first(where: { isActivePath(pathname, $0.to) }) {
                return LayoutActiveEntry(sectionTitle: section.title, item: item)
            }
        }
        return nil
    }

    /// The item with the exact route `to` (web `findNavItemByExactPath`), with its owning section.
    public static func findByExactPath(_ to: String, in sections: [LayoutNavSection]) -> LayoutActiveEntry? {
        for section in sections {
            if let item = section.items.first(where: { $0.to == to }) {
                return LayoutActiveEntry(sectionTitle: section.title, item: item)
            }
        }
        return nil
    }

    // MARK: Visible sections (web `visibleNavSections`)

    /// The catalog filtered to visible items, with now-empty sections dropped — the verbatim port of
    /// `visibleNavSections`.
    public static func visibleSections(
        _ sections: [LayoutNavSection],
        vehicleCount: Int,
        isForwardAuth: Bool
    ) -> [LayoutNavSection] {
        sections
            .map { section in
                LayoutNavSection(
                    title: section.title,
                    items: section.items
                        .filter { isVisible($0, vehicleCount: vehicleCount, isForwardAuth: isForwardAuth) }
                )
            }
            .filter { !$0.items.isEmpty }
    }

    // MARK: Pinned / recent (web `pinnedNavItems` / `recentNavItems`)

    /// The resolved pinned items in pin order — the verbatim port of `pinnedNavItems`: resolve each pinned
    /// path to its item and keep only the visible ones.
    public static func pinnedItems(
        paths: [String],
        sections: [LayoutNavSection],
        vehicleCount: Int,
        isForwardAuth: Bool
    ) -> [LayoutNavItem] {
        paths
            .compactMap { findByExactPath($0, in: sections)?.item }
            .filter { isVisible($0, vehicleCount: vehicleCount, isForwardAuth: isForwardAuth) }
    }

    /// The resolved recent items — the verbatim port of `recentNavItems`: resolve each recent path, keep the
    /// visible ones, and drop the row for the current page (it is highlighted in its canonical section).
    public static func recentItems(
        paths: [String],
        sections: [LayoutNavSection],
        vehicleCount: Int,
        isForwardAuth: Bool,
        activePathname: String
    ) -> [LayoutNavItem] {
        paths
            .compactMap { findByExactPath($0, in: sections)?.item }
            .filter { isVisible($0, vehicleCount: vehicleCount, isForwardAuth: isForwardAuth) }
            .filter { !isActivePath(activePathname, $0.to) }
    }

    // MARK: Pin mutators (web `pinNavPath` / `unpinNavPath`)

    /// Pin a route — the verbatim port of `pinNavPath`: a no-op if already pinned, else prepend and cap at
    /// `maxPinned`.
    public static func pin(_ paths: [String], _ to: String, max: Int = LayoutNavLimits.maxPinned) -> [String] {
        if paths.contains(to) { return paths }
        return Array(([to] + paths).prefix(max))
    }

    /// Unpin a route — the verbatim port of `unpinNavPath`.
    public static func unpin(_ paths: [String], _ to: String) -> [String] {
        paths.filter { $0 != to }
    }

    /// Record a visit into the recent list — the verbatim port of the web recent-path effect: `/`, pinned,
    /// and empty routes are never recorded; the newest sits first; the list is de-duplicated and capped.
    public static func recordVisit(
        _ paths: [String],
        visiting to: String,
        pinned: [String],
        max: Int = LayoutNavLimits.maxRecent
    ) -> [String] {
        if to.isEmpty || to == "/" || pinned.contains(to) { return paths }
        return Array(([to] + paths.filter { $0 != to }).prefix(max))
    }

    // MARK: Section expansion (web `toggleSection`)

    /// Toggle a section's expansion — the verbatim port of `toggleSection`: the active section can be opened
    /// but never collapsed (the web keeps the current page's section visible).
    public static func toggledExpansion(
        _ expanded: Set<String>,
        _ title: String,
        activeTitle: String?
    ) -> Set<String> {
        var next = expanded
        if next.contains(title), title != activeTitle {
            next.remove(title)
        } else {
            next.insert(title)
        }
        return next
    }

    /// How many of the visible sections are expanded (web `expandedSectionCount`).
    public static func expandedSectionCount(_ sections: [LayoutNavSection], expanded: Set<String>) -> Int {
        sections.count(where: { expanded.contains($0.title) })
    }

    // MARK: Badge (web per-item count chips)

    /// The count chip for a route, if any — the verbatim port of the web per-item badges: unread alerts on
    /// `/notifications/alerts` (capped `9+`, danger), the uncapped fleet size on `/vehicles` (info), and the
    /// stale-session count on `/data-repair` (capped `9+`, warning). A zero count shows no chip.
    public static func badge(
        for to: String,
        unreadAlerts: Int,
        vehicleCount: Int,
        staleCount: Int
    ) -> LayoutNavBadge? {
        switch to {
        case "/notifications/alerts":
            guard unreadAlerts > 0 else { return nil }
            return LayoutNavBadge(text: capped(unreadAlerts), tone: .danger)
        case "/vehicles":
            guard vehicleCount > 0 else { return nil }
            return LayoutNavBadge(text: String(vehicleCount), tone: .info)
        case "/data-repair":
            guard staleCount > 0 else { return nil }
            return LayoutNavBadge(text: capped(staleCount), tone: .warning)
        default:
            return nil
        }
    }

    /// The web `count > 9 ? '9+' : count` cap.
    private static func capped(_ count: Int) -> String {
        count > 9 ? "9+" : String(count)
    }

    // MARK: Full projection

    /// The full render-ready projection from the catalog + the dynamic state — the bundled output of the web
    /// shell's nav derivation.
    public static func projection(catalog: [LayoutNavSection], state: LayoutNavState) -> LayoutProjection {
        let visible = visibleSections(catalog, vehicleCount: state.vehicleCount, isForwardAuth: state.isForwardAuth)
        let active = findByPath(state.pathname, in: catalog)
        let activePath = active?.item.to
        return LayoutProjection(
            sections: visible,
            pinnedItems: pinnedItems(
                paths: state.pinnedPaths,
                sections: catalog,
                vehicleCount: state.vehicleCount,
                isForwardAuth: state.isForwardAuth
            ),
            recentItems: recentItems(
                paths: state.recentPaths,
                sections: catalog,
                vehicleCount: state.vehicleCount,
                isForwardAuth: state.isForwardAuth,
                activePathname: state.pathname
            ),
            activeEntry: active,
            activeIsPinned: activePath.map { state.pinnedPaths.contains($0) } ?? false,
            expandedSectionCount: expandedSectionCount(visible, expanded: state.expanded)
        )
    }
}
