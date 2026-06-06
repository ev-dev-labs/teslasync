// AUTO-GENERATED from apps/design/tokens.json by apps/design/generators.
// DO NOT EDIT BY HAND. Run apps/design/generators/gen-themes.ps1 to regenerate.
// Drift is enforced by the --check gate (gen-themes.ps1 -Check).

// swiftformat:disable all
// swiftlint:disable all

import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

private typealias TSColorComponents = (red: Double, green: Double, blue: Double, alpha: Double)

private func tsDynamicColor(
    light: TSColorComponents,
    dark: TSColorComponents,
    highContrast: TSColorComponents
) -> Color {
    #if canImport(UIKit)
    return Color(UIColor { traits in
        let resolved: TSColorComponents
        if traits.accessibilityContrast == .high {
            resolved = highContrast
        } else {
            resolved = traits.userInterfaceStyle == .dark ? dark : light
        }
        return UIColor(red: resolved.red, green: resolved.green, blue: resolved.blue, alpha: resolved.alpha)
    })
    #elseif canImport(AppKit)
    return Color(nsColor: NSColor(name: nil) { appearance in
        let highContrastNames: Set<NSAppearance.Name> = [
            .accessibilityHighContrastAqua, .accessibilityHighContrastDarkAqua,
            .accessibilityHighContrastVibrantLight, .accessibilityHighContrastVibrantDark,
        ]
        let darkNames: Set<NSAppearance.Name> = [
            .darkAqua, .vibrantDark,
            .accessibilityHighContrastDarkAqua, .accessibilityHighContrastVibrantDark,
        ]
        let resolved: TSColorComponents
        if highContrastNames.contains(appearance.name) {
            resolved = highContrast
        } else if darkNames.contains(appearance.name) {
            resolved = dark
        } else {
            resolved = light
        }
        return NSColor(srgbRed: resolved.red, green: resolved.green, blue: resolved.blue, alpha: resolved.alpha)
    })
    #else
    return Color(.sRGB, red: light.red, green: light.green, blue: light.blue, opacity: light.alpha)
    #endif
}

public extension Color {
    enum TS {
        static let bg = tsDynamicColor(
            light: (red: 0.973, green: 0.980, blue: 0.988, alpha: 1.000),
            dark: (red: 0.039, green: 0.039, blue: 0.059, alpha: 1.000),
            highContrast: (red: 1.000, green: 1.000, blue: 1.000, alpha: 1.000)
        )
        static let surface = tsDynamicColor(
            light: (red: 1.000, green: 1.000, blue: 1.000, alpha: 1.000),
            dark: (red: 0.059, green: 0.063, blue: 0.098, alpha: 1.000),
            highContrast: (red: 1.000, green: 1.000, blue: 1.000, alpha: 1.000)
        )
        static let surfaceGlass = tsDynamicColor(
            light: (red: 1.000, green: 1.000, blue: 1.000, alpha: 0.950),
            dark: (red: 1.000, green: 1.000, blue: 1.000, alpha: 0.040),
            highContrast: (red: 1.000, green: 1.000, blue: 1.000, alpha: 1.000)
        )
        static let textPrimary = tsDynamicColor(
            light: (red: 0.059, green: 0.090, blue: 0.165, alpha: 1.000),
            dark: (red: 1.000, green: 1.000, blue: 1.000, alpha: 1.000),
            highContrast: (red: 0.000, green: 0.000, blue: 0.000, alpha: 1.000)
        )
        static let textSecondary = tsDynamicColor(
            light: (red: 0.118, green: 0.161, blue: 0.231, alpha: 1.000),
            dark: (red: 0.612, green: 0.639, blue: 0.686, alpha: 1.000),
            highContrast: (red: 0.133, green: 0.133, blue: 0.133, alpha: 1.000)
        )
        static let textMuted = tsDynamicColor(
            light: (red: 0.392, green: 0.455, blue: 0.545, alpha: 1.000),
            dark: (red: 0.541, green: 0.584, blue: 0.651, alpha: 1.000),
            highContrast: (red: 0.333, green: 0.333, blue: 0.333, alpha: 1.000)
        )
        static let accent = tsDynamicColor(
            light: (red: 0.031, green: 0.569, blue: 0.698, alpha: 1.000),
            dark: (red: 0.000, green: 0.941, blue: 1.000, alpha: 1.000),
            highContrast: (red: 0.055, green: 0.455, blue: 0.565, alpha: 1.000)
        )
        static let border = tsDynamicColor(
            light: (red: 0.000, green: 0.000, blue: 0.000, alpha: 0.120),
            dark: (red: 1.000, green: 1.000, blue: 1.000, alpha: 0.120),
            highContrast: (red: 0.800, green: 0.800, blue: 0.800, alpha: 1.000)
        )
        static let statusSuccess = tsDynamicColor(
            light: (red: 0.082, green: 0.502, blue: 0.239, alpha: 1.000),
            dark: (red: 0.063, green: 0.725, blue: 0.506, alpha: 1.000),
            highContrast: (red: 0.082, green: 0.502, blue: 0.239, alpha: 1.000)
        )
        static let statusWarning = tsDynamicColor(
            light: (red: 0.706, green: 0.325, blue: 0.035, alpha: 1.000),
            dark: (red: 0.961, green: 0.620, blue: 0.043, alpha: 1.000),
            highContrast: (red: 0.706, green: 0.325, blue: 0.035, alpha: 1.000)
        )
        static let statusDanger = tsDynamicColor(
            light: (red: 0.863, green: 0.149, blue: 0.149, alpha: 1.000),
            dark: (red: 0.937, green: 0.267, blue: 0.267, alpha: 1.000),
            highContrast: (red: 0.725, green: 0.110, blue: 0.110, alpha: 1.000)
        )
        static let statusInfo = tsDynamicColor(
            light: (red: 0.031, green: 0.569, blue: 0.698, alpha: 1.000),
            dark: (red: 0.000, green: 0.941, blue: 1.000, alpha: 1.000),
            highContrast: (red: 0.012, green: 0.412, blue: 0.631, alpha: 1.000)
        )

