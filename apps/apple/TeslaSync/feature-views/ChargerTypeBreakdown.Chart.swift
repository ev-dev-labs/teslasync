//
//  ChargerTypeBreakdown.Chart.swift
//  TeslaSync — P4 feature view · 0108 · ChargerTypeBreakdown (Apple)
//
//  The cost-by-charger-type donut — the Swift Charts parity of the web Recharts
//  `PieChart` (`Pie dataKey="cost"`, innerRadius 60 / outerRadius 100 → a 0.6
//  inner-radius ratio, `paddingAngle={3}`). Built with `SectorMark` so the slice
//  angles are proportional to each type's cost; colors come from the shared P1/S9
//  palette by source index (web `entry.color` → `TSChartPalette.color(at:)`). The
//  whole chart exposes one accessible summary so VoiceOver isn't handed an opaque
//  image. A small legend chip (web `Legend` dots) backs the breakdown header.
//

import Charts
import SwiftUI

// MARK: - Legend chip (web `Legend` dot + name)

/// One legend entry: a colored swatch + the type name (pre-localized data).
struct ChargerTypeLegendChip: View {
    let color: Color
    let label: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Cost-by-charger-type donut (web `PieChart`)

/// The donut chart. One `SectorMark` per type, the angle proportional to cost
/// (web `dataKey="cost"`), an inner-radius ratio of 0.6 (web 60/100) and an
/// angular inset standing in for the web `paddingAngle`. The legend is hidden (the
/// breakdown column carries its own); the chart speaks a single share summary.
struct ChargerTypeDonutChart: View {
    let rows: [ChargerTypeRow]
    let title: String
    let formatting: any ChargerTypeFormatting

    private var summary: String {
        ChargerTypeAccessibility.chartSummary(
            rows,
            title: title,
            formatNumber: formatting.formatNumber
        )
    }

    var body: some View {
        Chart(rows) { row in
            SectorMark(
                angle: .value("cost", ChargerTypeNumeric.safe(row.cost)),
                innerRadius: .ratio(0.6),
                angularInset: 2
            )
            .cornerRadius(4)
            .foregroundStyle(TSChartPalette.color(at: row.colorIndex))
        }
        .chartLegend(.hidden)
        .frame(height: 240)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: summary))
    }
}
