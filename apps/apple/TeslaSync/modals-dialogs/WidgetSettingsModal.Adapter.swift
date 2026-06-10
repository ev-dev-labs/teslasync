//
//  WidgetSettingsModal.Adapter.swift
//  TeslaSync — P4 modal / dialog · 0027 · WidgetSettingsModal (Apple)
//
//  The dependency-free domain layer for the widget-settings modal — the faithful port of
//  features/dashboard/components/WidgetSettingsModal.tsx. The web source is a small presentational
//  dialog: it receives the widget instance being configured (its saved `WidgetConfig`) plus the
//  widget definition (`WidgetDef`, for the title + the category-driven section visibility), reads the
//  fleet vehicle list via `useVehicles`, lets the operator scope the widget to one vehicle (or all),
//  choose a refresh cadence, pick a chart time range, and flip the "show widget title" switch, then
//  hands the merged config back via `onSave(config)` before `onClose()`. Everything here is pure
//  Foundation so the value model, the editable draft, the refresh + time-range catalogs, the
//  category visibility rules, and the load / freshness / phase enums are all unit-testable without a
//  bundle or a rendered view. The pure projection (draft build, phase, commit deltas, derived flags)
//  lives in WidgetSettingsModal.Projection.swift.
//
//  Web parity notes:
//    • `WidgetConfig { vehicleId?, refreshRate?, timeRange?, showTitle?, chartType?, [key] }`
//      → `WidgetConfigValues` (the editable subset; arbitrary extra keys are preserved by the
//      production action seam at the merge boundary, not modeled here).
//    • `WidgetInstance { id, config? }` + `WidgetDef { id, name, category }` (the edited subset)
//      → `WidgetDescriptor`.
//    • `VehicleOption { id, display_name }` → `WidgetVehicleOption`.
//    • the refresh `<Select>` (Default / 5 / 15 / 30 / 60s) → `WidgetRefreshCatalog`.
//    • the time-range `<Select>` (24h / 7d / 30d / 90d) → `WidgetTimeRangeCatalog`.
//    • `isVehicleWidget` / `isChartWidget` → `WidgetSettingsCategory` computed flags.
//    • the presentational dialog is widened with loading / empty / error / freshness envelopes so no
//      state is ever a blank box (engineering guideline #6), matching the modals-dialogs tier.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core so
/// the projection's unit tests can reach it.
public enum WidgetSettingsSurface {
    public static let slug = "WidgetSettingsModal"
}

// MARK: - Widget category (web `WidgetCategory`)

/// One widget category — the native parity of the web `WidgetCategory` union. Drives which optional
/// sections the modal shows: the vehicle scope (web `isVehicleWidget`) and the chart time range (web
/// `isChartWidget`).
public enum WidgetSettingsCategory: String, Sendable, Equatable, CaseIterable {
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

    /// Whether the vehicle-scope section is shown (web `def.category !== 'system' && !== 'analytics'`).
    public var isVehicleWidget: Bool {
        self != .system && self != .analytics
    }

    /// Whether the chart time-range section is shown (web `category === 'driving' | 'charging' |
    /// 'analytics' | 'battery'`).
    public var isChartWidget: Bool {
        switch self {
        case .driving, .charging, .analytics, .battery:
            true
        default:
            false
        }
    }
}

// MARK: - Config value model (web `WidgetConfig`)

/// The persisted widget-config value object (web `WidgetConfig`, the fields this modal edits plus the
/// passed-through `chartType`): the optional vehicle scope (`nil` = all vehicles, web `undefined`),
/// the optional refresh cadence in seconds (`nil` = per-widget default), the optional chart time
/// range (`nil` = the web `'7d'` display default, not persisted until chosen), and the optional
/// show-title switch (`nil` = the web default-on). This is the payload `onSave` receives.
public struct WidgetConfigValues: Sendable, Equatable {
    public var vehicleID: Int?
    public var refreshRate: Int?
    public var timeRange: String?
    public var showTitle: Bool?
    public var chartType: String?

    public init(
        vehicleID: Int? = nil,
        refreshRate: Int? = nil,
        timeRange: String? = nil,
        showTitle: Bool? = nil,
        chartType: String? = nil
    ) {
        self.vehicleID = vehicleID
        self.refreshRate = refreshRate
        self.timeRange = timeRange
        self.showTitle = showTitle
        self.chartType = chartType
    }

