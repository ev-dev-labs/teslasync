//
//  Layout.Adapter.swift
//  TeslaSync — P4 shared surface · 0169 · Layout (Apple)
//
//  The Foundation-only core for the app shell — the SwiftUI parity of `components/layout/Layout.tsx`. This
//  file owns the surface identity (the diagnostics slug), the i18n facade seam (the native shape of the web
//  `t(key, default)`), the navigation value types (``LayoutNavItem`` / ``LayoutNavSection`` — the web
//  `navSections` rows), the item badge (``LayoutNavBadge`` — the web sidebar count chips), the sidebar-style
//  + connectivity axes, and the pure ``LayoutProjector`` the rest of the surface derives from: verbatim ports
//  of the web visibility filter (`isVisibleNavItem`), the active-path match (`isActiveNavPath`), the
//  pinned/recent resolution (`pinnedNavItems` / `recentNavItems`), the pin/unpin mutators (`pinNavPath` /
//  `unpinNavPath`, capped at `MAX_PINNED_NAV_ITEMS`), the section-toggle rule (`toggleSection` — the active
//  section can never collapse), and the badge math (`unreadAlerts` / `vehicles.length` / `staleCount`). No
//  SwiftUI and no `@Observable`, so every rule is unit-testable in isolation.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum LayoutSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "Layout"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a plain
/// `@Sendable` closure so the pure core has no dependency on a bundle: the production app passes the P1/S10
/// facade, while tests pass an identity-fallback resolver.
public typealias LayoutResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Navigation limits (web module constants)

/// The navigation tuning constants — the verbatim ports of the web module constants. The pinned/recent caps
/// and the default-pinned seed are reproduced exactly so the projector behaves identically.
public enum LayoutNavLimits {
    /// Web `MAX_PINNED_NAV_ITEMS` — the most pins kept at once.
    public static let maxPinned = 8
    /// Web `MAX_RECENT_NAV_ITEMS` — the most recently-used rows tracked.
    public static let maxRecent = 3
    /// Web `DEFAULT_PINNED_NAV_PATHS` — the seed pin set for a fresh install.
    public static let defaultPinnedPaths = ["/", "/digital-twin", "/vehicles", "/charging", "/live"]
    /// Web `SHOW_RECENTLY_USED_NAV` — the sidebar "Recently Used" feature switch (off per the web UX review;
    /// recent-path tracking still runs, only the sidebar render is muted).
    public static let showRecentlyUsed = false
}

// MARK: - Axes (sidebar style + connectivity)

/// The sidebar layout the user has chosen (web `useSidebarStyle()` → `'linear' | 'notion' | 'legacy'`). The
/// three web styles render the SAME sections/pinned data behind different chrome; the native peer renders one
/// cohesive sidebar and keeps the style bound for parity + future per-style affordances.
public enum LayoutSidebarStyle: String, Sendable, Equatable, CaseIterable {
    case linear
    case notion
    case legacy
}

/// The orthogonal freshness axis used by the P4 leaf-state contract: `live` (fresh), `stale` (older than the
/// freshness window — auto-refreshes once), `offline` (no connectivity — keeps the cached chrome). The web
/// shell has no such axis; it is the native surface's always-render connectivity chip.
public enum LayoutConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Navigation value types (web `navSections` rows)

/// One navigation destination — the native peer of a web `navSections[].items[]` row. Carries the fields the
/// shell reads: the route (`to`, the selection key + `Identifiable` id), the verbatim label (web `label`,
/// rendered as authored because `navI18nKeys` is empty), the SF Symbol (the native peer of the web `Icons.*`
/// glyph), and the two visibility predicates (`minVehicles` / `requiresAuth`).
public struct LayoutNavItem: Sendable, Equatable, Identifiable {
    /// The route path (web `to`) — the stable id and the value pins/recents persist.
    public let to: String
    /// The verbatim display label (web `label`).
    public let label: String
    /// The SF Symbol name (the native peer of the web `Icons.*` glyph).
    public let symbol: String
    /// The minimum fleet size for the item to show (web `minVehicles`); `0` = always.
    public let minVehicles: Int
    /// Whether the item needs a ForwardAuth identity (web `requiresAuth`); hidden in open mode.
    public let requiresAuth: Bool

    public var id: String {
        to
    }

    public init(to: String, label: String, symbol: String, minVehicles: Int = 0, requiresAuth: Bool = false) {
        self.to = to
        self.label = label
        self.symbol = symbol
        self.minVehicles = minVehicles
        self.requiresAuth = requiresAuth
    }
}

