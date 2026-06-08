//
//  WallConnectorWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0112 · WallConnectorWidget (Apple)
//
//  The presentational subviews composed by `WallConnectorWidget`: the header stat
//  row (web `WidgetChartSummary` stats), the daily-kWh bar chart (web Recharts
//  `<BarChart>` → Swift Charts `BarMark`), and the friendly empty surface. All
//  consume pre-localized strings from the P1/S10 facade and the shared P1/S9 tokens
//  — no networking, no Tailwind ports.
//

import Charts
import SwiftUI

// MARK: - Palette (web bar fill `#10b981`)

/// The surface's chart palette. The bar fill reproduces the exact web hex
/// (`#10b981`, emerald-500) so the chart reads identically on both apps.
enum WallConnectorPalette {
    static let bar = Color(.sRGB, red: 0.063, green: 0.725, blue: 0.506, opacity: 1)
}

// MARK: - Stat item + row (web `WidgetChartSummary` stats)

/// One header stat cell (web `ChartSummaryStat`): a muted label over a value with an
/// optional trailing unit. Values are pre-formatted so the locale applies at build
/// time and the cell stays a pure presentation type.
struct WallConnectorStatItem: Identifiable {
    let labelKey: String
    let fallback: String
    let value: String
    let unit: String?

    var id: String {
        labelKey
    }
}

/// The stat row shown above the chart (and the whole body in compact mode), the
/// native port of the web `WidgetChartSummary` stat grid.
struct WallConnectorStatRow: View {
    let stats: [WallConnectorStatItem]

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            ForEach(stats) { stat in
                statCell(stat)
                if stat.id != stats.last?.id {
                    Spacer(minLength: TSSpacing.xs)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func statCell(_ stat: WallConnectorStatItem) -> some View {
        let label = WallConnectorStrings.string(stat.labelKey, stat.fallback)
        return VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(verbatim: stat.value)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                if let unit = stat.unit, !unit.isEmpty {
                    Text(verbatim: unit)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: WallConnectorAccessibility.statLabel(
            label: label,
            value: stat.value,
            unit: stat.unit
        )))
    }
}

// MARK: - Daily-kWh bar chart (web `<BarChart>` → Swift Charts `BarMark`)

/// The daily charged-energy bar chart — the native port of the web Recharts
/// `<BarChart>` with a single emerald `<Bar dataKey="energy_kwh">`. Uses Swift
/// Charts `BarMark` over the categorical "M/D" day labels, the exact web bar hex,
/// and the rounded top corners (web `radius={[4, 4, 0, 0]}`).
struct WallConnectorBarChart: View {
    let bars: [WallConnectorDailyBar]
    let summary: WallConnectorSummary
    let isWide: Bool

    private var axisLabel: String {
        WallConnectorStrings.string("widget.wallConnector.axisDate", "Date")
    }

    private var valueLabel: String {
        WallConnectorStrings.string("widget.wallConnector.energy", "Energy")
    }

    var body: some View {
        Chart(bars) { bar in
            BarMark(
                x: .value(axisLabel, bar.label),
                y: .value(valueLabel, bar.energyKwh)
            )
            .cornerRadius(4)
            .foregroundStyle(WallConnectorPalette.bar)
        }
        .chartXScale(domain: bars.map(\.label))
        .chartXAxis {
            AxisMarks { value in
                AxisValueLabel {
                    if let label = value.as(String.self) {
                        Text(verbatim: label)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: isWide ? 5 : 3)) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(verbatim: WallConnectorFormat.axisKwh(number))
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: WallConnectorAccessibility.chartSummary(
            summary: summary,
            localize: WallConnectorStrings.string
        )))
    }
}

// MARK: - Empty surface (web `WidgetChartSummary` `isEmpty` → `EmptyState`)

/// The friendly empty surface shown inside the content shell — the native port of
/// the web `EmptyState` (plug icon + message). Used for both the no-site and no-data
/// branches; never a blank panel.
struct WallConnectorEmptyState: View {
    let message: String

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "powerplug.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: message))
    }
}
