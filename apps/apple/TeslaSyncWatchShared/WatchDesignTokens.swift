import SwiftUI

// watchOS-safe design tokens.
//
// The generated `apps/design/generated/apple/Tokens.swift` builds its adaptive
// palette with `UIColor(dynamicProvider:)` + `UITraitCollection.userInterfaceStyle`
// / `.accessibilityContrast`, which are unavailable on watchOS. watchOS renders in a
// single (dark) context, so this shim exposes the same `Color.TS` / `Font.TS` /
// `TSSpacing` / `TSRadius` surface using the canonical **dark** token values copied
// verbatim from that generated file. Only the watch app + complication targets
// compile this file (they do not link DesignTokens), so there is no symbol clash
// with the generated tokens on iOS/macOS.

extension Color {
    enum TS {
        static let bg = Color(.sRGB, red: 0.039, green: 0.039, blue: 0.059, opacity: 1)
        static let surface = Color(.sRGB, red: 0.059, green: 0.063, blue: 0.098, opacity: 1)
        static let surfaceGlass = Color(.sRGB, red: 1, green: 1, blue: 1, opacity: 0.04)
        static let textPrimary = Color(.sRGB, red: 1, green: 1, blue: 1, opacity: 1)
        static let textSecondary = Color(.sRGB, red: 0.612, green: 0.639, blue: 0.686, opacity: 1)
        static let textMuted = Color(.sRGB, red: 0.541, green: 0.584, blue: 0.651, opacity: 1)
        static let accent = Color(.sRGB, red: 0, green: 0.941, blue: 1, opacity: 1)
        static let border = Color(.sRGB, red: 1, green: 1, blue: 1, opacity: 0.12)
        static let statusSuccess = Color(.sRGB, red: 0.063, green: 0.725, blue: 0.506, opacity: 1)
        static let statusWarning = Color(.sRGB, red: 0.961, green: 0.620, blue: 0.043, opacity: 1)
        static let statusDanger = Color(.sRGB, red: 0.937, green: 0.267, blue: 0.267, opacity: 1)
        static let statusInfo = Color(.sRGB, red: 0, green: 0.941, blue: 1, opacity: 1)
    }
}

extension Font {
    enum TS {
        static let display = Font.system(size: 30, weight: .bold)
        static let title = Font.system(size: 24, weight: .bold)
        static let section = Font.system(size: 18, weight: .semibold)
        static let panel = Font.system(size: 16, weight: .semibold)
        static let body = Font.system(size: 14, weight: .regular)
        static let bodySm = Font.system(size: 12, weight: .regular)
        static let caption = Font.system(size: 12, weight: .regular)
        static let label = Font.system(size: 12, weight: .medium)
    }
}

enum TSSpacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 20
}

enum TSRadius {
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
}
