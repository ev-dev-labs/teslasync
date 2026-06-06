import SwiftUI
import WidgetKit

/// System health widget: TeslaSync service status at a glance. Deep-links to the
/// System route.
struct SystemHealthWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKind.systemHealth, provider: TeslaSyncTimelineProvider()) { entry in
            SystemHealthEntryView(entry: entry)
        }
        .configurationDisplayName(Text("widget.system.displayName"))
        .description(Text("widget.system.description"))
        .supportedFamilies(WidgetFamilies.glanceable)
    }
}

extension SystemHealthSummary.Level {
    var tint: Color {
        switch self {
        case .operational: Color.TS.statusSuccess
        case .degraded: Color.TS.statusWarning
        case .down: Color.TS.statusDanger
        }
    }

    var symbolName: String {
        switch self {
        case .operational: "checkmark.circle.fill"
        case .degraded: "exclamationmark.triangle.fill"
        case .down: "xmark.octagon.fill"
        }
    }

    var titleKey: LocalizedStringKey {
        switch self {
        case .operational: "widget.system.operational"
        case .degraded: "widget.system.degraded"
        case .down: "widget.system.down"
        }
    }
}

extension SystemHealthSummary {
    /// Healthy fraction for a gauge, guarded against a zero total.
    var healthyFraction: Double {
        guard totalServices > 0 else { return 0 }
        return Double(healthyServices) / Double(totalServices)
    }

    /// `"8/8"` services display.
    var servicesDisplay: String {
        "\(healthyServices)/\(totalServices)"
    }
}

struct SystemHealthEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TeslaSyncWidgetEntry

    var body: some View {
        content
            .widgetURL(WidgetDeepLink.systemHealth.url)
            .widgetSurface(for: family)
    }

    @ViewBuilder private var content: some View {
        if let health = entry.snapshot.systemHealth, entry.freshness != .offline {
            loaded(health)
        } else {
            WidgetOfflineView()
        }
    }

    @ViewBuilder private func loaded(_ health: SystemHealthSummary) -> some View {
        switch family {
        case .systemSmall:
            SystemHealthSmallView(health: health)
        case .systemMedium:
            SystemHealthMediumView(health: health, freshness: entry.freshness)
        default:
            accessory(health)
        }
    }

    @ViewBuilder private func accessory(_ health: SystemHealthSummary) -> some View {
        #if os(iOS)
            switch family {
            case .accessoryCircular:
                WidgetAccessoryGauge(
                    fraction: health.healthyFraction,
                    label: health.servicesDisplay,
                    systemImage: health.level.symbolName
                )
            case .accessoryInline:
                WidgetAccessoryInline(
                    systemImage: health.level.symbolName,
                    text: Text(verbatim: health.servicesDisplay)
                )
            case .accessoryRectangular:
                WidgetAccessoryRectangular(
                    titleKey: "widget.system.displayName",
                    systemImage: health.level.symbolName,
                    primary: Text(health.level.titleKey),
                    secondary: Text(verbatim: health.servicesDisplay)
                )
            default:
                SystemHealthSmallView(health: health)
            }
        #else
            SystemHealthSmallView(health: health)
        #endif
    }
}

private struct SystemHealthSmallView: View {
    let health: SystemHealthSummary

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            WidgetSectionHeader(titleKey: "widget.system.displayName", systemImage: "server.rack")
            Spacer(minLength: 0)
            Image(systemName: health.level.symbolName)
                .font(.title)
                .foregroundStyle(health.level.tint)
            Text(health.level.titleKey)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(2)
            Spacer(minLength: 0)
            WidgetMetric(titleKey: "widget.system.services", value: health.servicesDisplay)
        }
    }
}

private struct SystemHealthMediumView: View {
    let health: SystemHealthSummary
    let freshness: WidgetFreshness

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            Image(systemName: health.level.symbolName)
                .font(.system(size: 44))
                .foregroundStyle(health.level.tint)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                WidgetSectionHeader(titleKey: "widget.system.displayName", systemImage: "server.rack")
                Text(health.level.titleKey)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                WidgetMetric(titleKey: "widget.system.services", value: health.servicesDisplay)
                Spacer(minLength: 0)
                WidgetFreshnessChip(freshness: freshness)
            }
        }
    }
}
