//
//  VehiclePaintPicker.Color.swift
//  TeslaSync — P4 shared surface · 0234 · VehiclePaintPicker (Apple)
//
//  The SwiftUI colour bridge between the catalog's opaque `#RRGGBB` swatch hex and `Color` — the
//  view-layer peer of the web reading `p.swatch` straight into `style={{ background }}`.
//  `Color(vehiclePaintHex:)` fills the swatch dots; on malformed input it falls back to a neutral muted
//  token so a swatch never renders as an unexpected accent-tinted box. This is the one spot the surface
//  bridges a hex string to the platform colour type, kept behind a single seam.
//

import SwiftUI

extension Color {
    /// Builds a `Color` from an opaque `#RRGGBB` (or bare `RRGGBB`) hex string; falls back to the muted
    /// text token for malformed input so a swatch never renders as an unexpected colour.
    init(vehiclePaintHex hex: String) {
        var trimmed = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("#") { trimmed.removeFirst() }
        guard trimmed.count == 6, let value = UInt32(trimmed, radix: 16) else {
            self = Color.TS.textMuted
            return
        }
        self = Color(
            .sRGB,
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255,
            opacity: 1
        )
    }
}
