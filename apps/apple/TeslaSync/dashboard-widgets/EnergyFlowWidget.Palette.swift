//
//  EnergyFlowWidget.Palette.swift
//  TeslaSync — P4 dashboard widget · 0046 · EnergyFlowWidget (Apple)
//
//  Semantic flow palette — a port of the per-node/arrow Tailwind colors the web
//  sets (battery emerald-400, motor purple-400, charger amber-400; consuming arrow
//  cyan-400, regen arrow emerald-400, charge arrow amber-400). The header `Activity`
//  glyph uses the project neon-cyan. Neutral chrome (circle fill/stroke, labels)
//  uses design tokens so the light theme keeps working.
//

import SwiftUI

// MARK: - Flow palette (port of the web node/arrow Tailwind colors)

/// Brand-ish flow colors that stay consistent across themes (like the chart
/// palette), plus the neutral diagram chrome resolved from design tokens.
enum EnergyFlowPalette {
    /// `text-emerald-400` (#34D399) — battery node + regen arrow.
    static let emerald = Color(.sRGB, red: 0.204, green: 0.827, blue: 0.600, opacity: 1)
    /// `text-purple-400` (#C084FC) — motor node.
    static let purple = Color(.sRGB, red: 0.753, green: 0.518, blue: 0.988, opacity: 1)
    /// `text-amber-400` (#FBBF24) — charger node + charge arrow.
    static let amber = Color(.sRGB, red: 0.984, green: 0.749, blue: 0.141, opacity: 1)
    /// `text-cyan-400` (#22D3EE) — consuming arrow.
    static let cyan = Color(.sRGB, red: 0.133, green: 0.827, blue: 0.933, opacity: 1)
    /// `text-neon-cyan` (#00F0FF) — the header `Activity` glyph.
    static let neonCyan = Color(.sRGB, red: 0.0, green: 0.941, blue: 1.0, opacity: 1)

    /// Resolves a semantic tint to its color (web node `icon` color / arrow `color`).
    static func color(for tint: EnergyFlowTint) -> Color {
        switch tint {
        case .emerald: emerald
        case .purple: purple
        case .amber: amber
        case .cyan: cyan
        }
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
