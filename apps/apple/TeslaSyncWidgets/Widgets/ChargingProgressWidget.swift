import SwiftUI
import WidgetKit

/// Charging widget: live progress, power, energy added, and a self-updating time
/// remaining. Deep-links to the Charging route.
struct ChargingProgressWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKind.charging, provider: TeslaSyncTimelineProvider()) { entry in
            ChargingEntryView(entry: entry)
        }
        .configurationDisplayName(Text("widget.charging.displayName"))
        .description(Text("widget.charging.description"))
        .supportedFamilies(WidgetFamilies.systemAndAccessories)
    }
}

struct ChargingEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TeslaSyncWidgetEntry

    var body: some View {
        content
            .widgetURL(WidgetDeepLink.charging.url)
            .widgetSurface(for: family)
    }

    @ViewBuilder private var content: some View {
        if let charging = entry.snapshot.charging, entry.freshness != .offline {
            loaded(charging)
        } else {
            WidgetOfflineView()
        }
    }

    @ViewBuilder private func loaded(_ charging: ChargingSummary) -> some View {
        switch family {
        case .systemSmall:
            ChargingSmallView(charging: charging, now: entry.date)
        case .systemMedium:
            ChargingMediumView(charging: charging, now: entry.date, freshness: entry.freshness)
        case .systemLarge, .systemExtraLarge:
            ChargingLargeView(charging: charging, now: entry.date, freshness: entry.freshness)
        default:
            accessory(charging)
        }
    }

    @ViewBuilder private func accessory(_ charging: ChargingSummary) -> some View {
        #if os(iOS)
            switch family {
            case .accessoryCircular:
                WidgetAccessoryGauge(
                    fraction: charging.batteryFraction,
                    label: charging.batteryDisplay,
                    systemImage: "bolt.fill"
                )
            case .accessoryInline:
                WidgetAccessoryInline(systemImage: "bolt.fill", text: chargingInlineText(charging))
            case .accessoryRectangular:
                WidgetAccessoryRectangular(
                    titleKey: "widget.charging.displayName",
                    systemImage: "bolt.fill",
                    primary: Text(verbatim: charging.batteryDisplay),
                    secondary: chargingInlineText(charging)
                )
            default:
                ChargingSmallView(charging: charging, now: entry.date)
            }
        #else
            ChargingSmallView(charging: charging, now: entry.date)
        #endif
    }

    private func chargingInlineText(_ charging: ChargingSummary) -> Text {
        if charging.isActive, let finishBy = charging.finishBy, finishBy > entry.date {
            return Text(timerInterval: entry.date ... finishBy, countsDown: true)
        }
        return charging.isActive ? Text("widget.charging.complete") : Text("widget.charging.idle")
    }
}

/// Self-updating "time remaining" countdown, or a completion/idle label.
struct ChargingETALabel: View {
    let charging: ChargingSummary
    let now: Date

    var body: some View {
        if charging.isActive, let finishBy = charging.finishBy, finishBy > now {
            Text(timerInterval: now ... finishBy, countsDown: true)
                .monospacedDigit()
        } else if charging.isActive {
            Text("widget.charging.complete")
        } else {
            Text("widget.charging.idle")
        }
    }
}

private struct ChargingSmallView: View {
    let charging: ChargingSummary
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            WidgetSectionHeader(titleKey: "widget.charging.displayName", systemImage: "bolt.fill")
            HStack(spacing: TSSpacing.md) {
                WidgetBatteryRing(
                    fraction: charging.batteryFraction,
                    centerText: charging.batteryDisplay,
                    isCharging: charging.isActive,
                    lineWidth: 7
                )
                .frame(width: 54, height: 54)
                VStack(alignment: .leading, spacing: 2) {
                    Text("widget.charging.remaining")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                    ChargingETALabel(charging: charging, now: now)
                        .font(Font.TS.panel.monospacedDigit())
                        .foregroundStyle(Color.TS.textPrimary)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

private struct ChargingMediumView: View {
    let charging: ChargingSummary
    let now: Date
    let freshness: WidgetFreshness

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            WidgetBatteryRing(
                fraction: charging.batteryFraction,
                centerText: charging.batteryDisplay,
                isCharging: charging.isActive,
                lineWidth: 10
            )
            .frame(width: 76, height: 76)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                ChargingMetricsRow(charging: charging)
                HStack(spacing: TSSpacing.xs) {
                    Text("widget.charging.remaining")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                    ChargingETALabel(charging: charging, now: now)
                        .font(Font.TS.label.monospacedDigit())
                        .foregroundStyle(Color.TS.textPrimary)
                }
                Spacer(minLength: 0)
                WidgetFreshnessChip(freshness: freshness)
            }
        }
    }
}

private struct ChargingLargeView: View {
    let charging: ChargingSummary
    let now: Date
    let freshness: WidgetFreshness

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack {
                WidgetSectionHeader(titleKey: "widget.charging.displayName", systemImage: "bolt.fill")
                Spacer()
                WidgetFreshnessChip(freshness: freshness)
            }
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: charging.batteryDisplay)
                    .font(Font.TS.display.monospacedDigit())
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer()
                ChargingETALabel(charging: charging, now: now)
                    .font(Font.TS.section.monospacedDigit())
                    .foregroundStyle(charging.isActive ? Color.TS.statusSuccess : Color.TS.textSecondary)
            }
            WidgetLinearProgress(fraction: charging.batteryFraction, tint: .TS.statusSuccess)
            ChargingMetricsRow(charging: charging)
            Spacer(minLength: 0)
            WidgetUpdatedLabel(date: charging.sampledAt)
        }
    }
}

private struct ChargingMetricsRow: View {
    let charging: ChargingSummary

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            if let power = charging.powerDisplay {
                WidgetMetric(titleKey: "widget.charging.power", value: power)
            }
            if let added = charging.addedDisplay {
                WidgetMetric(titleKey: "widget.charging.added", value: added)
            }
        }
    }
}