        // Brand chart palette (index-stable across platforms).
        static let chartCategorical: [Color] = [
            Color(.sRGB, red: 0.000, green: 0.447, blue: 0.698, opacity: 1.000),
            Color(.sRGB, red: 0.902, green: 0.624, blue: 0.000, opacity: 1.000),
            Color(.sRGB, red: 0.000, green: 0.620, blue: 0.451, opacity: 1.000),
            Color(.sRGB, red: 0.941, green: 0.894, blue: 0.259, opacity: 1.000),
            Color(.sRGB, red: 0.337, green: 0.706, blue: 0.914, opacity: 1.000),
            Color(.sRGB, red: 0.835, green: 0.369, blue: 0.000, opacity: 1.000),
            Color(.sRGB, red: 0.800, green: 0.475, blue: 0.655, opacity: 1.000),
            Color(.sRGB, red: 0.294, green: 0.294, blue: 0.294, opacity: 1.000),
        ]
        static let chartSeriesBattery = Color(.sRGB, red: 0.063, green: 0.725, blue: 0.506, opacity: 1.000)
        static let chartSeriesEnergy = Color(.sRGB, red: 0.961, green: 0.620, blue: 0.043, opacity: 1.000)
        static let chartSeriesSpeed = Color(.sRGB, red: 0.231, green: 0.510, blue: 0.965, opacity: 1.000)
        static let chartSeriesRegen = Color(.sRGB, red: 0.024, green: 0.714, blue: 0.831, opacity: 1.000)
        static let chartSeriesTemperature = Color(.sRGB, red: 0.937, green: 0.267, blue: 0.267, opacity: 1.000)
        static let chartSeriesPower = Color(.sRGB, red: 0.659, green: 0.333, blue: 0.969, opacity: 1.000)
    }
}

public extension Font {
    enum TS {
        static let display = Font.system(size: 30, weight: .bold)
        static let title = Font.system(size: 24, weight: .bold)
        static let section = Font.system(size: 18, weight: .semibold)
        static let panel = Font.system(size: 16, weight: .semibold)
        static let body = Font.system(size: 14, weight: .regular)
        static let bodySm = Font.system(size: 12, weight: .regular)
        static let caption = Font.system(size: 12, weight: .regular)
        static let label = Font.system(size: 12, weight: .medium)

        static let fontFamilySans = "Inter"
        static let fontFamilyMono = "JetBrains Mono"
    }
}

public enum TSTypeMetrics {
    public static let displayLineHeight: CGFloat = 36
    public static let displayTracking: CGFloat = -0.50
    public static let titleLineHeight: CGFloat = 32
    public static let titleTracking: CGFloat = -0.25
    public static let sectionLineHeight: CGFloat = 28
    public static let sectionTracking: CGFloat = -0.15
    public static let panelLineHeight: CGFloat = 24
    public static let panelTracking: CGFloat = 0.00
    public static let bodyLineHeight: CGFloat = 20
    public static let bodyTracking: CGFloat = 0.00
    public static let bodySmLineHeight: CGFloat = 16
    public static let bodySmTracking: CGFloat = 0.00
    public static let captionLineHeight: CGFloat = 16
    public static let captionTracking: CGFloat = 0.00
    public static let labelLineHeight: CGFloat = 16
    public static let labelTracking: CGFloat = 0.60
}

public enum TSSpacing {
    public static let none: CGFloat = 0
    public static let xs: CGFloat = 4
    public static let sm: CGFloat = 8
    public static let md: CGFloat = 12
    public static let lg: CGFloat = 16
    public static let xl: CGFloat = 20
    public static let x2xl: CGFloat = 24
    public static let x3xl: CGFloat = 32
    public static let x4xl: CGFloat = 48
}

public enum TSRadius {
    public static let sm: CGFloat = 8
    public static let md: CGFloat = 12
    public static let lg: CGFloat = 16
    public static let pill: CGFloat = 9999
}

public enum TSMotion {
    public static let fastDuration: TimeInterval = 0.150
    public static let normalDuration: TimeInterval = 0.250
    public static let slowDuration: TimeInterval = 0.400
    public static let standardEasing = "cubic-bezier(0.2, 0, 0, 1)"
    public static let accelerateEasing = "cubic-bezier(0.3, 0, 1, 1)"
    public static let decelerateEasing = "cubic-bezier(0, 0, 0, 1)"
}
