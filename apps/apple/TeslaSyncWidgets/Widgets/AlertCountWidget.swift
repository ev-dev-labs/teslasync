import SwiftUI
import WidgetKit

/// Alerts widget: count of open alerts (and how many are critical), with the most
/// recent title. Deep-links to the Notifications/Alerts route.
struct AlertCountWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKind.alerts, provider: TeslaSyncTimelineProvider()) { entry in
            AlertCountEntryView(entry: entry)
        }
        .configurationDisplayName(Text("widget.alerts.displayName"))
        .description(Text("widget.alerts.description"))
        .supportedFamilies(WidgetFamilies.glanceable)
    }
}

/// Severity tint for an alert load: red for critical, amber for open, green clear.
enum AlertStyle {
    static func tint(_ alerts: AlertSummary) -> Color {
        if alerts.criticalCount > 0 { return Color.TS.statusDanger }
        if alerts.openCount > 0 { return Color.TS.statusWarning }
        return Color.TS.statusSuccess
    }
}

struct AlertCountEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TeslaSyncWidgetEntry

    var body: some View {
        content
            .widgetURL(WidgetDeepLink.alerts.url)
            .widgetSurface(for: family)
    }

    @ViewBuilder private var content: some View {
        if let alerts = entry.snapshot.alerts, entry.freshness != .offline {
            loaded(alerts)
        } else {
            WidgetOfflineView()
        }
    }

    @ViewBuilder private func loaded(_ alerts: AlertSummary) -> some View {
        switch family {
        case .systemSmall:
            AlertSmallView(alerts: alerts)
        case .systemMedium:
            AlertMediumView(alerts: alerts, freshness: entry.freshness)
        default:
            accessory(alerts)
        }
    }

    @ViewBuilder private func accessory(_ alerts: AlertSummary) -> some View {
        #if os(iOS)
            switch family {
            case .accessoryCircular:
                AlertAccessoryCircular(alerts: alerts)
            case .accessoryInline:
                WidgetAccessoryInline(systemImage: "bell.fill", text: alertInlineText(alerts))
            case .accessoryRectangular:
                WidgetAccessoryRectangular(
                    titleKey: "widget.alerts.displayName",
                    systemImage: "bell.fill",
                    primary: alertInlineText(alerts),
                    secondary: alerts.latestTitle.map { Text(verbatim: $0) }
                )
            default:
                AlertSmallView(alerts: alerts)
            }
        #else
            AlertSmallView(alerts: alerts)
        #endif
    }

    private func alertInlineText(_ alerts: AlertSummary) -> Text {
        if alerts.openCount == 0 {
            return Text("widget.alerts.allClear")
        }
        return Text(verbatim: "\(alerts.openCount) ") + Text("widget.alerts.open")
    }
}

private struct AlertSmallView: View {
    let alerts: AlertSummary

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            WidgetSectionHeader(titleKey: "widget.alerts.displayName", systemImage: "bell.fill")
            Spacer(minLength: 0)
            if alerts.openCount == 0 {
                Label {
                    Text("widget.alerts.allClear")
                } icon: {
                    Image(systemName: "checkmark.circle.fill")
                }
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.statusSuccess)
            } else {
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                    Text(verbatim: "\(alerts.openCount)")
                        .font(Font.TS.display.monospacedDigit())
                        .foregroundStyle(AlertStyle.tint(alerts))
                    Text("widget.alerts.open")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
                if alerts.criticalCount > 0 {
                    AlertCriticalBadge(count: alerts.criticalCount)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

private struct AlertMediumView: View {
    let alerts: AlertSummary
    let freshness: WidgetFreshness

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: "\(alerts.openCount)")
                    .font(Font.TS.display.monospacedDigit())
                    .foregroundStyle(AlertStyle.tint(alerts))
                Text("widget.alerts.open")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                if alerts.criticalCount > 0 {
                    AlertCriticalBadge(count: alerts.criticalCount)
                }
            }
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                WidgetSectionHeader(titleKey: "widget.alerts.displayName", systemImage: "bell.fill")
                if let latest = alerts.latestTitle {
                    Text(verbatim: latest)
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(2)
                } else {
                    Text("widget.alerts.allClear")
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                Spacer(minLength: 0)
                WidgetFreshnessChip(freshness: freshness)
            }
        }
    }
}

private struct AlertCriticalBadge: View {
    let count: Int

    var body: some View {
        Label {
            Text(verbatim: "\(count) ") + Text("widget.alerts.critical")
        } icon: {
            Image(systemName: "exclamationmark.triangle.fill")
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.statusDanger)
    }
}

#if os(iOS)
    private struct AlertAccessoryCircular: View {
        let alerts: AlertSummary

        var body: some View {
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "bell.fill")
                        .font(.caption2)
                    Text(verbatim: "\(alerts.openCount)")
                        .font(.headline)
                        .minimumScaleFactor(0.5)
                }
            }
            .widgetAccentable()
        }
    }
#endif
