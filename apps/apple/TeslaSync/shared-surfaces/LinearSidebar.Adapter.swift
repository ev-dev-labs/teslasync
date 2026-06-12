//
//  LinearSidebar.Adapter.swift
//  TeslaSync — P4 shared surface · 0174 · LinearSidebar (Apple)
//
//  The testable, dependency-light core for the Linear / Notion-style sidebar — the SwiftUI parity of
//  components/layout/sidebar/LinearSidebar.tsx. The web source is a presentational component: it fetches
//  NOTHING. It renders the canonical nav tree (sections + a pinned "Favorites" group) as a single quiet
//  column, tracks which sections are collapsed, applies an inline tree-filter, marks the active page with a
//  2px left accent bar, and exposes per-row pin / unpin affordances + a few quiet trailing badges (a
//  notification dot, monochrome count chips).
//
//  This file is the Foundation-only heart of the native peer:
//    • the surface slug (P1/S11 diagnostics),
//    • the i18n facade typealias (P1/S10) — `(key, fallback) -> String`, the native peer of the web
//      `t(key, default)` + the `navLabel(label)` prop folded into one closure,
//    • `LinearSidebarItem` / `LinearSidebarSection` — the value-type peers of the web nav item + section
//      (the structural props Layout hands down, already visibility-filtered),
//    • `LinearSidebarBadges` — the alert / vehicle / stale counts (web `alertCount` / `vehicleCount` /
//      `staleCount`), and the trigger paths + 99+ cap that drive the trailing badges,
//    • `LinearSidebarInput` — the bound props for one render (sections, pinned, badges, active path),
//      plus the derived active-section id (web `activeSectionTitle`),
//    • `LinearSidebarActivePath` — the VERBATIM port of `isActiveLinearPath`,
//    • `LinearSidebarFilter` — the VERBATIM port of the tokenized tree-filter (`matchesFilter`).
//
//  No SwiftUI, no @Observable model, no networking — every branch is unit testable in isolation. The
//  i18n lookup is injected as a closure so the core stays Foundation-only and the tests stay
//  deterministic; the live `@Observable` model + the SwiftUI tree live in the Model / view files.
//
//  Faithful-parity note: the web source performs NO fetch and reads NO remote data — it only consumes the
//  nav tree Layout passes as props plus the router location — so it has NO loading / error / stale /
//  offline branches. Its REAL branches are: the Favorites group present vs. absent (≥ 1 pinned item), a
//  section collapsed vs. expanded, the active row (accent bar) vs. inactive, the trailing badge variants
//  (notification dot / vehicle chip / stale chip / none), the per-row pin action present vs. absent
//  (already pinned), the inline filter active vs. inactive, and the empty-filter branch ("No matches." +
//  "Clear filter"). This surface reproduces exactly those; inventing data-state chrome would contradict
//  the source (Honesty Covenant 5).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). The
/// prompt assigns this surface the canonical slug `LinearSidebar`, kept here (SwiftUI-free) so the
/// state-holder can emit telemetry without depending on the view layer.
public enum LinearSidebarSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "LinearSidebar"
}

// MARK: - Localization facade typealias (P1/S10)

/// The i18n lookup the surface uses to resolve its copy + nav labels — `(key, fallback) -> String`, the
/// native peer of the web `t(key, default)` AND the `navLabel(label)` prop folded into one closure.
/// Injected so the pure core stays Foundation-only and deterministic in tests (pass
/// `{ _, fallback in fallback }`). `@Sendable` so it crosses isolation boundaries cleanly under Swift 6
/// strict concurrency.
public typealias LinearSidebarLocalize = @Sendable (String, String) -> String

// MARK: - LinearSidebarInterpolation (web i18next `t(key, { page, count })`)

/// Substitutes `{{name}}` slots in a localized template — the native peer of i18next's
/// interpolation. The web composes labels like `t('nav.pinPage', { page, defaultValue: 'Pin {{page}} to
/// favorites' })`; here the localizer returns the template (localized or the fallback) and this fills the
/// slots, so the whole label stays translatable with no hardcoded English in the view.
public enum LinearSidebarInterpolation {
    /// Replaces each `{{key}}` in `template` with its value. Distinct slot keys make the order
    /// irrelevant; an unreferenced slot is left untouched (i18next behaviour).
    public static func format(_ template: String, _ values: [String: String]) -> String {
        values.reduce(template) { partial, pair in
            partial.replacingOccurrences(of: "{{\(pair.key)}}", with: pair.value)
        }
    }
}

// MARK: - LinearSidebarItem (web nav item)

