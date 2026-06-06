import SwiftUI

/// App theme seam.
///
/// P0 ships a minimal, system-driven theme so the shell honors light/dark and
/// Dynamic Type out of the box. P2 (design system) replaces these accessors
/// with the generated `apps/design/generated/apple/Tokens.swift` values — the
/// call sites (`Theme.accent`, `Theme.background`, `.teslaSyncTheme()`) stay
/// stable so no view code changes when tokens land.
enum Theme {
    /// Primary tint used for interactive + brand elements.
    static let accent: Color = .accentColor

    /// Adaptive window/background fill.
    static var background: Color {
        #if os(iOS)
            Color(uiColor: .systemBackground)
        #else
            Color(nsColor: .windowBackgroundColor)
        #endif
    }
}

private struct TeslaSyncThemeModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .tint(Theme.accent)
            // System fonts already scale with Dynamic Type; this keeps the
            // whole shell responsive to the user's preferred content size.
            .dynamicTypeSize(...DynamicTypeSize.accessibility5)
    }
}

extension View {
    /// Applies the TeslaSync theme (tint + Dynamic Type support).
    func teslaSyncTheme() -> some View {
        modifier(TeslaSyncThemeModifier())
    }
}
