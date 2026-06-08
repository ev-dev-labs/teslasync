//
//  YearlyTrendChart.Chart.swift
//  TeslaSync — P4 feature view · 0095 · YearlyTrendChart (Apple)
//
//  The Swift Charts composed panel that is the body of the surface — the native
//  parity of the web source's Recharts `ComposedChart` (mapped through the P3
//  `@/components/charts` layer):
//
//    • Bars  — DC-session count per year   (web `Bar`,  CHART_COLORS[5], opacity 0.3)
//    • Line  — 10→80% avg minutes per year (web `Line`, CHART_COLORS[0])
//    • Line  — 20→80% avg minutes per year (web `Line`, CHART_COLORS[2])
//
//  The palette indices match the web `CHART_COLORS` (Okabe-Ito) through
//  `TSChartPalette`. Per Apple HIG (and the repo's composed-chart precedent),
//  the marks share a single value scale with an explicit legend naming all three
//  series, rather than cloning Recharts' twin Y axes (which would draw a second,
//  misleading numeric scale): the leading axis carries the "Minutes" title and
//  the trailing edge carries the "Sessions" title. The web component renders a
//  manual legend whose swatches were cyan/purple/red; the series' own colors are
//  the source of truth, so the native legend swatches use them.
//

import Charts
import SwiftUI

// MARK: - Series palette indices (web `CHART_COLORS`)

private enum YearlyTrendPalette {
    static let avg10to80 = 0
    static let avg20to80 = 2
    static let sessions = 5
    static let sessionsOpacity = 0.3
}

private let yearlyChartHeight: CGFloat = 280

// MARK: - Composed chart (bars + two lines)

/// The composed chart: per-year DC-session bars plus the two average
/// time-to-charge lines, on a shared value scale with dual axis titles.
struct YearlyTrendComposedChart: View {
    let bars: [YearlyTrendBar]

    private var sessionsColor: Color {
        TSChartPalette.color(at: YearlyTrendPalette.sessions).opacity(YearlyTrendPalette.sessionsOpacity)
    }

    var body: some View {
        let yearLabel = YearlyTrendStrings.string("charging.curve.col.year", "Year")
        let minutesLabel = YearlyTrendStrings.string("charging.curve.minutes", "Minutes")
        let sessionsLabel = YearlyTrendStrings.string("charging.curve.sessionCount", "Sessions")
        let avg10Name = YearlyTrendStrings.string("charging.curve.avg10to80Line", "10→80% avg")
        let avg20Name = YearlyTrendStrings.string("charging.curve.avg20to80Line", "20→80% avg")

        return Chart {
            ForEach(bars) { bar in
                BarMark(
                    x: .value(yearLabel, bar.year),
                    y: .value(sessionsLabel, bar.count)
                )
                .foregroundStyle(sessionsColor)
                .cornerRadius(TSRadius.sm)
            }
            ForEach(bars) { bar in
                LineMark(
                    x: .value(yearLabel, bar.year),
                    y: .value(minutesLabel, bar.avg10to80),
                    series: .value("series", avg10Name)
                )
                .foregroundStyle(TSChartPalette.color(at: YearlyTrendPalette.avg10to80))
                .interpolationMethod(.monotone)
                .lineStyle(StrokeStyle(lineWidth: 2))
                .symbol(Circle())
                .symbolSize(40)
            }
            ForEach(bars) { bar in
                LineMark(
                    x: .value(yearLabel, bar.year),
                    y: .value(minutesLabel, bar.avg20to80),
                    series: .value("series", avg20Name)
                )
                .foregroundStyle(TSChartPalette.color(at: YearlyTrendPalette.avg20to80))
                .interpolationMethod(.monotone)
                .lineStyle(StrokeStyle(lineWidth: 2))
                .symbol(Circle())
                .symbolSize(40)
            }
        }
        .chartLegend(.hidden)
        .tsChartAxes()
        .chartYAxisLabel(minutesLabel, position: .leading, alignment: .center)
        .chartYAxisLabel(sessionsLabel, position: .trailing, alignment: .center)
        .frame(height: yearlyChartHeight)
    }
}

// MARK: - Custom legend (web manual legend)

/// The three-swatch legend below the chart (web's manual `<div>` legend),
/// using the real series colors. Each chip is a combined accessibility element.
struct YearlyTrendLegend: View {
    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            swatch(
                color: TSChartPalette.color(at: YearlyTrendPalette.avg10to80),
                key: "charging.curve.avg10to80Line",
                fallback: "10→80% avg"
            )
            swatch(
                color: TSChartPalette.color(at: YearlyTrendPalette.avg20to80),
                key: "charging.curve.avg20to80Line",
                fallback: "20→80% avg"
            )
            swatch(
                color: TSChartPalette.color(at: YearlyTrendPalette.sessions)
                    .opacity(YearlyTrendPalette.sessionsOpacity),
                key: "charging.curve.dcSessions",
                fallback: "DC Sessions"
            )
            Spacer(minLength: 0)
        }
        .padding(.top, TSSpacing.xs)
        .accessibilityElement(children: .contain)
    }

    private func swatch(color: Color, key: String, fallback: String) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(color)
                .frame(width: 12, height: 8)
                .accessibilityHidden(true)
            YearlyTrendStrings.text(key, fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(YearlyTrendStrings.text(key, fallback))
    }
}

// MARK: - Chart body (chart + legend + VoiceOver value)

/// The content body: the composed chart above its legend, carrying the
/// VoiceOver value summary for the whole figure.
struct YearlyTrendChartBody: View {
    let bars: [YearlyTrendBar]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            YearlyTrendComposedChart(bars: bars)
                .accessibilityLabel(YearlyTrendStrings.text(
                    "charging.curve.yearlyTrend",
                    "Yearly Charging Speed Trend"
                ))
                .accessibilityValue(Text(verbatim: accessibilityValue))
            YearlyTrendLegend()
        }
    }

    private var accessibilityValue: String {
        YearlyTrendAccessibility.summary(
            bars: bars,
            yearsNoun: YearlyTrendStrings.string("charging.curve.a11yYears", "years"),
            sessionsNoun: YearlyTrendStrings.string("charging.curve.a11ySessions", "sessions"),
            emptyFallback: YearlyTrendStrings.string("charging.curve.a11yNoData", "No data")
        )
    }
}