/// One nav row — the value-type peer of the web `{ to, icon, label, dataTour, minVehicles }`. The web
/// resolves the visible text with `navLabel(item.label)`; here the label is carried as a catalog key + an
/// English fallback and resolved through the injected localizer, so the sources hold no hardcoded prose.
public struct LinearSidebarItem: Sendable, Equatable, Identifiable {
    /// The canonical route path — web `to` (also the row identity + the active-path / badge key).
    public let path: String
    /// The label catalog key — web `label`, resolved by `navLabel` / the localizer.
    public let titleKey: String
    /// The English fallback for `titleKey` when the catalog has no entry (test / preview bundles).
    public let titleFallback: String
    /// The SF Symbol name for the page-marker glyph — the native peer of the web `icon`.
    public let systemImage: String
    /// An optional product-tour anchor — web `dataTour` (kept as an accessibility identifier).
    public let dataTour: String?

    public init(
        path: String,
        titleKey: String,
        titleFallback: String,
        systemImage: String,
        dataTour: String? = nil
    ) {
        self.path = path
        self.titleKey = titleKey
        self.titleFallback = titleFallback
        self.systemImage = systemImage
        self.dataTour = dataTour
    }

    /// The row identity — web rows key on `to`.
    public var id: String {
        path
    }

    /// The resolved, localized label — the native peer of `navLabel(item.label)`.
    public func title(localize: LinearSidebarLocalize) -> String {
        localize(titleKey, titleFallback)
    }
}

// MARK: - LinearSidebarSection (web nav section)

/// One collapsible section — the value-type peer of the web `{ title, items }`. The web uses the literal
/// `title` as both the display string and the collapse identity; here `id` is the stable collapse key and
/// the display title resolves through the localizer (web `title` was already localized upstream).
public struct LinearSidebarSection: Sendable, Equatable, Identifiable {
    /// The stable collapse identity — the native peer of the web `section.title` used as a key.
    public let id: String
    /// The header label catalog key.
    public let titleKey: String
    /// The English fallback for `titleKey`.
    public let titleFallback: String
    /// The section's rows, already visibility-filtered upstream (web `section.items`).
    public let items: [LinearSidebarItem]

    public init(id: String, titleKey: String, titleFallback: String, items: [LinearSidebarItem]) {
        self.id = id
        self.titleKey = titleKey
        self.titleFallback = titleFallback
        self.items = items
    }

    /// The resolved, localized header title.
    public func title(localize: LinearSidebarLocalize) -> String {
        localize(titleKey, titleFallback)
    }
}

// MARK: - LinearSidebarBadges (web alert / vehicle / stale counts)

/// The canonical paths whose rows carry a quiet trailing badge — the verbatim web trigger routes. Kept as
/// constants so the badge rule is parity-faithful and testable without hardcoding strings at the call site.
public enum LinearSidebarBadgePath {
    /// Web `/notifications/alerts` → a single notification dot when `alertCount > 0`.
    public static let alerts = "/notifications/alerts"
    /// Web `/vehicles` → a monochrome count chip when `vehicleCount > 0`.
    public static let vehicles = "/vehicles"
    /// Web `/data-repair` → a monochrome count chip when `staleCount > 0`.
    public static let dataRepair = "/data-repair"
}

/// The per-page badge counts — the value-type peer of the web `alertCount` / `vehicleCount` / `staleCount`
/// props. Negative inputs clamp to 0 (a count is never negative), matching the web defaults of 0.
public struct LinearSidebarBadges: Sendable, Equatable {
    /// Unread alerts — drives the notification dot on the alerts row (web `alertCount`).
    public let alertCount: Int
    /// Vehicle count — drives the chip on the vehicles row (web `vehicleCount`).
    public let vehicleCount: Int
    /// Stale-data rows — drives the chip on the data-repair row (web `staleCount`).
    public let staleCount: Int

    public init(alertCount: Int = 0, vehicleCount: Int = 0, staleCount: Int = 0) {
        self.alertCount = max(0, alertCount)
        self.vehicleCount = max(0, vehicleCount)
        self.staleCount = max(0, staleCount)
    }

    /// The empty badge set — every count 0 (web defaults).
    public static let none = LinearSidebarBadges()

    /// The chip's display text — web `value > 99 ? '99+' : value`.
    public static func chipText(_ value: Int) -> String {
        value > 99 ? "99+" : String(value)
    }
}

// MARK: - LinearSidebarTrailing (web `trailingFor`)

/// The resolved trailing badge for a row — the native peer of the web `trailingFor(to)` return. `.none`
/// renders nothing; `.notificationDot` is the 6px unread dot; `.count` is the monochrome chip carrying its
/// already-capped display text and its localized accessibility label.
public enum LinearSidebarTrailing: Sendable, Equatable {
    /// No trailing badge — web `return null`.
    case none
    /// A single unread dot — web `<NotificationDot />` on the alerts row.
    case notificationDot
    /// A monochrome count chip — web `<CountChip value label />` on the vehicles / data-repair rows.
    case count(text: String, accessibilityLabel: String)
}

