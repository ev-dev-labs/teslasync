//
//  SpeedHistogramChart.Chart.swift
//  TeslaSync — P4 feature view · 0149 · SpeedHistogramChart (Apple)
//
//  The single-series Swift Charts bar chart + its selection tooltip — the native
//  counterpart of the web Recharts `BarChart` (one `<Bar dataKey="pct" fill="#a855f7">`
//  over the `range` category, with a `CartesianGrid` + `ChartTooltip`). Split out of
//  the chrome in `SpeedHistogramChart.Views.swift`. The bar color comes from
//  `SpeedHistogramPalette`; all copy resolves through the P1/S10 facade; all chrome is
//  token-driven (P1/S9).
//
//  Recharts → Swift Charts mapping: the web `XAxis dataKey="range"` becomes a
//  categorical x-domain; `YAxis` + `CartesianGrid` become the leading y-axis grid
//  lines; the `<Tooltip content={<ChartTooltip />} />` becomes a tap/drag
//  `chartXSelection` rule + annotation; the rounded `<Bar radius>` becomes
//  `.cornerRadius`.
//

import Charts
import SwiftUI

// MARK: - Chart (web Recharts `BarChart`)

/// The histogram bar chart — one bar per speed bucket (web `<Bar dataKey="pct">`),
/// the purple series fill, a leading percent y-axis, and a tap/drag selection that
/// reveals a value tooltip (web `ChartTooltip`). Each bar carries a VoiceOver value.
struct SpeedHistogramBarChart: View {
    let bars: [SpeedHistogramBar]

    @State private var selectedRange: String?
    @Environment(\.locale) private var locale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var rangeAxisLabel: String {
        SpeedHistogramStrings.string("driveDetail.col.range", "Speed range")
    }

    private var pctAxisLabel: String {
        SpeedHistogramStrings.string("driveDetail.col.pct", "% of drive")
    }

    private var selectedBar: SpeedHistogramBar? {
        guard let selectedRange else { return nil }
        return bars.first { $0.range == selectedRange }
    }

    var body: some View {
        Chart {
            ForEach(bars) { bar in
                BarMark(
                    x: .value(rangeAxisLabel, bar.range),
                    y: .value(pctAxisLabel, bar.pct)
                )
                .foregroundStyle(SpeedHistogramPalette.bar)
                .cornerRadius(4)
                .accessibilityLabel(Text(verbatim: barAccessibility(bar)))
                .accessibilityValue(Text(verbatim: barValue(bar)))
            }

            if let selectedBar {
                RuleMark(x: .value(rangeAxisLabel, selectedBar.range))
                    .foregroundStyle(Color.TS.border)
                    .annotation(
                        position: .top,
                        overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                    ) {
                        SpeedHistogramTooltip(bar: selectedBar)
                    }
            }
        }
        .chartXScale(domain: bars.map(\.range))
        .chartXSelection(value: $selectedRange)
        .chartLegend(.hidden)
        .chartXAxis {
            AxisMarks { value in
                AxisValueLabel {
                    if let label = value.as(String.self) {
                        Text(verbatim: label)
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(verbatim: SpeedHistogramChartProjection.intString(number, locale: locale))
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .frame(height: 220)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: bars)
        .accessibilityLabel(
            SpeedHistogramStrings.text(
                "driveDetail.speedHistogram.aria",
                "Speed-bucket distribution histogram"
            )
        )
    }

    private func barAccessibility(_ bar: SpeedHistogramBar) -> String {
        SpeedHistogramChartAccessibility.barLabel(bar, locale: locale, localize: SpeedHistogramStrings.string)
    }

    private func barValue(_ bar: SpeedHistogramBar) -> String {
        SpeedHistogramChartProjection.percentString(bar.pct, locale: locale)
    }
}

// MARK: - Tooltip (web `ChartTooltip`)

/// The selection tooltip: the bucket's range over its share of the drive, the native
/// parity of the web `ChartTooltip` payload (the `% of drive` series + its value).
struct SpeedHistogramTooltip: View {
    let bar: SpeedHistogramBar
    @Environment(\.locale) private var locale

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: bar.range)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            HStack(spacing: TSSpacing.sm) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(SpeedHistogramPalette.bar)
                    .frame(width: 8, height: 8)
                Text(verbatim: SpeedHistogramChartProjection.seriesName(localize: SpeedHistogramStrings.string))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.md)
                Text(verbatim: SpeedHistogramChartProjection.percentString(bar.pct, locale: locale))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .frame(minWidth: 140, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
