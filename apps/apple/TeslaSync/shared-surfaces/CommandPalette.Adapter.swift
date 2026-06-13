//
//  CommandPalette.Adapter.swift
//  TeslaSync — P4 shared surface · 0205 · CommandPalette (Apple)
//
//  The Foundation-only core for the command palette — the SwiftUI parity of `components/ui/CommandPalette.tsx`.
//  This file owns the surface identity (the diagnostics slug), the i18n facade seam (the native shape of the
//  web `t(key, default)`), and the closure-free value types the rest of the surface agrees on: the fleet row
//  the labels read (``PaletteVehicle``), the nav / registry / recent-page / search-hit feeds the host pushes,
//  the resolved palette row (``PaletteItem`` + its kind + the ``PaletteAction`` it performs), the grouped
//  render shape (``PaletteGroup``), and the static vehicle-command catalog (``PaletteCommandConfig`` — the
//  verbatim port of the web `PALETTE_COMMAND_CONFIGS`). No SwiftUI and no `@Observable`, so every value here
//  is unit-testable in isolation. The pure scoring / scope / item-building lives in the sibling
//  `CommandPalette.Scope.swift`, `CommandPalette.Items.swift`, and `CommandPalette.Projector.swift`.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum CommandPaletteSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "CommandPalette"

    /// The frecency cap mirrored from the web `MOST_USED_MAX_DISPLAY`.
    public static let mostUsedMaxDisplay = 5
    /// The recent-pages cap mirrored from the web `RECENT_PAGES_DISPLAY_LIMIT`.
    public static let recentPagesDisplayLimit = 5
    /// The server-search result cap mirrored from the web `useGlobalSearch({ limit: 5 })`.
    public static let searchResultLimit = 5
    /// The minimum query length the server search enforces (web `>= 2`).
    public static let searchMinLength = 2
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a plain
/// `@Sendable` closure so the pure core has no dependency on a bundle: the production app passes the P1/S10
/// facade, while tests pass an identity-fallback resolver.
public typealias CommandPaletteResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - PaletteItemKind (web item `type`)

/// The kind discriminator for a palette row — the native peer of the web `PaletteItem.type`. The raw values
/// match the web strings verbatim so the scope filter (`itemMatchesScope`) keeps parity.
public enum PaletteItemKind: String, Sendable, Equatable, CaseIterable {
    case navigate
    case command
    case registry
    case vehicleSwitch = "vehicle-switch"
    case searchHit = "search-hit"
}

// MARK: - PaletteAction (web item `action` closure, made data)

/// What a row does when activated — the data-form of the web `action: () => void` closure, so the pure
/// projector stays closure-free and the model executes through the runner seam. Each case carries exactly the
/// payload the runner needs.
public enum PaletteAction: Sendable, Equatable {
    /// Navigate to a route (web `go(path)`).
    case navigate(path: String)
    /// Pick a vehicle command — runs it for a 1-vehicle fleet, else opens vehicle-select (web `selectCommand`).
    case selectCommand(command: String)
    /// Run a vehicle command against a chosen vehicle (web `executeCommand`), used by the vehicle-select rows.
    case executeCommand(command: String, vehicleID: Int)
    /// Switch the active vehicle (web `switchActiveVehicle`).
    case switchVehicle(id: Int)
    /// Invoke a static registry command by id (web `runRegistryCommand`).
    case runRegistry(id: String)
    /// Open a server search result by url (web search-hit `go(hit.url)`).
    case openSearchResult(url: String)
    /// An inert row that performs nothing (web vehicle-select row with no pending command).
    case noop
}

// MARK: - PaletteItem (web resolved row)

/// One resolved palette row — the native peer of the web `PaletteItem`. A value type so the projector, the
/// view, and the tests agree on one shape; the `action` is data (``PaletteAction``) rather than a closure.
public struct PaletteItem: Sendable, Equatable, Identifiable {
    /// The stable row id (web `item.id`); also the frecency lookup key (less any `most-used-` prefix).
    public let id: String
    /// The primary row label (web `item.label`).
    public let label: String
    /// The section heading the row groups under (web `item.section`).
    public let section: String
    /// The SF Symbol glyph name (the native peer of the web lucide icon).
    public let iconName: String
    /// The row kind (web `item.type`); drives the command accent + scope filter.
    public let kind: PaletteItemKind
    /// The optional secondary line (web `item.sublabel`).
    public let sublabel: String?
    /// The optional shortcut hint shown trailing (web `item.shortcut`).
    public let shortcut: String?
    /// The fuzzy-match keywords (web `item.keywords`).
    public let keywords: [String]
    /// What the row does when activated.
    public let action: PaletteAction

    public init(
        id: String,
        label: String,
        section: String,
        iconName: String,
        kind: PaletteItemKind,
        sublabel: String? = nil,
        shortcut: String? = nil,
        keywords: [String] = [],
        action: PaletteAction
    ) {
        self.id = id
        self.label = label
        self.section = section
        self.iconName = iconName
        self.kind = kind
        self.sublabel = sublabel
        self.shortcut = shortcut
        self.keywords = keywords
        self.action = action
    }
}

