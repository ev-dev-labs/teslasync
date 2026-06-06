import SwiftUI
import WidgetKit

/// Energy widget: today's energy used, efficiency, optional cost, and the share
/// that came from charging. Deep-links to the Energy route.
struct EnergySnapshotWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKind.energy, provider: TeslaSyncTimelineProvider()) { entry in
            EnergyEntryView(entry: entry)
        }
        .configurationDisplayName(Text("widget.energy.displayName"))
        .description(Text("widget.energy.description"))
        .supportedFamilies(WidgetFamilies.system)
    }
}

struct EnergyEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TeslaSyncWidgetEntry

    var body: some View {
        content
            .widgetURL(WidgetDeepLink.energy.url)
            .widgetSurface(for: family)
    }

    @ViewBuilder private var content: some View {
        if let energy = entry.snapshot.energy, entry.freshness != .offline {
            loaded(energy)
        } else {
            WidgetOfflineView()
        }
    }

    @ViewBuilder private func loaded(_ energy: EnergySummary) -> some View {
        switch family {
        case .systemSmall:
            EnergySmallView(energy: energy)
        case .systemMedium:
            EnergyMediumView(energy: energy, freshness: entry.freshness)
        default:
            EnergyLargeView(energy: energy, freshness: entry.freshness)
        }
    }
}

private struct EnergyChargedBar: View {
    let fraction: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("widget.energy.charged")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            WidgetLinearProgress(fraction: fraction, tint: .TS.chartSeriesEnergy)
        }
    }
}

private struct EnergySmallView: View {
    let energy: EnergySummary

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            WidgetSectionHeader(titleKey: "widget.energy.displayName", systemImage: "bolt.batteryblock.fill")
            Spacer(minLength: 0)
            WidgetBigValue(value: energy.usedDisplay, captionKey: "widget.energy.used")
            Spacer(minLength: 0)
            EnergyChargedBar(fraction: energy.chargedFraction)
        }
    }
}

private struct EnergyMediumView: View {
    let energy: EnergySummary
    let freshness: WidgetFreshness

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack {
                WidgetSectionHeader(titleKey: "widget.energy.displayName", systemImage: "bolt.batteryblock.fill")
                Spacer()
                WidgetFreshnessChip(freshness: freshness)
            }
            EnergyMetricsRow(energy: energy)
            Spacer(minLength: 0)
            EnergyChargedBar(fraction: energy.chargedFraction)
        }
    }
}

private struct EnergyLargeView: View {
    let energy: EnergySummary
    let freshness: WidgetFreshness

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack {
                WidgetSectionHeader(titleKey: "widget.energy.displayName", systemImage: "bolt.batteryblock.fill")
                Spacer()
                WidgetFreshnessChip(freshness: freshness)
            }
            WidgetBigValue(value: energy.usedDisplay, captionKey: "widget.energy.used")
            EnergyMetricsRow(energy: energy)
            EnergyChargedBar(fraction: energy.chargedFraction)
            Spacer(minLength: 0)
            WidgetUpdatedLabel(date: energy.sampledAt)
        }
    }
}

private struct EnergyMetricsRow: View {
    let energy: EnergySummary

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            WidgetMetric(titleKey: "widget.energy.efficiency", value: energy.efficiencyDisplay)
            if let cost = energy.costDisplay {
                WidgetMetric(titleKey: "widget.energy.cost", value: cost)
            }
        }
    }
}
