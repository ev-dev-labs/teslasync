//
//  KioskSettingsModal.Adapter.swift
//  TeslaSync — P4 modal / dialog · 0025 · KioskSettingsModal (Apple)
//
//  The dependency-free domain layer for the dashboard kiosk-mode settings modal — the faithful port
//  of features/dashboard/components/KioskSettingsModal.tsx. The web source is a controlled settings
//  form: it receives the current `KioskConfig`, an `onUpdateConfig` updater (persisted to
//  localStorage by the parent `useKioskMode` hook), the saved-dashboard list to rotate, and the
//  enter / close callbacks, then lets the operator tune the rotation cadence, the dashboards to
//  rotate, the display behaviours (cursor auto-hide, screen dim, clock), and the widget / background
//  transparency, with a live preview swatch. Everything here is pure Foundation so the config model,
//  the option catalogs, the clock-position enum, the slider bounds, and the load / freshness / phase
//  enums are all unit-testable without a bundle or a rendered view. The pure projection (selection
//  toggling, conditional reveals, preview math, slider conversions, phase) lives in
//  KioskSettingsModal.Projection.swift.
//
//  Web parity notes:
//    • `KioskConfig` (useKioskMode.ts) → `KioskConfig` (same 10 fields, same defaults).
//    • `ROTATION_OPTIONS` / `CURSOR_TIMEOUT_OPTIONS` / `DIM_AFTER_OPTIONS` → `KioskCatalog` catalogs.
//    • `CLOCK_POSITION_OPTIONS` → `KioskClockPosition` (raw values kept as the web `top-left` … ids).
//    • `SavedDashboard` (the rotate list) → `KioskDashboard` (the id + name + isDefault subset used).
//    • the presentational dialog is widened with loading / empty / error / freshness envelopes so no
//      state is ever a blank box (engineering guideline #6), matching the prior modals-dialogs tier.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core so
/// the projection's unit tests can reach it.
public enum KioskSettingsSurface {
    public static let slug = "KioskSettingsModal"
}

// MARK: - Clock position (web `CLOCK_POSITION_OPTIONS`)

/// Where the kiosk clock overlay is pinned (web `config.clockPosition`). Raw values match the web
/// string ids verbatim so a round-trip through the persisted config is lossless; the labels resolve
/// through P1/S10.
public enum KioskClockPosition: String, Sendable, Equatable, CaseIterable, Identifiable {
    case topLeft = "top-left"
    case topRight = "top-right"
    case bottomLeft = "bottom-left"
    case bottomRight = "bottom-right"

    public var id: String {
        rawValue
    }

    /// The localized option-label key (web `CLOCK_POSITION_OPTIONS[i].label`).
    public var labelKey: String {
        switch self {
        case .topLeft: "kiosk.clockPos.topLeft"
        case .topRight: "kiosk.clockPos.topRight"
        case .bottomLeft: "kiosk.clockPos.bottomLeft"
        case .bottomRight: "kiosk.clockPos.bottomRight"
        }
    }

    /// The web option label (the English fallback).
    public var labelFallback: String {
        switch self {
        case .topLeft: "Top Left"
        case .topRight: "Top Right"
        case .bottomLeft: "Bottom Left"
        case .bottomRight: "Bottom Right"
        }
    }
}

// MARK: - Saved dashboard (web `SavedDashboard` subset)

/// One saved dashboard the kiosk can rotate through — the native parity of the web `SavedDashboard`
/// fields this modal reads (`id`, `name`, `isDefault`). The name is operator-authored data rendered
/// verbatim; `isDefault` drives the "Default" chip.
public struct KioskDashboard: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let isDefault: Bool

    public init(id: String, name: String, isDefault: Bool = false) {
        self.id = id
        self.name = name
        self.isDefault = isDefault
    }
}

// MARK: - Kiosk config (web `KioskConfig`)

/// The editable kiosk-mode configuration — the native parity of the web `KioskConfig` (useKioskMode).
/// Each mutator on the model writes a new value here and persists it through the action seam (web
/// `onUpdateConfig`, which saves to localStorage). Stored in domain units: `rotateInterval` and
/// `cursorTimeout` in seconds, `dimAfter` in minutes, and the three opacity / dim values as 0…1
/// fractions (the sliders present them as integer percents).
public struct KioskConfig: Sendable, Equatable {
    /// Dashboard auto-rotation cadence in seconds (`0` = off). Web `rotateInterval`.
    public var rotateInterval: Int
    /// The ids of the dashboards included in the rotation. Web `dashboardIds`.
    public var dashboardIds: [String]
    /// Whether the cursor auto-hides while idle. Web `hideCursor`.
    public var hideCursor: Bool
    /// Idle seconds before the cursor hides. Web `cursorTimeout`.
    public var cursorTimeout: Int
    /// Idle minutes before the screen dims (`0` = never). Web `dimAfter`.
    public var dimAfter: Int
    /// The dimmed-screen brightness as a 0…1 fraction. Web `dimLevel`.
    public var dimLevel: Double
    /// Whether the clock overlay is shown. Web `showClock`.
    public var showClock: Bool
    /// Where the clock overlay is pinned. Web `clockPosition`.
    public var clockPosition: KioskClockPosition
    /// Widget-panel opacity as a 0.3…1 fraction (transparent → solid). Web `widgetOpacity`.
    public var widgetOpacity: Double
    /// Page-background opacity as a 0…1 fraction (transparent → solid). Web `backgroundOpacity`.
    public var backgroundOpacity: Double

