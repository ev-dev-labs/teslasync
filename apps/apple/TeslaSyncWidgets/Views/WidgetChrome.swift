import SwiftUI
import WidgetKit

/// SwiftUI presentation helpers for `WidgetFreshness` (the model stays SwiftUI-free).
extension WidgetFreshness {
    /// Status color from the generated design tokens.
    var tint: Color {
        switch self {
        case .fresh: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    /// Localized one-word status for the freshness chip.
    var labelKey: LocalizedStringKey {
        switch self {
        case .fresh: "widget.freshness.live"
        case .stale: "widget.freshness.stale"
        case .offline: "widget.freshness.offline"
        }
    }

    /// SF Symbol describing the status (also used for the accessory glyph).
    var symbolName: String {
        switch self {
        case .fresh: "dot.radiowaves.left.and.right"
        case .stale: "clock.badge.exclamationmark"
        case .offline: "wifi.slash"
        }
    }
}

extension WidgetFamily {
    /// Whether this is a Lock Screen / accessory family (iOS only).
    var isAccessoryFamily: Bool {
        #if os(iOS)
            switch self {
            case .accessoryCircular, .accessoryRectangular, .accessoryInline: true
            default: false
            }
        #else
            false
        #endif
    }
}

/// The subtle token gradient behind system-family widgets.
struct WidgetSurfaceGradient: View {
    var body: some View {
        LinearGradient(
            colors: [Color.TS.surface, Color.TS.bg],
            startPoint: .top,
            endPoint: .bottom
        )
    }
}

extension View {
    /// Applies the correct `containerBackground` for the given family: a token
    /// gradient for system widgets, transparent for Lock Screen accessories.
    @ViewBuilder
    func widgetSurface(for family: WidgetFamily) -> some View {
        if family.isAccessoryFamily {
            containerBackground(for: .widget) { Color.clear }
        } else {
            containerBackground(for: .widget) { WidgetSurfaceGradient() }
        }
    }
}

/// A small "Live / Stale / Offline" chip with a colored dot. Honest freshness per
/// ADR-013 — last-known data is shown and flagged, never hidden.
struct WidgetFreshnessChip: View {
    let freshness: WidgetFreshness

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(freshness.tint)
                .frame(width: 6, height: 6)
            Text(freshness.labelKey)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("widget.freshness.accessibility"))
        .accessibilityValue(Text(freshness.labelKey))
    }
}

/// "Updated 3 min ago" using a self-updating relative timestamp (no extra timeline
/// reloads needed). Falls back to an em dash when there is no sample time.
struct WidgetUpdatedLabel: View {
    let date: Date?

    var body: some View {
        Group {
            if let date {
                Text("widget.freshness.updated") + Text(verbatim: " ") + Text(date, style: .relative)
            } else {
                Text("widget.freshness.updated") + Text(verbatim: " —")
            }
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textMuted)
    }
}

/// Section header: an SF Symbol plus a localized title.
struct WidgetSectionHeader: View {
    let titleKey: LocalizedStringKey
    let systemImage: String

    var body: some View {
        Label {
            Text(titleKey)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
        } icon: {
            Image(systemName: systemImage)
                .foregroundStyle(Color.TS.accent)
        }
        .labelStyle(.titleAndIcon)
    }
}

/// Honest empty/offline state — shown (never a blank panel) when a summary is
/// missing or the cache is offline.
struct WidgetUnavailableView: View {
    var titleKey: LocalizedStringKey = "widget.unavailable.title"
    var messageKey: LocalizedStringKey = "widget.unavailable.message"
    var systemImage = "antenna.radiowaves.left.and.right.slash"

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage)
                .font(.title3)
                .foregroundStyle(Color.TS.textMuted)
            Text(titleKey)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            Text(messageKey)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}
