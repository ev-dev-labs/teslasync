//
//  TirePressureHistoryWidget.Chart.swift
//  TeslaSync — P4 dashboard widget · 0101 · TirePressureHistoryWidget (Apple)
//
//  The Swift Charts composition (web Recharts `LineChart`): four corner-pressure
//  lines (FL / FR / RL / RR) over time, plus the recommended-range Min/Max
//  reference rules. Pure presentation — it receives the projection + layout flags
//  and renders, with no data access of its own. Colors come from the design
//  tokens (web hex → chart-series token).
//

import Charts
import SwiftUI

/// One plotted point in a single corner's line series.
private struct TirePressureMark: Identifiable {
    let id: String
    let time: Date
    let value: Double
}

/// The tire-pressure-history Swift Charts surface.
struct TirePressureHistoryChart: View {
    let projection: TirePressureProjection
    let showAxisTitles: Bool
    var timeLabel: (Date) -> String = { $0.formatted(date: .omitted, time: .shortened) }

    private var data: [TirePressureChartDatum] {
        projection.data
    }

    var body: some View {
        Chart {
            recommendedRule(
                projection.recommendedLow,
                label: minLabel,
                annotation: .top
            )
            recommendedRule(
                projection.recommendedHigh,
                label: maxLabel,
                annotation: .bottom
            )
            ForEach(TireCorner.allCases, id: \.self) { corner in
                cornerSeries(corner)
            }
        }
        .chartXScale(domain: xDomain)
        .chartYScale(domain: projection.yDomain)
        .chartForegroundStyleScale(domain: seriesNames, range: seriesColors)
        .chartLegend(.hidden)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .overlay(alignment: .topTrailing) { unitTitle }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: TirePressureHistoryStrings.string(
            "widget.tirePressureHistory.a11yChart",
            "Tire pressure history chart"
        )))
        .accessibilityValue(Text(verbatim: TirePressureHistoryAccessibility.summary(for: projection)))
    }

    // MARK: Series

    private func cornerSeries(_ corner: TireCorner) -> some ChartContent {
        let name = seriesName(corner)
        return ForEach(marks(for: corner)) { mark in
            LineMark(
                x: .value("time", mark.time),
                y: .value("pressure", mark.value)
            )
            .foregroundStyle(by: .value("series", name))
            .lineStyle(StrokeStyle(lineWidth: 2))
            .interpolationMethod(.catmullRom)
        }
    }

    private func recommendedRule(
        _ value: Double,
        label: String,
        annotation: AnnotationPosition
    ) -> some ChartContent {
        RuleMark(y: .value("recommended", value))
            .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
            .foregroundStyle(Color.TS.statusSuccess.opacity(0.45))
            .annotation(position: annotation, alignment: .leading, spacing: 2) {
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusSuccess.opacity(0.75))
            }
    }

    // MARK: Axes

    @AxisContentBuilder
    private var xAxis: some AxisContent {
        AxisMarks(values: .automatic(desiredCount: showAxisTitles ? 5 : 3)) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
            AxisValueLabel {
                if let date = value.as(Date.self) {
                    Text(verbatim: timeLabel(date)).foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    @AxisContentBuilder
    private var yAxis: some AxisContent {
        AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
            AxisValueLabel {
                if let pressure = value.as(Double.self) {
                    Text(verbatim: TirePressureNumberFormat.decimal(pressure, fractionDigits: 1))
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    private var unitTitle: some View {
        Group {
            if showAxisTitles {
                Text(verbatim: projection.pressureUnitLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .padding(2)
            }
        }
    }

    // MARK: Derived data

    private func marks(for corner: TireCorner) -> [TirePressureMark] {
        data.compactMap { datum in
            corner.value(in: datum).map { TirePressureMark(id: datum.id, time: datum.time, value: $0) }
        }
    }

    private var xDomain: ClosedRange<Date> {
        guard let first = data.first?.time, let last = data.last?.time else {
            let now = Date()
            return now.addingTimeInterval(-60) ... now
        }
        guard first < last else {
            return first.addingTimeInterval(-60) ... last.addingTimeInterval(60)
        }
        return first ... last
    }

    // MARK: Series identity + color tokens

    private func seriesName(_ corner: TireCorner) -> String {
        TirePressureHistoryStrings.string(corner.labelKey, corner.labelFallback)
    }

    private var seriesNames: [String] {
        TireCorner.allCases.map(seriesName)
    }

    /// Web hex → design token: FL #3b82f6 → chartSeriesSpeed, FR #06b6d4 →
    /// chartSeriesRegen, RL #22c55e → chartSeriesBattery, RR #a855f7 →
    /// chartSeriesPower (three are exact-hex matches in the token palette).
    private var seriesColors: [Color] {
        TireCorner.allCases.map { corner in
            switch corner {
            case .frontLeft: Color.TS.chartSeriesSpeed
            case .frontRight: Color.TS.chartSeriesRegen
            case .rearLeft: Color.TS.chartSeriesBattery
            case .rearRight: Color.TS.chartSeriesPower
            }
        }
    }

    private var minLabel: String {
        TirePressureHistoryStrings.string("widget.tirePressureHistory.min", "Min")
    }

    private var maxLabel: String {
        TirePressureHistoryStrings.string("widget.tirePressureHistory.max", "Max")
    }
}
