//
//  PowerFlowHistoryWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0073 · PowerFlowHistoryWidget (Apple)
//
//  The presentational subviews composed by `PowerFlowHistoryWidget`: the freshness
//  chip, the stat row (web `WidgetChartSummary` stats), the stacked-area routing
//  chart (web `<AreaChart>` → Swift Charts `AreaMark` stacking), its legend, and
//  the friendly empty surface. All consume pre-localized strings from the P1/S10
//  facade and the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import Charts
import SwiftUI

// MARK: - Stat item + row (web `WidgetChartSummary` stats)

/// One header stat cell (web `ChartSummaryStat`): a muted label over a value with
/// a trailing unit. `valueKw` is formatted at render time so the locale applies.
struct PowerFlowStatItem: Identifiable {
    let labelKey: String
    let fallback: String
    let valueKw: Double

    var id: String {
        labelKey
    }
}

/// The stat row shown above the chart (and the whole body in compact mode), the
/// native port of the web `WidgetChartSummary` 2-col stat grid.
struct PowerFlowStatRow: View {
    let stats: [PowerFlowStatItem]

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

    private func statCell(_ stat: PowerFlowStatItem) -> some View {
        let label = PowerFlowStrings.string(stat.labelKey, stat.fallback)
        let value = PowerFlowFormat.kilowatts(stat.valueKw)
        let unit = PowerFlowStrings.string("widget.powerFlowHistory.unitKw", "kW")
        return VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(verbatim: value)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                Text(verbatim: unit)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(value) \(unit)"))
    }
}

// MARK: - Stacked-area routing chart (web `<AreaChart>` → Swift Charts)

/// The 24h stacked power-routing chart — the native port of the web stacked
/// `<AreaChart>` with the four `<Area stackId="1">` series. Uses Swift Charts
/// `AreaMark` with `.stacking(.standard)`, the exact web series colors, and a
/// monotone interpolation (web `type="monotone"`).
struct PowerFlowAreaChart: View {
    let points: [PowerFlowPoint]
    let isWide: Bool

    private var samples: [PowerFlowChartSample] {
        PowerFlowProjection.samples(for: points)
    }

    private var seriesNames: [String] {
        PowerFlowSeries.allCases.map { $0.localizedName(PowerFlowStrings.string) }
    }

    private var seriesColors: [Color] {
        PowerFlowSeries.allCases.map(\.color)
    }

    var body: some View {
        Chart(samples) { sample in
            AreaMark(
                x: .value(PowerFlowStrings.string("widget.powerFlowHistory.axisTime", "Time"), sample.date),
                y: .value(PowerFlowStrings.string("widget.powerFlowHistory.axisPower", "Power"), sample.valueKw),
                stacking: .standard
            )
            .interpolationMethod(.monotone)
            .foregroundStyle(by: .value(
                PowerFlowStrings.string("widget.powerFlowHistory.axisSeries", "Series"),
                sample.series.localizedName(PowerFlowStrings.string)
            ))
        }
        .chartForegroundStyleScale(domain: seriesNames, range: seriesColors)
        .chartLegend(.hidden)
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: isWide ? 6 : 4)) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let date = value.as(Date.self) {
                        Text(verbatim: PowerFlowFormat.shortTime(date))
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(verbatim: PowerFlowFormat.kilowatts(number))
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: PowerFlowAccessibility.chartSummary(
            summary: PowerFlowProjection.summary(for: points),
            localize: PowerFlowStrings.string
        )))
    }
}

// MARK: - Legend (series swatches)

/// A compact legend of the four routing series (color swatch + localized name).
/// The web stacked chart names each `<Area>`; the native surface renders the names
/// as a legend so the stacked colors are unambiguous and VoiceOver-navigable.
struct PowerFlowLegend: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ForEach(PowerFlowSeries.allCases) { series in
                let name = series.localizedName(PowerFlowStrings.string)
                HStack(spacing: TSSpacing.xs) {
                    Circle()
                        .fill(series.color)
                        .frame(width: 8, height: 8)
                    Text(verbatim: name)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text(verbatim: name))
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Empty surface (web `WidgetChartSummary` `isEmpty` → `EmptyState`)

/// The friendly empty surface shown inside the content shell — the native port of
/// the web `EmptyState` (icon + message). Used for both the no-site and no-data
/// branches; never a blank panel.
struct PowerFlowEmptyState: View {
    let message: String

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "chart.line.uptrend.xyaxis")
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
