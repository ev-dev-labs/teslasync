//
//  DashboardGrid.Geometry.swift
//  TeslaSync — P4 feature view · 0122 · DashboardGrid (Apple)
//
//  The presentation-support projections split out of the Adapter (SwiftLint
//  file-length): the absolute-placement pixel geometry (the native equivalent of
//  react-grid-layout's x/y/w/h positioning), the kiosk-opacity map (web
//  `kioskPanelStyle`), the live freshness chip (stale / offline), and the VoiceOver
//  summaries. All pure and unit-tested alongside the Adapter projections — no
//  SwiftUI, no I/O.
//

import CoreGraphics
import Foundation

// MARK: - Absolute placement (native equivalent of RGL's x/y/w/h positioning)

/// The pure frame math for the desktop grid — the native equivalent of
/// react-grid-layout's absolute placement. A widget at grid `(x, y)` spanning
/// `(columnSpan, rowSpan)` maps to a pixel frame given the measured column width,
/// the fixed row height, and the gap. Factored out so the custom SwiftUI `Layout`
/// stays a thin shell and the geometry is unit-testable.
public enum DashboardGridPlacement {
    /// The width of a single column given the container width, column count, and gap.
    public static func columnWidth(totalWidth: CGFloat, columns: Int, spacing: CGFloat) -> CGFloat {
        guard columns > 0 else { return max(totalWidth, 0) }
        let gaps = CGFloat(columns - 1) * spacing
        return max((totalWidth - gaps) / CGFloat(columns), 0)
    }

    /// The pixel frame (origin + size) for one layout item.
    public static func frame(
        for item: DashboardGridLayoutItem,
        columnWidth: CGFloat,
        rowHeight: CGFloat,
        spacing: CGFloat
    ) -> CGRect {
        let originX = CGFloat(item.x) * (columnWidth + spacing)
        let originY = CGFloat(item.y) * (rowHeight + spacing)
        let width = CGFloat(item.columnSpan) * columnWidth + CGFloat(max(item.columnSpan - 1, 0)) * spacing
        let height = CGFloat(item.rowSpan) * rowHeight + CGFloat(max(item.rowSpan - 1, 0)) * spacing
        return CGRect(x: originX, y: originY, width: width, height: height)
    }

    /// The total content height needed to fit every item (the bottom-most row edge),
    /// so the grid reserves the right height in a scroll view.
    public static func contentHeight(
        items: [DashboardGridLayoutItem],
        rowHeight: CGFloat,
        spacing: CGFloat
    ) -> CGFloat {
        let bottomRow = items.map { $0.y + $0.rowSpan }.max() ?? 0
        guard bottomRow > 0 else { return 0 }
        return CGFloat(bottomRow) * rowHeight + CGFloat(bottomRow - 1) * spacing
    }
}

// MARK: - Kiosk panel boost (web `kioskPanelStyle`)

/// The resolved kiosk panel background — the port of the web `kioskPanelStyle`
/// (`alpha = 0.03 + opacity * 0.17`, `blur = 4 + opacity * 12`). `nil` keeps the
/// default glass material.
public struct DashboardKioskStyle: Equatable, Sendable {
    /// The white-fill opacity layered over the glass panel.
    public let backgroundOpacity: Double
    /// The blur radius (pt) for the boosted backdrop.
    public let blurRadius: Double

    public static func resolve(opacity: Double?) -> DashboardKioskStyle? {
        guard let opacity else { return nil }
        return DashboardKioskStyle(
            backgroundOpacity: 0.03 + opacity * 0.17,
            blurRadius: 4 + opacity * 12
        )
    }
}

// MARK: - Freshness chip (live / stale / offline)

/// The freshness chip projection for the grid chrome — `live` shows nothing,
/// `stale`/`offline` surface a static chip so the dashboard never implies fresh
/// data it cannot prove while keeping the cached widgets visible.
public enum DashboardGridFreshnessChip: Equatable, Sendable {
    case stale
    case offline

    public static func project(_ connection: DashboardGridConnection) -> DashboardGridFreshnessChip? {
        switch connection {
        case .live: nil
        case .stale: .stale
        case .offline: .offline
        }
    }

    public var labelKey: String {
        switch self {
        case .stale: "dashboard.grid.freshness.stale"
        case .offline: "dashboard.grid.freshness.offline"
        }
    }

    public var labelFallback: String {
        switch self {
        case .stale: "Stale"
        case .offline: "Offline"
        }
    }

    public var systemImage: String {
        switch self {
        case .stale: "clock.arrow.circlepath"
        case .offline: "wifi.slash"
        }
    }

    public var tone: TSTone {
        switch self {
        case .stale: .warning
        case .offline: .neutral
        }
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Pure VoiceOver string builders so the grid announces as coherent elements and
/// the tests can assert label presence without a rendering host. The web aria-labels
/// (`Settings for ${def.name}`, `Remove ${def.name}`, `Expand ${def.name}`) are
/// ported with `%@` interpolation.
public enum DashboardGridAccessibility {
    /// The grid container label — web `role`-less container; native names it.
    public static func gridLabel(_ localize: DashboardGridLocalizer) -> String {
        localize.string("dashboard.grid.accessibilityLabel", "Dashboard widget grid")
    }

    /// One tile's combined label — `<name> widget`.
    public static func tileLabel(_ name: String, localize: DashboardGridLocalizer) -> String {
        localize.format("dashboard.grid.widget.tile", "%@ widget", name)
    }

    /// Web `aria-label={`Settings for ${def.name}`}`.
    public static func settingsLabel(_ name: String, localize: DashboardGridLocalizer) -> String {
        localize.format("dashboard.grid.widget.settings", "Settings for %@", name)
    }

    /// Web `aria-label={`Remove ${def.name}`}`.
    public static func removeLabel(_ name: String, localize: DashboardGridLocalizer) -> String {
        localize.format("dashboard.grid.widget.remove", "Remove %@", name)
    }

    /// Web `aria-label={`Expand ${def.name}`}`.
    public static func expandLabel(_ name: String, localize: DashboardGridLocalizer) -> String {
        localize.format("dashboard.grid.widget.expand", "Expand %@", name)
    }

    /// Web drag-handle region label.
    public static func dragHandleLabel(_ name: String, localize: DashboardGridLocalizer) -> String {
        localize.format("dashboard.grid.widget.dragHandle", "Drag to reorder %@", name)
    }

    /// Web `Exit Fullscreen` control.
    public static func exitFullscreenLabel(_ localize: DashboardGridLocalizer) -> String {
        localize.string("dashboard.grid.fullscreen.exit", "Exit Fullscreen")
    }
}
