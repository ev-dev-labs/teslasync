//
//  ThemePicker.Color.swift
//  TeslaSync — P4 shared surface · 0228 · ThemePicker (Apple)
//
//  The SwiftUI colour bridge between the catalog's hex strings and `Color` — the view-layer peer of the
//  web reading `#RRGGBB` straight into CSS. `Color(themePickerHex:)` renders the theme gradients, the
//  mode preview swatches, and the mode icon-box chrome (it accepts the 6-digit theme colours and the
//  8-digit `#RRGGBBAA` glass borders, falling back to the brand accent token on malformed input).
//  `ThemePickerColorBridge.hexString(from:)` is the reverse used by the custom-colour wells: it resolves
//  a picked `Color` back to a `#RRGGBB` string to write through the store (the native peer of the web
//  `<input type="color">` `value`). The reverse is the one spot that must touch the platform colour
//  type, kept here behind a single seam.
//

import SwiftUI

#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

extension Color {
    /// Builds a `Color` from a `#RRGGBB` or `#RRGGBBAA` hex string; falls back to the brand accent token
    /// for malformed input so a swatch never renders as an unexpected black box.
    init(themePickerHex hex: String) {
        var trimmed = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("#") { trimmed.removeFirst() }
        if trimmed.count == 6, let value = UInt32(trimmed, radix: 16) {
            self = Color(
                .sRGB,
                red: Double((value >> 16) & 0xFF) / 255,
                green: Double((value >> 8) & 0xFF) / 255,
                blue: Double(value & 0xFF) / 255,
                opacity: 1
            )
        } else if trimmed.count == 8, let value = UInt32(trimmed, radix: 16) {
            self = Color(
                .sRGB,
                red: Double((value >> 24) & 0xFF) / 255,
                green: Double((value >> 16) & 0xFF) / 255,
                blue: Double((value >> 8) & 0xFF) / 255,
                opacity: Double(value & 0xFF) / 255
            )
        } else {
            self = Color.TS.accent
        }
    }
}

/// Resolves a picked `Color` back to a `#RRGGBB` string — the reverse of `Color(themePickerHex:)`, used
/// by the custom-colour wells to persist an edit through the store. The single place the surface touches
/// `UIColor` / `NSColor`, behind a platform `#if`.
enum ThemePickerColorBridge {
    /// The uppercase `#RRGGBB` form of a `Color`, or the default custom Primary on failure.
    static func hexString(from color: Color) -> String {
        #if canImport(UIKit)
            var red: CGFloat = 0
            var green: CGFloat = 0
            var blue: CGFloat = 0
            var alpha: CGFloat = 0
            guard UIColor(color).getRed(&red, green: &green, blue: &blue, alpha: &alpha) else {
                return ThemePickerCatalog.defaultCustomPrimaryHex
            }
            return format(red, green, blue)
        #elseif canImport(AppKit)
            guard let resolved = NSColor(color).usingColorSpace(.sRGB) else {
                return ThemePickerCatalog.defaultCustomPrimaryHex
            }
            return format(resolved.redComponent, resolved.greenComponent, resolved.blueComponent)
        #else
            return ThemePickerCatalog.defaultCustomPrimaryHex
        #endif
    }

    #if canImport(UIKit) || canImport(AppKit)
        private static func format(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat) -> String {
            String(format: "#%02X%02X%02X", channel(red), channel(green), channel(blue))
        }

        private static func channel(_ value: CGFloat) -> Int {
            min(255, max(0, Int((value * 255).rounded())))
        }
    #endif
}