    /// The web checked state for the show-title switch (`config.showTitle !== false`): a missing value
    /// reads as on.
    public var showTitleChecked: Bool {
        showTitle != false
    }

    /// The web empty config (`widget.config ?? {}`).
    public static let empty = WidgetConfigValues()
}

// MARK: - Edited widget (web `WidgetInstance` + `WidgetDef` subset)

/// The widget being configured — the native parity of the web `widget` (instance id + saved config)
/// merged with the `def` fields the modal reads (its display name for the title and its category for
/// the section visibility). Identity is the instance id, so the model rebuilds the editable draft only
/// when a different widget instance is configured (a freshness flip preserves edits).
public struct WidgetDescriptor: Sendable, Equatable, Identifiable {
    /// The widget-instance id (web `widget.id`) — the rebuild identity.
    public let id: String
    /// The widget-definition id (web `widget.widgetId` / `def.id`).
    public let definitionID: String
    /// The widget display name (web `def.name`), rendered verbatim into the dialog title.
    public let name: String
    /// The widget category (web `def.category`), driving the optional sections.
    public let category: WidgetSettingsCategory
    /// The saved widget config (web `widget.config ?? {}`).
    public let config: WidgetConfigValues

    public init(
        id: String,
        definitionID: String,
        name: String,
        category: WidgetSettingsCategory,
        config: WidgetConfigValues = .empty
    ) {
        self.id = id
        self.definitionID = definitionID
        self.name = name
        self.category = category
        self.config = config
    }

    /// Whether the vehicle-scope section is shown for this widget (web `isVehicleWidget`).
    public var showsVehicleSection: Bool {
        category.isVehicleWidget
    }

    /// Whether the chart time-range section is shown for this widget (web `isChartWidget`).
    public var showsTimeRangeSection: Bool {
        category.isChartWidget
    }
}

// MARK: - Vehicle option (web `VehicleOption`)

/// One selectable vehicle for the scope picker — the native parity of the web `VehicleOption { id,
/// display_name }`. The display name is operator-authored data (rendered verbatim, never translated);
/// an empty name falls back to the web `Vehicle {id}` label at the display boundary.
public struct WidgetVehicleOption: Sendable, Equatable, Identifiable {
    public let id: Int
    public let displayName: String

    public init(id: Int, displayName: String) {
        self.id = id
        self.displayName = displayName
    }
}

// MARK: - Editable draft (web local `useState<WidgetConfig>`)

/// The modal's working state — the native parity of the web `config` `useState`. `values` projects it
/// back into the saved config (web `onSave(config)`); the model rebuilds it only when the edited
/// widget's identity changes so a freshness flip preserves edits. The `chartType` is carried untouched
/// so a save round-trips it (web spreads `...prev`).
public struct WidgetSettingsDraft: Sendable, Equatable {
    public var vehicleID: Int?
    public var refreshRate: Int?
    public var timeRange: String?
    public var showTitle: Bool?
    public var chartType: String?

    public init(
        vehicleID: Int? = nil,
        refreshRate: Int? = nil,
        timeRange: String? = nil,
        showTitle: Bool? = nil,
        chartType: String? = nil
    ) {
        self.vehicleID = vehicleID
        self.refreshRate = refreshRate
        self.timeRange = timeRange
        self.showTitle = showTitle
        self.chartType = chartType
    }

    /// The config value object built from the draft (web `onSave(config)`).
    public var values: WidgetConfigValues {
        WidgetConfigValues(
            vehicleID: vehicleID,
            refreshRate: refreshRate,
            timeRange: timeRange,
            showTitle: showTitle,
            chartType: chartType
        )
    }

    /// The web checked state for the show-title switch (`config.showTitle !== false`).
    public var showTitleChecked: Bool {
        showTitle != false
    }

    /// The empty draft held before any widget resolves (overwritten by the first snapshot).
    public static let blank = WidgetSettingsDraft()
}

// MARK: - Commit payload (web `onSave`)