// MARK: - PaletteGroup (web `groupedItems`)

/// A row carrying its position in the flat visible list — the native peer of the web `{ item, globalIndex }`,
/// so the keyboard cursor (a single index over the flattened list) maps onto the section-grouped layout.
public struct PaletteIndexedItem: Sendable, Equatable, Identifiable {
    public let item: PaletteItem
    public let globalIndex: Int

    public var id: String {
        item.id
    }

    public init(item: PaletteItem, globalIndex: Int) {
        self.item = item
        self.globalIndex = globalIndex
    }
}

/// A section group of rows — the native peer of the web `groupedItems` entry. Carries the group index in the
/// `id` so the same section heading can appear more than once without a duplicate-key collision (web key
/// `${section}-${groupIndex}`).
public struct PaletteGroup: Sendable, Equatable, Identifiable {
    public let id: String
    public let section: String
    public let items: [PaletteIndexedItem]

    public init(id: String, section: String, items: [PaletteIndexedItem]) {
        self.id = id
        self.section = section
        self.items = items
    }
}

// MARK: - Host feeds (the composed web hook values)

/// A fleet vehicle row — the minimal projection the palette needs, the native peer of the web `Vehicle` the
/// `vehicles.map(...)` reads. Carries the five fields the label / sublabel chains consult.
public struct PaletteVehicle: Sendable, Equatable, Identifiable {
    public let id: Int
    public let displayName: String?
    public let vin: String?
    public let model: String?
    public let state: String?

    public init(id: Int, displayName: String? = nil, vin: String? = nil, model: String? = nil, state: String? = nil) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
        self.model = model
        self.state = state
    }
}

/// A navigable page entry — the native peer of one web `navSections` item (plus its `navSearchKeywords`). The
/// host pushes these (the production app maps the real sidebar nav); `requiresAuth` reproduces the web
/// auth-gated filter.
public struct PaletteNavEntry: Sendable, Equatable {
    public let path: String
    public let label: String
    public let sectionTitle: String
    public let keywords: [String]
    public let iconName: String
    public let requiresAuth: Bool

    public init(
        path: String,
        label: String,
        sectionTitle: String,
        keywords: [String] = [],
        iconName: String = "circle",
        requiresAuth: Bool = false
    ) {
        self.path = path
        self.label = label
        self.sectionTitle = sectionTitle
        self.keywords = keywords
        self.iconName = iconName
        self.requiresAuth = requiresAuth
    }
}

/// The static-registry section a registry command groups under — the native peer of the web `c.section`
/// (`preferences` / `actions` / `pages` / `vehicles`).
public enum PaletteRegistrySection: String, Sendable, Equatable {
    case preferences
    case actions
    case pages
    case vehicles
}

/// A static registry command — theme toggles, refresh, navigate-to-feature, etc. (web `ResolvedCommand`).
public struct PaletteRegistryEntry: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let section: PaletteRegistrySection
    public let keywords: [String]
    public let shortcut: String?
    public let iconName: String

    public init(
        id: String,
        label: String,
        section: PaletteRegistrySection,
        keywords: [String] = [],
        shortcut: String? = nil,
        iconName: String = "command"
    ) {
        self.id = id
        self.label = label
        self.section = section
        self.keywords = keywords
        self.shortcut = shortcut
        self.iconName = iconName
    }
}

/// The kind of a recently-visited page — the native peer of the web `RecentPageKind`, driving the row glyph.
public enum PaletteRecentKind: String, Sendable, Equatable {
    case vehicle
    case drive
    case charging
    case trip
    case geofence
    case yearReview = "year-review"
    case page
}

/// A recently-visited route — the native peer of the web `RecentEntry` from `lib/recentPages`.
public struct PaletteRecentPage: Sendable, Equatable {
    public let path: String
    public let title: String
    public let kind: PaletteRecentKind
    public let visitedAt: Date

    public init(path: String, title: String, kind: PaletteRecentKind, visitedAt: Date) {
        self.path = path
        self.title = title
        self.kind = kind
        self.visitedAt = visitedAt
    }
}

/// The entity kind of a server search hit — the native peer of the web `SearchHitType`.
public enum PaletteSearchHitType: String, Sendable, Equatable, CaseIterable {
    case vehicle
    case drive
    case charging
    case alert
    case notification
    case geofence
    case automation
    case location
    case trip
}

/// A server search hit — the native peer of the web `SearchHit` from `useGlobalSearch`.
public struct PaletteSearchHit: Sendable, Equatable, Identifiable {
    public let type: PaletteSearchHitType
    public let id: Int
    public let title: String
    public let subtitle: String?
    public let url: String

    public init(type: PaletteSearchHitType, id: Int, title: String, subtitle: String? = nil, url: String) {
        self.type = type
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.url = url
    }
}
