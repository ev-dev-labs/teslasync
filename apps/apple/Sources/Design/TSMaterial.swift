import SwiftUI

/// Apple-native material mapping for TeslaSync surfaces.
///
/// Maps the web glass / elevation tokens to system materials (`.regularMaterial`,
/// `.thinMaterial`, `.bar`) so panels get HIG vibrancy on both idioms with no
/// hand-rolled blur. The semantic tint/border come from the generated tokens.
public enum TSMaterial {
    /// Primary elevated panel surface (the web `GlassPanel` equivalent).
    public static let panel: Material = .regularMaterial
    /// Lighter overlay surface (popovers, inline chips).
    public static let overlay: Material = .thinMaterial
    /// Chrome / toolbar backing.
    public static let chrome: Material = .bar
}

public extension View {
    /// Applies the TeslaSync glass panel: a system material clipped to the panel
    /// radius with the semantic glass-border stroke.
    func tsGlassPanel(cornerRadius: CGFloat = TSRadius.lg) -> some View {
        background(TSMaterial.panel, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}
