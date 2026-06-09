//
//  DriveTelemetryWidget.Chart.swift
//  TeslaSync — P4 dashboard widget · 0041 · DriveTelemetryWidget (Apple)
//
//  The Swift Charts composition (web Recharts `ComposedChart`): a speed line +
//  battery dashed line + (wide) elevation area on the left axis, and a power area
//  on the right axis. Power is mapped into the left plotting space via
//  `DriveTelemetryChartScale` so the right power axis lines up with the left
//  series, exactly as the web's dual `YAxis` does. Colors come from the design
//  tokens (Recharts hex → semantic chart-series tokens).
//

import Charts
import SwiftUI

/// One plotted point in a single chart series.
private struct DriveTelemetryMark: Identifiable {
    let id: String
    let time: Date
    let value: Double
}

/// The drive-telemetry Swift Charts surface. Pure presentation: it receives the
/// projection + layout flag and renders, with no data access of its own.
struct DriveTelemetryChart: View {
    let projection: DriveTelemetryProjection
    let isWide: Bool
    var timeLabel: (Date) -> String = { $0.formatted(date: .omitted, time: .shortened) }

    private var data: [DriveTelemetryChartDatum] {
        projection.data
    }

    private var scale: DriveTelemetryChartScale {
        projection.scale
    }

    var body: some View {
        Chart {
            if isWide { elevationSeries }
            powerSeries
            speedSeries
            batterySeries
        }
        .chartXScale(domain: xDomain)
        .chartYScale(domain: 0 ... max(scale.leftMax, 1))
        .chartLegend(.hidden)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: DriveTelemetryStrings.string(
            "widget.driveTelemetry.a11yChart",
            "Drive telemetry chart"
        )))
        .accessibilityValue(Text(verbatim: DriveTelemetryAccessibility.summary(for: projection)))
    }

    // MARK: Series

    /// Power as a filled area on the right (power) axis, mapped into the left
    /// plotting space and drawn from the 0 kW baseline (web `Area` on yAxisId
    /// "power").
    private var powerSeries: some ChartContent {
        ForEach(powerMarks) { mark in
            AreaMark(
                x: .value("time", mark.time),
                yStart: .value("base", scale.powerBaselinePlot),
                yEnd: .value("power", mark.value)
            )
            .foregroundStyle(Color.TS.chartSeriesPower.opacity(0.28))
            .interpolationMethod(.catmullRom)

            LineMark(x: .value("time", mark.time), y: .value("power", mark.value))
                .foregroundStyle(Color.TS.chartSeriesPower)
                .lineStyle(StrokeStyle(lineWidth: 1.5))
                .interpolationMethod(.catmullRom)
        }
    }

    /// Speed as a solid line on the left axis (web cyan line).
    private var speedSeries: some ChartContent {
        ForEach(marks(\.speed)) { mark in
            LineMark(x: .value("time", mark.time), y: .value("speed", mark.value))
                .foregroundStyle(Color.TS.chartSeriesSpeed)
                .lineStyle(StrokeStyle(lineWidth: 2))
                .interpolationMethod(.catmullRom)
        }
    }

    /// Battery % as a dashed line on the left axis (web amber dashed line).
    private var batterySeries: some ChartContent {
        ForEach(marks(\.battery)) { mark in
            LineMark(x: .value("time", mark.time), y: .value("battery", mark.value))
                .foregroundStyle(Color.TS.chartSeriesBattery)
                .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                .interpolationMethod(.catmullRom)
        }
    }

    /// Elevation as a muted area under the left axis (wide only — web gray area).
    private var elevationSeries: some ChartContent {
        ForEach(marks(\.elevation)) { mark in
            AreaMark(x: .value("time", mark.time), y: .value("elevation", mark.value))
                .foregroundStyle(Color.TS.textMuted.opacity(0.15))
                .interpolationMethod(.catmullRom)
        }
    }

    // MARK: Axes

    @AxisContentBuilder
    private var xAxis: some AxisContent {
        AxisMarks(values: .automatic(desiredCount: isWide ? 5 : 3)) { value in
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
        AxisMarks(position: .leading) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
            AxisValueLabel {
                if let plot = value.as(Double.self) {
                    Text(verbatim: DriveTelemetryNumberFormat.decimal(plot, fractionDigits: 0))
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        AxisMarks(position: .trailing, values: powerAxisPositions) { value in
            AxisValueLabel {
                if let plot = value.as(Double.self) {
                    Text(verbatim: DriveTelemetryNumberFormat.decimal(scale.plotToPower(plot), fractionDigits: 0))
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    // MARK: Derived data

    private var powerMarks: [DriveTelemetryMark] {
        data.compactMap { datum in
            datum.power.map { DriveTelemetryMark(id: datum.id, time: datum.time, value: scale.powerToPlot($0)) }
        }
    }

    private func marks(_ key: KeyPath<DriveTelemetryChartDatum, Double?>) -> [DriveTelemetryMark] {
        data.compactMap { datum in
            datum[keyPath: key].map { DriveTelemetryMark(id: datum.id, time: datum.time, value: $0) }
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

    /// Three power ticks (0, mid, max) projected into the left plotting space.
    private var powerAxisPositions: [Double] {
        [0, scale.leftMax / 2, scale.leftMax]
    }
}
