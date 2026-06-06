import SwiftUI

/// Brand chart palette accessor (index-stable across platforms). Wraps the
/// generated `Color.TS.chartCategorical` so chart code never indexes the raw
/// array directly.
public enum TSChartPalette {
    /// The ordered categorical series colors from the design tokens.
    public static var categorical: [Color] {
        Color.TS.chartCategorical
    }

    /// The palette color for a series index, wrapping (and handling negatives).
    public static func color(at index: Int) -> Color {
        let palette = categorical
        guard !palette.isEmpty else { return Color.TS.accent }
        let wrapped = ((index % palette.count) + palette.count) % palette.count
        return palette[wrapped]
    }
}

/// Motion tokens projected as SwiftUI animations, honoring Reduce Motion.
///
/// Returns `nil` when Reduce Motion is on so call sites can pass it straight to
/// `withAnimation(_:)` / `.animation(_:value:)` and get an instant transition.
public enum TSAnimation {
    public static func fast(reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .easeInOut(duration: TSMotion.fastDuration)
    }

    public static func standard(reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration)
    }

    public static func slow(reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration)
    }
}
