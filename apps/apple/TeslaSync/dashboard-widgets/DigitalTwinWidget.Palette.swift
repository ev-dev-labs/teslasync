//
//  DigitalTwinWidget.Palette.swift
//  TeslaSync — P4 dashboard widget · 0036 · DigitalTwinWidget (Apple)
//
//  Semantic twin palette — a port of the web VehicleTwin C state-indicator constants.
//

import SwiftUI

// MARK: - Semantic twin palette (port of the web `C` state-indicator constants)

/// State-indicator colors that stay consistent across paints. Mirrors the web
/// `VehicleTwin` `C` map so doors/windows/lights read identically on both apps.
enum TwinPalette {
    static let amber = Color(red: 0.984, green: 0.749, blue: 0.141)
    static let amberSoft = Color(red: 0.961, green: 0.620, blue: 0.043)
    static let chargeGreen = Color(red: 0.133, green: 0.773, blue: 0.369)
    static let lockedGreen = Color(red: 0.133, green: 0.773, blue: 0.369)
    static let unlockedRed = Color(red: 0.937, green: 0.267, blue: 0.267)
    static let sentryRed = Color(red: 0.937, green: 0.267, blue: 0.267)
    static let taillight = Color(red: 0.937, green: 0.267, blue: 0.267)
    static let headlightOn = Color(red: 1.0, green: 1.0, blue: 0.86)
    static let seatCyan = Color(red: 0.133, green: 0.827, blue: 0.933)
    static let glassStroke = Color(red: 0.49, green: 0.827, blue: 0.988)
    static let glassClosed = Color(red: 0.12, green: 0.18, blue: 0.28)
    static let glassOpen = Color(red: 0.012, green: 0.027, blue: 0.071)
    static let chrome = Color(red: 0.78, green: 0.83, blue: 0.90)

    static func windowFill(_ state: DigitalTwinWidgetTwinWindowState?) -> Color {
        switch state {
        case .closed: glassClosed.opacity(0.65)
        case .open: glassOpen.opacity(0.78)
        case .partial: Color(red: 0.39, green: 0.78, blue: 1.0).opacity(0.10)
        case nil: Color.white.opacity(0.05)
        }
    }

    static func windowStroke(_ state: DigitalTwinWidgetTwinWindowState?) -> Color {
        switch state {
        case .open: amber
        case .partial: amberSoft.opacity(0.6)
        case .closed: glassStroke.opacity(0.5)
        case nil: Color.white.opacity(0.10)
        }
    }

    /// Resolves a Tesla exterior-color code/name to a base body paint.
    static func paint(for exteriorColor: String?) -> Color {
        let key = (exteriorColor ?? "").lowercased()
        if key.contains("white") || key.contains("pearl") { return Color(red: 0.86, green: 0.87, blue: 0.89) }
        if key.contains("black") || key.contains("obsidian") || key.contains("solidblack") {
            return Color(red: 0.10, green: 0.11, blue: 0.13)
        }
        if key.contains("red") { return Color(red: 0.62, green: 0.10, blue: 0.13) }
        if key.contains("blue") { return Color(red: 0.13, green: 0.26, blue: 0.44) }
        if key.contains("silver") || key.contains("gray") || key.contains("grey") {
            return Color(red: 0.55, green: 0.58, blue: 0.62)
        }
        // Tesla Midnight Silver Metallic fallback.
        return Color(red: 0.16, green: 0.20, blue: 0.27)
    }
}
