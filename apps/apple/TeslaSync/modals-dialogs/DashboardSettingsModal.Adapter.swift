//
//  DashboardSettingsModal.Adapter.swift
//  TeslaSync — P4 modal / dialog · 0022 · DashboardSettingsModal (Apple)
//
//  The dependency-free domain layer for the dashboard-settings modal — the faithful port of
//  features/dashboard/components/DashboardSettingsModal.tsx. The web source is a presentational
//  dialog: it receives the dashboard being edited (`SavedDashboard`) plus the fleet's vehicle list,
//  lets the operator rename it, pick an icon (16-emoji grid), scope it to one vehicle (or all),
//  choose an auto-refresh cadence, and flip two display switches, then hands the deltas back via
//  `onRename` / `onChangeIcon` / `onUpdate` before `onClose`. Everything here is pure Foundation so
//  the value model, the editable draft, the icon + refresh catalogs, and the load / freshness / phase
//  enums are all unit-testable without a bundle or a rendered view. The pure projection (draft build,
//  phase, commit deltas) lives in DashboardSettingsModal.Projection.swift.
//
//  Web parity notes:
//    • `DashboardSettings { refreshInterval, vehicleId?, showWidgetBorders, compactMode }`
//      → `DashboardSettingsValues`.
//    • `SavedDashboard { id, name, icon?, settings? }` (the edited subset) → `DashboardDescriptor`.
//    • `VehicleOption { id, display_name }` → `DashboardVehicleOption`.
//    • `DASHBOARD_EMOJIS` (16-icon grid) → `DashboardIconCatalog`.
//    • `REFRESH_OPTIONS` (6 cadences) → `DashboardRefreshOption` catalog.
//    • the presentational dialog is widened with loading / empty / error / freshness envelopes so no
//      state is ever a blank box (engineering guideline #6), matching the modals-dialogs tier.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core so
/// the projection's unit tests can reach it.
public enum DashboardSettingsSurface {
    public static let slug = "DashboardSettingsModal"
}

// MARK: - Settings value model (web `DashboardSettings`)

/// The persisted dashboard-settings value object (web `DashboardSettings`): the auto-refresh cadence
/// in seconds (`0` = per-widget default), the optional vehicle scope (`nil` = all vehicles), and the
/// two display switches. This is the payload `onUpdate` receives.
public struct DashboardSettingsValues: Sendable, Equatable {
    public var refreshInterval: Int
    public var vehicleID: Int?
    public var showWidgetBorders: Bool
    public var compactMode: Bool

    public init(
        refreshInterval: Int = 0,
        vehicleID: Int? = nil,
        showWidgetBorders: Bool = false,
        compactMode: Bool = false
    ) {
        self.refreshInterval = refreshInterval
        self.vehicleID = vehicleID
        self.showWidgetBorders = showWidgetBorders
        self.compactMode = compactMode
    }

    /// The web `DEFAULT_DASHBOARD_SETTINGS` (`{ refreshInterval: 0, showWidgetBorders: false,
    /// compactMode: false }`, vehicle scope unset).
    public static let defaults = DashboardSettingsValues()
}

// MARK: - Edited dashboard (web `SavedDashboard` subset)

/// The dashboard being configured (web `SavedDashboard`, the fields this modal edits): its id, its
/// display name, its icon (web defaults a missing icon to `📊`), and its current settings (web
/// `dashboard.settings ?? DEFAULT_DASHBOARD_SETTINGS`).
public struct DashboardDescriptor: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let icon: String
    public let settings: DashboardSettingsValues

    public init(
        id: String,
        name: String,
        icon: String = DashboardIconCatalog.defaultIcon,
        settings: DashboardSettingsValues = .defaults
    ) {
        self.id = id
        self.name = name
        self.icon = icon
        self.settings = settings
    }
}

// MARK: - Vehicle option (web `VehicleOption`)

/// One selectable vehicle for the scope picker — the native parity of the web `VehicleOption { id,
/// display_name }`. The display name is operator-authored data (rendered verbatim, never translated).
public struct DashboardVehicleOption: Sendable, Equatable, Identifiable {
    public let id: Int
    public let displayName: String

    public init(id: Int, displayName: String) {
        self.id = id
        self.displayName = displayName
    }
}

// MARK: - Editable draft (web local `useState`)

/// The modal's working state — the native parity of the web `name` / `icon` / `settings` `useState`
/// trio merged into one editable record. `submit` projects this back into the rename / icon / update
/// deltas; the model rebuilds it only when the edited dashboard's identity changes so a freshness
/// flip preserves edits.
public struct DashboardSettingsDraft: Sendable, Equatable {
    public var name: String
    public var icon: String
    public var refreshInterval: Int
    public var vehicleID: Int?
    public var showWidgetBorders: Bool
    public var compactMode: Bool

    public init(
        name: String,
        icon: String,
        refreshInterval: Int,
        vehicleID: Int?,
        showWidgetBorders: Bool,
        compactMode: Bool
    ) {
        self.name = name
        self.icon = icon
        self.refreshInterval = refreshInterval
        self.vehicleID = vehicleID
        self.showWidgetBorders = showWidgetBorders
        self.compactMode = compactMode
    }

