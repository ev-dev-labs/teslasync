//
//  StateTimelineWidget.Palette.swift
//  TeslaSync — P4 dashboard widget · 0096 · StateTimelineWidget (Apple)
//
//  Semantic state palette — a faithful port of the web `STATE_COLORS` map the
//  widget paints the stacked bar / legend dots / 24h stripe with (driving
//  cyan-400, charging green-500, asleep purple-500, idle amber-500, offline
//  red-500, everything-else grey-500). These categorical colors stay constant
//  across light/dark (like the chart palette); neutral chrome elsewhere on the
//  surface uses design tokens so the light theme keeps working.
//

import SwiftUI

// MARK: - State palette (port of the web STATE_COLORS Tailwind values)

/// The per-state swatch the widget uses, mapping a `VehicleStateKind` to the
/// exact Tailwind hex the web `STATE_COLORS` table encodes.
enum StateTimelinePalette {
    /// driving → `cyan-400` (#22D3EE).
    static let driving = Color(.sRGB, red: 0.133, green: 0.827, blue: 0.933, opacity: 1)
    /// charging → `green-500` (#22C55E).
    static let charging = Color(.sRGB, red: 0.133, green: 0.773, blue: 0.369, opacity: 1)
    /// asleep → `purple-500` (#A855F7).
    static let asleep = Color(.sRGB, red: 0.659, green: 0.333, blue: 0.969, opacity: 1)
    /// idle → `amber-500` (#F59E0B).
    static let idle = Color(.sRGB, red: 0.961, green: 0.620, blue: 0.043, opacity: 1)
    /// offline → `red-500` (#EF4444).
    static let offline = Color(.sRGB, red: 0.937, green: 0.267, blue: 0.267, opacity: 1)
    /// unknown → `gray-500` (#6B7280), the web `?? '#6b7280'` fallback branch.
    static let unknown = Color(.sRGB, red: 0.420, green: 0.447, blue: 0.502, opacity: 1)

    /// The swatch for a state kind (web `stateColor(state)`).
    static func color(for kind: VehicleStateKind) -> Color {
        switch kind {
        case .driving: driving
        case .charging: charging
        case .asleep: asleep
        case .idle: idle
        case .offline: offline
        case .unknown: unknown
        }
    }

    /// Convenience: resolve a raw API state string straight to its swatch
    /// (parse + map), matching the web `stateColor(state.toLowerCase())`.
    static func color(forRaw raw: String) -> Color {
        color(for: VehicleStateKind.from(raw: raw))
    }
}
