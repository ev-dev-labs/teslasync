import SwiftUI

/// App theme seam, backed by the generated design tokens
/// (`apps/design/generated/apple/Tokens.swift`, P2). Call sites use these stable
/// accessors; the values resolve light / dark / high-contrast at runtime via the
/// generated `Color.TS` palette.
enum Theme {
    /// Primary tint used for interactive + brand elements.
    static let accent: Color = .TS.accent

    /// Adaptive window/background fill.
    static let background: Color = .TS.bg

    /// Elevated surface fill (cards, panels).
    static let surface: Color = .TS.surface
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