    /// The settings value object built from the draft's settings fields (web `onUpdate(settings)`).
    public var settings: DashboardSettingsValues {
        DashboardSettingsValues(
            refreshInterval: refreshInterval,
            vehicleID: vehicleID,
            showWidgetBorders: showWidgetBorders,
            compactMode: compactMode
        )
    }

    /// The empty draft held before any dashboard resolves (overwritten by the first snapshot).
    public static let blank = DashboardSettingsDraft(
        name: "",
        icon: DashboardIconCatalog.defaultIcon,
        refreshInterval: DashboardRefreshCatalog.defaultValue,
        vehicleID: nil,
        showWidgetBorders: false,
        compactMode: false
    )
}

// MARK: - Commit payload (web `onRename` / `onChangeIcon` / `onUpdate`)

/// The aggregated save deltas the modal commits on Save — the faithful port of the web `handleSave`
/// body: an optional renamed title (web `if (name.trim() && name.trim() !== dashboard.name)
/// onRename`), an optional changed icon (web `if (icon !== dashboard.icon) onChangeIcon`), and the
/// always-applied settings (web `onUpdate(settings)`). One struct keeps the action seam small while
/// preserving the three web callbacks' semantics; the `nil` arms are the web no-ops.
public struct DashboardSettingsCommit: Sendable, Equatable {
    public let renamedName: String?
    public let changedIcon: String?
    public let settings: DashboardSettingsValues

    public init(renamedName: String?, changedIcon: String?, settings: DashboardSettingsValues) {
        self.renamedName = renamedName
        self.changedIcon = changedIcon
        self.settings = settings
    }
}

// MARK: - Icon catalog (web `DASHBOARD_EMOJIS`)

/// The 16-emoji picker grid (web `DASHBOARD_EMOJIS`) plus the web default icon (`📊`). The glyphs are
/// rendered verbatim; the grid is 8 columns wide (web `grid-cols-8`).
public enum DashboardIconCatalog {
    /// The web `DASHBOARD_EMOJIS` array, in order.
    public static let icons: [String] = [
        "📊", "🔋", "🚗", "⚡", "🛡️", "🗺️", "📈", "🎯",
        "🔧", "🏠", "🌡️", "🎮", "📱", "🖥️", "🔔", "⭐"
    ]

    /// The web fallback icon (`dashboard.icon ?? '📊'`).
    public static let defaultIcon = "📊"

    /// The grid column count (web `grid-cols-8`).
    public static let columns = 8
}

// MARK: - Auto-refresh catalog (web `REFRESH_OPTIONS`)

/// One auto-refresh cadence option (web `REFRESH_OPTIONS` entry): the interval in seconds, the
/// localized label key (web `dashSettings.refresh{value}`), and the English fallback. `value == 0` is
/// the web "Default (per widget)" cadence.
public struct DashboardRefreshOption: Sendable, Equatable, Identifiable {
    public let value: Int
    public let labelKey: String
    public let labelFallback: String

    public var id: Int {
        value
    }

    public init(value: Int, labelKey: String, labelFallback: String) {
        self.value = value
        self.labelKey = labelKey
        self.labelFallback = labelFallback
    }
}

/// The catalog of auto-refresh cadences, ported verbatim from the web `REFRESH_OPTIONS` (label keys
/// built as `dashSettings.refresh{value}` to match the web `t('dashSettings.refresh' + value, …)`).
public enum DashboardRefreshCatalog {
    public static let options: [DashboardRefreshOption] = [
        option(0, "Default (per widget)"),
        option(5, "Every 5 seconds"),
        option(10, "Every 10 seconds"),
        option(30, "Every 30 seconds"),
        option(60, "Every minute"),
        option(300, "Every 5 minutes")
    ]

    /// The web default cadence (`REFRESH_OPTIONS[0]` = 0, per-widget) used when a draft's interval is
    /// not one of the catalog's offered values.
    public static let defaultValue = 0

    /// Resolves the catalog entry for an interval, falling back to the per-widget default (web
    /// `<Select>` with an unmatched value shows the first option).
    public static func option(for value: Int) -> DashboardRefreshOption {
        options.first { $0.value == value } ?? options[0]
    }

    private static func option(_ value: Int, _ fallback: String) -> DashboardRefreshOption {
        DashboardRefreshOption(value: value, labelKey: "dashSettings.refresh\(value)", labelFallback: fallback)
    }
}

// MARK: - Load status / freshness / phase

/// The bound source's load status for the modal's data (the edited dashboard + the fleet vehicle
/// list). The web modal receives both as props; the native surface models the load lifecycle so every
/// state renders.
public enum DashboardSettingsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013) for the fleet vehicle list that feeds the scope picker: drives the
/// freshness chip + the cached-data banner so the surface clearly labels when the vehicle list came
/// from a cached read rather than a live fetch.
public enum DashboardSettingsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the dialog body renders at the top level. The web only ever shows the populated form; the
/// loading / empty / error envelopes are added so a first-load (no resolved dashboard) is never a
/// blank box (engineering guideline #6).
public enum DashboardSettingsPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case populated
}
