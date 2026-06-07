import SwiftUI

/// Small display helpers for the watch surface. Kept tiny and pure so the views
/// stay declarative and the colour/threshold logic is exercised by tests.
enum WatchFormat {
    /// Battery ring colour: green above 40%, amber 20–40%, red below — matching the
    /// web watch face thresholds.
    static func batteryColor(_ fraction: Double) -> Color {
        if fraction > 0.4 { return Color.TS.statusSuccess }
        if fraction > 0.2 { return Color.TS.statusWarning }
        return Color.TS.statusDanger
    }
}

extension WidgetFreshness {
    /// Localization key for the freshness label.
    var labelKey: LocalizedStringKey {
        switch self {
        case .fresh: "watch.freshness.fresh"
        case .stale: "watch.freshness.stale"
        case .offline: "watch.freshness.offline"
        }
    }

    /// Tint used by the freshness chip and dot.
    var tint: Color {
        switch self {
        case .fresh: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    var systemImage: String {
        switch self {
        case .fresh: "dot.radiowaves.left.and.right"
        case .stale: "clock.badge.exclamationmark"
        case .offline: "wifi.slash"
        }
    }
}
