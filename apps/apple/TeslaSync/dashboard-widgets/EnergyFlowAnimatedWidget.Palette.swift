//
//  EnergyFlowAnimatedWidget.Palette.swift
//  TeslaSync — P4 dashboard widget · 0045 · EnergyFlowAnimatedWidget (Apple)
//
//  Semantic flow palette — a port of the Tailwind colors the web animated widget
//  sets: the consuming arrow + header `Zap` glyph + compact consuming chip use
//  cyan-400, the regen arrow + compact regen chip use emerald-400, and the charge
//  arrow + compact charging chip use amber-400. The animated widget's node glyphs
//  are intentionally uncolored in the web source (they inherit `--text-primary`),
//  so node icons resolve to the text token. Neutral chrome (circle fill/stroke,
//  labels) uses design tokens so the light theme keeps working.
//

import SwiftUI

// MARK: - Flow palette (port of the web arrow/chip Tailwind colors)

/// Brand-ish flow colors that stay consistent across themes (like the chart
/// palette), plus the neutral diagram chrome resolved from design tokens.
enum EnergyFlowAnimatedPalette {
    /// `text-cyan-400` (#22D3EE) — consuming arrow, header glyph, consuming chip.
    static let cyan = Color(.sRGB, red: 0.133, green: 0.827, blue: 0.933, opacity: 1)
    /// `text-emerald-400` (#34D399) — regen arrow + regen chip.
    static let emerald = Color(.sRGB, red: 0.204, green: 0.827, blue: 0.600, opacity: 1)
    /// `text-amber-400` (#FBBF24) — charge arrow + charging chip.
    static let amber = Color(.sRGB, red: 0.984, green: 0.749, blue: 0.141, opacity: 1)

    /// Resolves a semantic arrow tint to its color (web arrow `color`).
    static func color(for tint: EnergyFlowAnimatedTint) -> Color {
        switch tint {
        case .cyan: cyan
        case .emerald: emerald
        case .amber: amber
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

    /// The node glyph + ring value color (web node icon wrapped in
    /// `text-[var(--text-primary)]`; the animated widget gives node icons no tint).
    static var nodeGlyph: Color {
        Color.TS.textPrimary
    }

    /// The node label color (web `fill-white/60`).
    static var nodeLabel: Color {
        Color.TS.textMuted
    }
}