    public init(
        rotateInterval: Int,
        dashboardIds: [String],
        hideCursor: Bool,
        cursorTimeout: Int,
        dimAfter: Int,
        dimLevel: Double,
        showClock: Bool,
        clockPosition: KioskClockPosition,
        widgetOpacity: Double,
        backgroundOpacity: Double
    ) {
        self.rotateInterval = rotateInterval
        self.dashboardIds = dashboardIds
        self.hideCursor = hideCursor
        self.cursorTimeout = cursorTimeout
        self.dimAfter = dimAfter
        self.dimLevel = dimLevel
        self.showClock = showClock
        self.clockPosition = clockPosition
        self.widgetOpacity = widgetOpacity
        self.backgroundOpacity = backgroundOpacity
    }

    /// The web `DEFAULT_KIOSK_CONFIG` — the seed used when no persisted config exists.
    public static let `default` = KioskConfig(
        rotateInterval: 30,
        dashboardIds: [],
        hideCursor: true,
        cursorTimeout: 5,
        dimAfter: 0,
        dimLevel: 0.5,
        showClock: true,
        clockPosition: .bottomRight,
        widgetOpacity: 1.0,
        backgroundOpacity: 1.0
    )
}

// MARK: - Option catalogs (web `*_OPTIONS`)

/// One labelled numeric option for a kiosk picker (web `{ value, label }`). The value is the stored
/// seconds / minutes; the label resolves through P1/S10.
public struct KioskOption: Sendable, Equatable, Identifiable {
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

/// Inclusive integer-percent bounds for a slider (web `min` / `max` / `step`), kept in the pure layer
/// so the slider math is testable without a view.
public struct KioskSliderBounds: Sendable, Equatable {
    public let min: Int
    public let max: Int
    public let step: Int

    public init(min: Int, max: Int, step: Int) {
        self.min = min
        self.max = max
        self.step = step
    }
}

/// The kiosk picker option catalogs + the slider bounds, ported verbatim from the web option arrays.
public enum KioskCatalog {
    /// Web `ROTATION_OPTIONS` (seconds; `0` = off).
    public static let rotationOptions: [KioskOption] = [
        KioskOption(value: 0, labelKey: "kiosk.rotation.opt.0", labelFallback: "Off"),
        KioskOption(value: 10, labelKey: "kiosk.rotation.opt.10", labelFallback: "10s"),
        KioskOption(value: 15, labelKey: "kiosk.rotation.opt.15", labelFallback: "15s"),
        KioskOption(value: 30, labelKey: "kiosk.rotation.opt.30", labelFallback: "30s"),
        KioskOption(value: 60, labelKey: "kiosk.rotation.opt.60", labelFallback: "1 min"),
        KioskOption(value: 120, labelKey: "kiosk.rotation.opt.120", labelFallback: "2 min"),
        KioskOption(value: 300, labelKey: "kiosk.rotation.opt.300", labelFallback: "5 min")
    ]

    /// Web `CURSOR_TIMEOUT_OPTIONS` (seconds).
    public static let cursorTimeoutOptions: [KioskOption] = [
        KioskOption(value: 3, labelKey: "kiosk.cursor.opt.3", labelFallback: "3s"),
        KioskOption(value: 5, labelKey: "kiosk.cursor.opt.5", labelFallback: "5s"),
        KioskOption(value: 10, labelKey: "kiosk.cursor.opt.10", labelFallback: "10s"),
        KioskOption(value: 15, labelKey: "kiosk.cursor.opt.15", labelFallback: "15s")
    ]

    /// Web `DIM_AFTER_OPTIONS` (minutes; `0` = never).
    public static let dimAfterOptions: [KioskOption] = [
        KioskOption(value: 0, labelKey: "kiosk.dim.opt.0", labelFallback: "Never"),
        KioskOption(value: 5, labelKey: "kiosk.dim.opt.5", labelFallback: "5 min"),
        KioskOption(value: 10, labelKey: "kiosk.dim.opt.10", labelFallback: "10 min"),
        KioskOption(value: 15, labelKey: "kiosk.dim.opt.15", labelFallback: "15 min"),
        KioskOption(value: 30, labelKey: "kiosk.dim.opt.30", labelFallback: "30 min"),
        KioskOption(value: 60, labelKey: "kiosk.dim.opt.60", labelFallback: "60 min")
    ]

    /// Web dimmed-brightness slider (`min={30} max={90}`, default step `1`).
    public static let brightnessBounds = KioskSliderBounds(min: 30, max: 90, step: 1)

    /// Web widget-opacity slider (`min={30} max={100} step={5}`).
    public static let widgetOpacityBounds = KioskSliderBounds(min: 30, max: 100, step: 5)

    /// Web background-opacity slider (`min={0} max={100} step={5}`).
    public static let backgroundOpacityBounds = KioskSliderBounds(min: 0, max: 100, step: 5)
}

// MARK: - Load status / freshness / phase

/// The bound source's load status for the saved-dashboard list + persisted config. The web modal
/// receives these as resolved props; the native surface models the load lifecycle so every state
/// renders rather than flashing a blank dialog.
public enum KioskLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so the
/// surface clearly labels when the dashboards / config came from a cached read.
public enum KioskConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the dialog body renders at the top level. The web only ever shows the populated settings
/// form; the loading / empty / error envelopes are added so a first-load (no cached dashboards) is
/// never a blank box (engineering guideline #6).
public enum KioskPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case populated
}
