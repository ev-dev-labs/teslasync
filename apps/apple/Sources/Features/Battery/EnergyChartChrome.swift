import SwiftUI

// Shared chart chrome for the Energy charts: a visible series legend (the `TSComposedChart` /
// `TSAreaChart` / `TSBarChart` wrappers hide their own) plus the axis captions that surface
// the web date / time-of-day X-axis labels (the wrappers plot a numeric x). Mirrors the
// sibling `BatteryChartLegend` / `BatteryAxisCaption` chrome.

/// One legend entry: a localized series name and its swatch color.
struct EnergyLegendItem: Identifiable {
    let id: String
    let name: LocalizedStringKey
    let color: Color
}

/// A horizontal series legend surfacing each web series name.
struct EnergyChartLegend: View {
    let items: [EnergyLegendItem]

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(items) { item in
                HStack(spacing: TSSpacing.xs) {
                    Circle().fill(item.color).frame(width: 8, height: 8)
                    Text(item.name).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// First/last date caption beneath a daily chart (the wrapper uses a numeric x-axis, so the
/// date span is surfaced here, mirroring the web X-axis ticks).
struct EnergyDateAxis: View {
    let labels: [String]

    var body: some View {
        if let first = labels.first, let last = labels.last {
            HStack {
                Text(verbatim: EnergyFormat.dateShort(first))
                Spacer()
                Text(verbatim: EnergyFormat.dateShort(last))
            }
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityHidden(true)
        }
    }
}

/// The four time-of-day bucket labels spread beneath the bar chart (mirroring the web
/// categorical X-axis).
struct EnergyBucketAxis: View {
    let labels: [String]

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(Array(labels.enumerated()), id: \.offset) { _, label in
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(maxWidth: .infinity)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .accessibilityHidden(true)
    }
}