/// The saved config the modal commits on Save — the faithful port of the web `handleSave` body
/// (`onSave(config)`). One struct keeps the action seam small while preserving the web semantics; the
/// production adapter merges this onto the persisted config so any extra config keys beyond the edited
/// subset survive (web spreads `...prev`).
public struct WidgetSettingsCommit: Sendable, Equatable {
    public let config: WidgetConfigValues

    public init(config: WidgetConfigValues) {
        self.config = config
    }
}

// MARK: - Refresh cadence catalog (web refresh `<Select>`)

/// One refresh-cadence option (web refresh `<Select>` entry): the interval in seconds (`nil` = the web
/// `'default'` per-widget cadence), the localized label key, and the English fallback.
public struct WidgetRefreshOption: Sendable, Equatable, Identifiable {
    public let value: Int?
    public let labelKey: String
    public let labelFallback: String

    /// A stable identity for `ForEach` (`"default"` for the per-widget cadence, else the seconds).
    public var id: String {
        value.map(String.init) ?? "default"
    }

    public init(value: Int?, labelKey: String, labelFallback: String) {
        self.value = value
        self.labelKey = labelKey
        self.labelFallback = labelFallback
    }
}

/// The catalog of refresh cadences, ported verbatim from the web refresh `<Select>` options (Default /
/// 5 / 15 / 30 / 60 seconds) with the web `dashboard.settings.*` label keys.
public enum WidgetRefreshCatalog {
    public static let options: [WidgetRefreshOption] = [
        WidgetRefreshOption(value: nil, labelKey: "dashboard.settings.default", labelFallback: "Default"),
        WidgetRefreshOption(value: 5, labelKey: "dashboard.settings.5s", labelFallback: "5 seconds"),
        WidgetRefreshOption(value: 15, labelKey: "dashboard.settings.15s", labelFallback: "15 seconds"),
        WidgetRefreshOption(value: 30, labelKey: "dashboard.settings.30s", labelFallback: "30 seconds"),
        WidgetRefreshOption(value: 60, labelKey: "dashboard.settings.60s", labelFallback: "1 minute")
    ]
}

// MARK: - Time-range catalog (web time-range `<Select>`)

/// One chart time-range option (web time-range `<Select>` entry): the range token (web value, e.g.
/// `'7d'`), the localized label key, and the English fallback.
public struct WidgetTimeRangeOption: Sendable, Equatable, Identifiable {
    public let value: String
    public let labelKey: String
    public let labelFallback: String

    public var id: String {
        value
    }

    public init(value: String, labelKey: String, labelFallback: String) {
        self.value = value
        self.labelKey = labelKey
        self.labelFallback = labelFallback
    }
}

/// The catalog of chart time ranges, ported verbatim from the web time-range `<Select>` options (Last
/// 24 hours / 7 days / 30 days / 90 days) with the web `dashboard.settings.*` label keys.
public enum WidgetTimeRangeCatalog {
    public static let options: [WidgetTimeRangeOption] = [
        WidgetTimeRangeOption(value: "24h", labelKey: "dashboard.settings.24h", labelFallback: "Last 24 hours"),
        WidgetTimeRangeOption(value: "7d", labelKey: "dashboard.settings.7d", labelFallback: "Last 7 days"),
        WidgetTimeRangeOption(value: "30d", labelKey: "dashboard.settings.30d", labelFallback: "Last 30 days"),
        WidgetTimeRangeOption(value: "90d", labelKey: "dashboard.settings.90d", labelFallback: "Last 90 days")
    ]

    /// The web display default (`config.timeRange ?? '7d'`) shown when no range has been chosen.
    public static let defaultValue = "7d"
}

// MARK: - Load status / freshness / phase

/// The bound source's load status for the modal's data (the edited widget + the fleet vehicle list).
/// The web modal receives the widget as props and the vehicle list from `useVehicles`; the native
/// surface models the load lifecycle so every state renders.
public enum WidgetSettingsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013) for the fleet vehicle list that feeds the scope picker: drives the
/// freshness chip + the cached-data banner so the surface clearly labels when the vehicle list came
/// from a cached read rather than a live fetch.
public enum WidgetSettingsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the dialog body renders at the top level. The web only ever shows the populated form; the
/// loading / empty / error envelopes are added so a first-load (no resolved widget) is never a blank
/// box (engineering guideline #6).
public enum WidgetSettingsPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case populated
}
