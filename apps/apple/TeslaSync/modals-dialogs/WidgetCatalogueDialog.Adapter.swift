//
//  WidgetCatalogueDialog.Adapter.swift
//  TeslaSync — P4 modal / dialog · 0026 · WidgetCatalogueDialog (Apple)
//
//  The dependency-free domain layer for the widget-catalogue dialog — the faithful port of
//  features/dashboard/components/WidgetCatalogueDialog.tsx. The web source is a full-screen modal that
//  lists every widget in `WIDGET_REGISTRY`, grouped by category, badges the ones already on the active
//  dashboard ("Added"), filters by a name / description / category search, and on pick calls
//  `onAdd(widgetId)` then `onClose`. Everything here is pure Foundation so the value model, the 16
//  categories (order + emoji + label key), the load / freshness / phase enums, and the catalogue entry
//  are all unit-testable without a bundle or a rendered view. The 118-entry registry itself lives in
//  WidgetCatalogueDialog.Catalog.swift; the pure filter / group / counts projection lives in
//  WidgetCatalogueDialog.Projection.swift.
//
//  Web parity notes:
//    • `WidgetDef { id, name, description, icon, category }` (the catalogue subset) → `WidgetCatalogueEntry`.
//    • `WidgetCategory` (16 union members) → `WidgetCatalogueCategory`; `CATEGORY_ORDER` →
//      `WidgetCatalogueCategory.order`; `CATEGORY_EMOJI` → `.emoji`; `CATEGORY_FALLBACK_LABELS` →
//      `.fallbackLabel`; the web `t('dashboard.catalogue.category.<cat>')` key → `.labelKey`.
//    • the `activeWidgetIds` prop → the source snapshot's `activeWidgetIDs`.
//    • lucide glyphs → SF Symbols (resolved per entry in the catalog).
//    • the presentational dialog is widened with loading / empty / error / freshness envelopes so no
//      state is ever a blank box (engineering guideline #6), matching the modals-dialogs tier.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core so
/// the projection's unit tests can reach it.
public enum WidgetCatalogueSurface {
    public static let slug = "WidgetCatalogueDialog"
}

// MARK: - Widget category (web `WidgetCategory` + the three category maps)

/// One widget category — the native parity of the web `WidgetCategory` union. Carries the catalogue's
/// display order (web `CATEGORY_ORDER`), the section emoji (web `CATEGORY_EMOJI`), the English fallback
/// label (web `CATEGORY_FALLBACK_LABELS`), and the i18n key (web
/// `t('dashboard.catalogue.category.<raw>')`).
public enum WidgetCatalogueCategory: String, Sendable, Equatable, CaseIterable, Identifiable {
    case vehicle
    case battery
    case energy
    case driving
    case charging
    case climate
    case tires
    case security
    case commands
    case media
    case telemetry
    case analytics
    case alerts
    case automations
    case system
    case maps

    public var id: String {
        rawValue
    }

    /// The catalogue's category order (web `CATEGORY_ORDER`). `allCases` already follows this
    /// declaration order, so it is the single source of truth for both.
    public static let order: [WidgetCatalogueCategory] = allCases

    /// The section emoji rendered before the category name (web `CATEGORY_EMOJI`). A glyph, rendered
    /// verbatim — never translated.
    public var emoji: String {
        switch self {
        case .vehicle: "🚗"
        case .battery: "🔋"
        case .energy: "⚡"
        case .driving: "🛣"
        case .charging: "🔌"
        case .climate: "🌡"
        case .tires: "🛞"
        case .security: "🛡"
        case .commands: "🎛"
        case .media: "🎵"
        case .telemetry: "📡"
        case .analytics: "📊"
        case .alerts: "🔔"
        case .automations: "🤖"
        case .system: "⚙"
        case .maps: "🗺"
        }
    }

    /// The English fallback label (web `CATEGORY_FALLBACK_LABELS`).
    public var fallbackLabel: String {
        switch self {
        case .vehicle: "Vehicle"
        case .battery: "Battery & Range"
        case .energy: "Energy"
        case .driving: "Driving"
        case .charging: "Charging"
        case .climate: "Climate"
        case .tires: "Tires"
        case .security: "Security"
        case .commands: "Commands"
        case .media: "Media"
        case .telemetry: "Telemetry"
        case .analytics: "Analytics"
        case .alerts: "Alerts"
        case .automations: "Automations"
        case .system: "System"
        case .maps: "Maps"
        }
    }

    /// The i18n key for the category label (web `dashboard.catalogue.category.<raw>`).
    public var labelKey: String {
        "dashboard.catalogue.category.\(rawValue)"
    }
}

// MARK: - Catalogue entry (web `WidgetDef` subset)

/// One catalogue row — the native parity of the web `WidgetDef` fields this dialog renders: the stable
/// widget id, the display name, the category, the SF Symbol (web lucide `icon`), and the description.
/// Name + description are product copy folded into the per-surface i18n table at integration; the id is
/// a stable key (never shown), and the category drives grouping + the topic search.
public struct WidgetCatalogueEntry: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let category: WidgetCatalogueCategory
    public let iconSystemName: String
    public let description: String

    public init(
        id: String,
        name: String,
        category: WidgetCatalogueCategory,
        iconSystemName: String,
        description: String
    ) {
        self.id = id
        self.name = name
        self.category = category
        self.iconSystemName = iconSystemName
        self.description = description
    }

    /// The case-insensitive haystack searched when the query is not a category-label hit (web
    /// `${w.name} ${w.description} ${w.id}`.toLowerCase()).
    public var searchHaystack: String {
        "\(name) \(description) \(id)".lowercased()
    }
}

// MARK: - One filtered category section (web `filteredEntries` tuple)

/// A category paired with its (possibly filtered) entries, preserving registry order — the native
/// parity of the web `[WidgetCategory, WidgetDef[]]` tuple the dialog maps over.
public struct WidgetCatalogueGroup: Sendable, Equatable, Identifiable {
    public let category: WidgetCatalogueCategory
    public let entries: [WidgetCatalogueEntry]

    public var id: String {
        category.rawValue
    }

    public init(category: WidgetCatalogueCategory, entries: [WidgetCatalogueEntry]) {
        self.category = category
        self.entries = entries
    }
}

// MARK: - Load status / freshness / phase

/// The bound source's load status for the catalogue + the active-widget set. The web modal reads a
/// static registry and an `activeWidgetIds` prop; the native surface models the load lifecycle so every
/// state renders (loading / loaded / failed).
public enum WidgetCatalogueLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013) for the active-widget set that decides the "Added" badges: drives
/// the freshness chip + the cached-data banner so the surface clearly labels when the layout came from
/// a cached read rather than a live fetch.
public enum WidgetCatalogueConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the dialog body renders at the top level. The web only ever shows the populated catalogue; the
/// loading / empty / error envelopes are added so a first load (no resolved catalogue) is never a blank
/// box (engineering guideline #6).
public enum WidgetCataloguePhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case populated
}
