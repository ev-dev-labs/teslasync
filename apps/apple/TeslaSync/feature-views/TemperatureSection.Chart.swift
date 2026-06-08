//
//  TemperatureSection.Chart.swift
//  TeslaSync — P4 feature view · 0150 · TemperatureSection (Apple)
//
//  The four-series Swift Charts line chart + its selection tooltip for the
//  drive-detail "Temperatures" surface (web Recharts `LineChart` + `ChartTooltip` +
//  `useSyncedReferenceLineX`). Split out of TemperatureSection.Views.swift to keep
//  each file within the lint budget. Chrome is token-driven (P1/S9); copy resolves
//  through the P1/S10 facade. No networking lives here.
//

import Charts
import SwiftUI

// MARK: - Line chart (web Recharts four-series `LineChart`)

/// The four-series temperature line chart — the native counterpart of the web
/// Recharts `LineChart` with the outside/inside/driver/passenger lines. Plots one
/// `LineMark` per present sample per present series; tapping reveals a reference line
/// + value tooltip (web `useSyncedReferenceLineX` + `ChartTooltip`). The dense
/// per-sample trace carries no data table (web `chart-a11y:no-table`); the chart's
/// VoiceOver summary + the stat tiles above carry the spoken values.
struct TempSectionLineChart: View {
    let projection: TempSectionProjection
    let locale: Locale
    let summary: String

    @State private var selectedIndex: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var timeLabel: String {
        TempSectionStrings.string("driveDetail.time", "Time")
    }

    private var tempLabel: String {
        TempSectionStrings.string("driveDetail.temperature", "Temperature")
    }

    private var seriesLabel: String {
        TempSectionStrings.string("driveDetail.series", "Series")
    }

    private var lastIndex: Int {
        max(0, projection.pointCount - 1)
    }

    private var selectedPoint: TempSectionPoint? {
        guard let selectedIndex else { return nil }
        return projection.points.first { $0.index == selectedIndex }
    }

    var body: some View {
        Chart {
            ForEach(projection.presentSeries) { series in
                ForEach(projection.points) { point in
                    if let value = point.value(for: series) {
                        LineMark(
                            x: .value(timeLabel, point.index),
                            y: .value(tempLabel, value)
                        )
                        .foregroundStyle(by: .value(seriesLabel, series.rawValue))
                        .interpolationMethod(.monotone)
                        .lineStyle(StrokeStyle(lineWidth: 2))
                    }
                }
            }

            if let selectedPoint {
                RuleMark(x: .value(timeLabel, selectedPoint.index))
                    .foregroundStyle(Color.TS.border)
                    .annotation(
                        position: .top,
                        overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                    ) {
                        TempSectionTooltip(point: selectedPoint, projection: projection, locale: locale)
                    }
            }
        }
        .chartForegroundStyleScale(domain: seriesDomain, range: seriesRange)
        .chartLegend(.hidden)
        .chartXScale(domain: 0 ... max(1, lastIndex))
        .chartXSelection(value: $selectedIndex)
        .chartXAxis {
            AxisMarks(values: axisIndices) { value in
                AxisValueLabel {
                    if let index = value.as(Int.self) {
                        Text(verbatim: timeText(at: index))
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
                        Text(verbatim: TempSectionFormat.number(
                            number,
                            decimals: 0,
                            localeIdentifier: locale.identifier
                        ))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .frame(height: 220)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: projection.points)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            TempSectionStrings.text(
                "driveDetail.temperatures.aria",
                "Inside, outside, driver and passenger temperature lines over the drive timeline"
            )
        )
        .accessibilityValue(Text(verbatim: summary))
    }

    private var seriesDomain: [String] {
        projection.presentSeries.map(\.rawValue)
    }

    private var seriesRange: [Color] {
        projection.presentSeries.map(TempSectionPalette.color)
    }

    /// Web `interval="preserveStartEnd"`: label only the first + last samples.
    private var axisIndices: [Int] {
        lastIndex > 0 ? [0, lastIndex] : [0]
    }

    private func timeText(at index: Int) -> String {
        projection.points.first { $0.index == index }?.time ?? ""
    }
}

// MARK: - Tooltip (web `ChartTooltip`)

/// The selection tooltip: the sample's time over each present series' converted
/// value — the native parity of the web `ChartTooltip` payload list.
struct TempSectionTooltip: View {
    let point: TempSectionPoint
    let projection: TempSectionProjection
    let locale: Locale

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: point.time)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            ForEach(projection.presentSeries) { series in
                if let value = point.value(for: series) {
                    row(for: series, value: value)
                }
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .frame(minWidth: 156, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func row(for series: TempSectionSeries, value: Double) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Circle().fill(TempSectionPalette.color(for: series)).frame(width: 7, height: 7)
            TempSectionStrings.text(series.nameKey, series.nameFallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: TempSectionFormat.temperature(
                value,
                symbol: projection.unitSymbol,
                localeIdentifier: locale.identifier
            ))
            .font(Font.TS.caption)
            .fontWeight(.semibold)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textPrimary)
        }
    }
}