// MARK: - LinearSidebarInput (the bound props for one render)

/// The bound props for one render — the value-type peer of the structural web props Layout hands down
/// (`sections`, `pinnedItems`, the badge counts) plus the router `pathname`. The tree state (which
/// sections are collapsed, the filter text) is owned by the model, not here.
public struct LinearSidebarInput: Sendable, Equatable {
    /// The canonical sections, already visibility-filtered upstream — web `sections`.
    public let sections: [LinearSidebarSection]
    /// The pinned rows, in pin order, already visibility-filtered — web `pinnedItems`.
    public let pinnedItems: [LinearSidebarItem]
    /// The per-page badge counts — web `alertCount` / `vehicleCount` / `staleCount`.
    public let badges: LinearSidebarBadges
    /// The active route path — web `pathname` (the controlled value, falling back to the live location).
    public let activePath: String

    public init(
        sections: [LinearSidebarSection],
        pinnedItems: [LinearSidebarItem] = [],
        badges: LinearSidebarBadges = .none,
        activePath: String
    ) {
        self.sections = sections
        self.pinnedItems = pinnedItems
        self.badges = badges
        self.activePath = activePath
    }

    /// The set of pinned paths — web `pinnedSet` (hides the pin action for already-pinned rows).
    public var pinnedPaths: Set<String> {
        Set(pinnedItems.map(\.path))
    }

    /// The id of the section containing the active page — the native peer of the web `activeSectionTitle`
    /// prop, derived here from `sections` + `activePath` so it never drifts. `nil` when no section owns
    /// the active path.
    public var activeSectionID: String? {
        sections.first { section in
            section.items.contains { LinearSidebarActivePath.isActive(pathname: activePath, path: $0.path) }
        }?.id
    }

    /// The resolved trailing badge for a row — the verbatim port of the web `trailingFor(to)`. `localize`
    /// composes the chips' accessibility labels (web `nav.vehicleCount` / `nav.staleCount`).
    public func trailing(for path: String, localize: LinearSidebarLocalize) -> LinearSidebarTrailing {
        if path == LinearSidebarBadgePath.alerts, badges.alertCount > 0 {
            return .notificationDot
        }
        if path == LinearSidebarBadgePath.vehicles, badges.vehicleCount > 0 {
            return .count(
                text: LinearSidebarBadges.chipText(badges.vehicleCount),
                accessibilityLabel: LinearSidebarInterpolation.format(
                    localize("nav.vehicleCount", "{{count}} vehicles"),
                    ["count": String(badges.vehicleCount)]
                )
            )
        }
        if path == LinearSidebarBadgePath.dataRepair, badges.staleCount > 0 {
            return .count(
                text: LinearSidebarBadges.chipText(badges.staleCount),
                accessibilityLabel: LinearSidebarInterpolation.format(
                    localize("nav.staleCount", "{{count}} stale rows"),
                    ["count": String(badges.staleCount)]
                )
            )
        }
        return .none
    }
}

// MARK: - LinearSidebarActivePath (web `isActiveLinearPath`)

/// The active-path decision — the VERBATIM port of the web `isActiveLinearPath`. The root `/` matches only
/// itself; any other path matches an exact hit OR a descendant (`pathname` starts with `path + "/"`), so a
/// detail route keeps its parent nav row active.
public enum LinearSidebarActivePath {
    /// `true` when `pathname` is `path` or a descendant of it — web
    /// `to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/')`.
    public static func isActive(pathname: String, path: String) -> Bool {
        if path == "/" {
            return pathname == "/"
        }
        return pathname == path || pathname.hasPrefix(path + "/")
    }
}

// MARK: - LinearSidebarFilter (web `matchesFilter`)

/// The inline tree-filter — the VERBATIM port of the web tokenizer + matcher. The filter text is trimmed,
/// lowercased, split on whitespace into tokens; a label matches iff it contains EVERY token (web
/// `filterTokens.every(token => haystack.includes(token))`); an empty filter matches everything.
public enum LinearSidebarFilter {
    /// Tokenizes the raw filter text — web `filter.trim().toLowerCase().split(/\s+/).filter(Boolean)`.
    public static func tokens(_ filter: String) -> [String] {
        filter
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .split(whereSeparator: { $0.isWhitespace })
            .map(String.init)
    }

    /// `true` when `label` contains every token — web `matchesFilter`. An empty token list matches all.
    public static func matches(_ label: String, tokens: [String]) -> Bool {
        guard !tokens.isEmpty else { return true }
        let haystack = label.lowercased()
        return tokens.allSatisfy { haystack.contains($0) }
    }
}