/// One navigation section — the native peer of a web `navSections[]` row: a verbatim title and its items.
public struct LayoutNavSection: Sendable, Equatable, Identifiable {
    /// The verbatim section title (web `title`) — the id, the expansion key, and the heading.
    public let title: String
    /// The section's destinations, in authored order.
    public let items: [LayoutNavItem]

    public var id: String {
        title
    }

    public init(title: String, items: [LayoutNavItem]) {
        self.title = title
        self.items = items
    }
}

// MARK: - Item badge (web sidebar count chips)

/// The semantic tone of a sidebar count chip — the native peer of the web neon chip colours.
public enum LayoutBadgeTone: String, Sendable, Equatable {
    case danger
    case info
    case warning
}

/// A resolved sidebar count chip — the native peer of the web per-item count badges
/// (`/notifications/alerts` → unread alerts, `/vehicles` → fleet size, `/data-repair` → stale sessions).
public struct LayoutNavBadge: Sendable, Equatable {
    /// The chip text — already capped to `"9+"` where the web caps it.
    public let text: String
    /// The chip tone (danger / info / warning).
    public let tone: LayoutBadgeTone

    public init(text: String, tone: LayoutBadgeTone) {
        self.text = text
        self.tone = tone
    }
}

// MARK: - Active entry + projection (render-ready)

/// The resolved active navigation entry — the web `findNavItemByPath(location.pathname)` result: the owning
/// section title and the matched item.
public struct LayoutActiveEntry: Sendable, Equatable {
    public let sectionTitle: String
    public let item: LayoutNavItem

    public init(sectionTitle: String, item: LayoutNavItem) {
        self.sectionTitle = sectionTitle
        self.item = item
    }
}

/// The dynamic inputs the projection reads — the live shell state bundled into one value so the pure
/// projector stays within the parameter budget: the current route, fleet size, auth mode, the pinned + recent
/// paths, and the expanded-section set.
public struct LayoutNavState: Sendable, Equatable {
    public let pathname: String
    public let vehicleCount: Int
    public let isForwardAuth: Bool
    public let pinnedPaths: [String]
    public let recentPaths: [String]
    public let expanded: Set<String>

    public init(
        pathname: String,
        vehicleCount: Int,
        isForwardAuth: Bool,
        pinnedPaths: [String],
        recentPaths: [String],
        expanded: Set<String>
    ) {
        self.pathname = pathname
        self.vehicleCount = vehicleCount
        self.isForwardAuth = isForwardAuth
        self.pinnedPaths = pinnedPaths
        self.recentPaths = recentPaths
        self.expanded = expanded
    }
}

/// The render-ready projection the surface's content state switches over — the resolved, view-ready output of
/// the web shell's nav derivation: the visible sections, the resolved pinned + recent items, the active entry
/// + whether it is pinned, and the expanded-section count (for the expand/collapse-all disabled state).
public struct LayoutProjection: Sendable, Equatable {
    /// Visible sections (web `visibleNavSections`) — filtered items, empty sections dropped.
    public let sections: [LayoutNavSection]
    /// Resolved pinned items (web `pinnedNavItems`), in pin order.
    public let pinnedItems: [LayoutNavItem]
    /// Resolved recent items (web `recentNavItems`), active page excluded.
    public let recentItems: [LayoutNavItem]
    /// The active entry (web `activeNavEntry`), `nil` when the route matches no item.
    public let activeEntry: LayoutActiveEntry?
    /// Whether the active route is pinned (web `activeIsPinned`).
    public let activeIsPinned: Bool
    /// How many visible sections are expanded (web `expandedSectionCount`).
    public let expandedSectionCount: Int

    public init(
        sections: [LayoutNavSection],
        pinnedItems: [LayoutNavItem],
        recentItems: [LayoutNavItem],
        activeEntry: LayoutActiveEntry?,
        activeIsPinned: Bool,
        expandedSectionCount: Int
    ) {
        self.sections = sections
        self.pinnedItems = pinnedItems
        self.recentItems = recentItems
        self.activeEntry = activeEntry
        self.activeIsPinned = activeIsPinned
        self.expandedSectionCount = expandedSectionCount
    }

    /// Whether there is no navigation to show at all (web returns the populated nav unconditionally; the P4
    /// always-render contract turns a fully-filtered nav into a friendly empty state instead of a blank box).
    public var isEmpty: Bool {
        sections.isEmpty
    }
}
