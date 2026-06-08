//
//  LivePowerFlowWidget.Palette.swift
//  TeslaSync — P4 dashboard widget · 0056 · LivePowerFlowWidget (Apple)
//
//  Semantic flow palette — a port of the per-node Tailwind colors the web sets on
//  the nodes/arrows (solar yellow-400, grid blue-400, home emerald-400, battery
//  purple-400). Neutral chrome (circle fill/stroke, labels) uses design tokens so
//  the light theme keeps working.
//

import SwiftUI

// MARK: - Flow palette (port of the web node/arrow Tailwind colors)

/// Brand-ish node colors that stay consistent across themes (like the chart
/// palette), plus the neutral diagram chrome resolved from design tokens.
enum LivePowerFlowPalette {
    /// solar → `text-yellow-400` (#FACC15).
    static let solar = Color(.sRGB, red: 0.980, green: 0.800, blue: 0.082, opacity: 1)
    /// grid → `text-blue-400` (#60A5FA).
    static let grid = Color(.sRGB, red: 0.376, green: 0.647, blue: 0.980, opacity: 1)
    /// home → `text-emerald-400` (#34D399).
    static let home = Color(.sRGB, red: 0.204, green: 0.827, blue: 0.600, opacity: 1)
    /// battery → `text-purple-400` (#C084FC).
    static let battery = Color(.sRGB, red: 0.753, green: 0.518, blue: 0.988, opacity: 1)
    /// the web `arrowColor` negative branch → `text-red-400` (#F87171).
    static let negative = Color(.sRGB, red: 0.973, green: 0.443, blue: 0.443, opacity: 1)

    /// The semantic color for a node id (web node `icon` color).
    static func color(for node: PowerFlowNodeID) -> Color {
        switch node {
        case .solar: solar
        case .grid: grid
        case .home: home
        case .battery: battery
        }
    }

    /// The color an arrow is drawn with — the source node's color, matching the
    /// explicit `color` the web sets on every arrow.
    static func arrowColor(_ arrow: PowerFlowArrow) -> Color {
        color(for: arrow.colorNode)
    }

    /// The web `arrowColor(value, override)` fallback when no override is set:
    /// positive emerald, negative red, otherwise muted. Kept for parity/tests;
    /// the widget always supplies an override.
    static func fallbackArrowColor(value: Double) -> Color {
        if value > 0 { return home }
        if value < 0 { return negative }
        return Color.TS.textMuted
    }

    /// The node circle fill (web `fill-white/5`) — token-based so it shows on both
    /// themes.
    static var nodeFill: Color {
        Color.TS.textPrimary.opacity(0.05)
    }

    /// The node circle stroke (web `stroke-white/20`).
    static var nodeStroke: Color {
        Color.TS.border
    }

    /// The node label color (web `fill-white/60`).
    static var nodeLabel: Color {
        Color.TS.textMuted
    }
}
