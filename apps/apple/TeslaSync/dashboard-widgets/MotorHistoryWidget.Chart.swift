//
//  MotorHistoryWidget.Chart.swift
//  TeslaSync — P4 dashboard widget · 0066 · MotorHistoryWidget (Apple)
//
//  The Swift Charts composition (web Recharts `ComposedChart`): a torque line
//  (left axis, Nm) + a stator-temp line (right axis), a 100 °C danger band, and
//  the wide-mode lateral / longitudinal g-force overlays. Temp is mapped into the
//  torque plotting space via `MotorChartScale` so the right axis + danger band
//  line up exactly as on the web. Colors come from the design tokens.
//

import Charts
import SwiftUI

/// One plotted point in a single chart series.
private struct MotorMark: Identifiable {
    let id: String
    let time: Date
    let value: Double
}

/// The motor-history Swift Charts surface. Pure presentation: it receives the
/// projection + layout flags and renders, with no data access of its own.
struct MotorHistoryChart: View {
    let projection: MotorHistoryProjection
    let showGForces: Bool
    let showAxisTitles: Bool
    var timeLabel: (Date) -> String = { $0.formatted(date: .omitted, time: .shortened) }

    private var data: [MotorChartDatum] {
        projection.data
    }

    private var scale: MotorChartScale {
        projection.scale
    }

    var body: some View {
        Chart {
            dangerBand
            torqueSeries
            statorSeries
            if showGForces {
                lateralSeries
                longitudinalSeries
            }
        }
        .chartXScale(domain: xDomain)
        .chartYScale(domain: 0 ... max(scale.torqueMax, 1))
        .chartForegroundStyleScale(domain: seriesNames, range: seriesColors)
        .chartLegend(.hidden)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .overlay(alignment: .topLeading) { axisTitle(torqueUnit, color: Color.TS.chartSeriesRegen) }
        .overlay(alignment: .topTrailing) {
            axisTitle(projection.temperatureUnitLabel, color: Color.TS.chartSeriesEnergy)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: MotorHistoryStrings.string(
            "widget.motorHistory.a11yChart",
            "Motor history chart"
        )))
        .accessibilityValue(Text(verbatim: MotorHistoryAccessibility.summary(for: projection)))
    }

    // MARK: Series

    private var torqueSeries: some ChartContent {
        ForEach(torqueMarks) { mark in
            LineMark(x: .value("time", mark.time), y: .value("torque", mark.value))
                .foregroundStyle(by: .value("series", torqueName))
                .lineStyle(StrokeStyle(lineWidth: 2))
                .interpolationMethod(.catmullRom)
        }
    }

    private var statorSeries: some ChartContent {
        ForEach(statorMarks) { mark in
            LineMark(x: .value("time", mark.time), y: .value("stator", mark.value))
                .foregroundStyle(by: .value("series", statorName))
                .lineStyle(StrokeStyle(lineWidth: 2))
                .interpolationMethod(.catmullRom)
        }
    }

    private var lateralSeries: some ChartContent {
        ForEach(lateralMarks) { mark in
            LineMark(x: .value("time", mark.time), y: .value("lateralG", mark.value))
                .foregroundStyle(by: .value("series", lateralName))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 2]))
                .interpolationMethod(.catmullRom)
        }
    }

    private var longitudinalSeries: some ChartContent {
        ForEach(longitudinalMarks) { mark in
            LineMark(x: .value("time", mark.time), y: .value("longG", mark.value))
                .foregroundStyle(by: .value("series", longitudinalName))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 2]))
                .interpolationMethod(.catmullRom)
        }
    }

    private var dangerBand: some ChartContent {
        RectangleMark(
            xStart: .value("start", xDomain.lowerBound),
            xEnd: .value("end", xDomain.upperBound),
            yStart: .value("dangerLow", scale.tempToTorque(projection.dangerThreshold)),
            yEnd: .value("dangerHigh", scale.torqueMax)
        )
        .foregroundStyle(Color.TS.statusDanger.opacity(0.10))
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
        AxisMarks(position: .leading) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
            AxisValueLabel {
                if let torque = value.as(Double.self) {
                    Text(verbatim: MotorNumberFormat.decimal(torque, fractionDigits: 0))
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        AxisMarks(position: .trailing, values: tempAxisPositions) { value in
            AxisValueLabel {
                if let position = value.as(Double.self) {
                    Text(verbatim: "\(MotorNumberFormat.decimal(scale.torqueToTemp(position), fractionDigits: 0))°")
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    private func axisTitle(_ text: String, color: Color) -> some View {
        Group {
            if showAxisTitles {
                Text(verbatim: text)
                    .font(Font.TS.caption)
                    .foregroundStyle(color.opacity(0.7))
                    .padding(2)
            }
        }
    }

    // MARK: Derived data

    private var torqueMarks: [MotorMark] {
        marks(\.torque)
    }

    private var statorMarks: [MotorMark] {
        data.compactMap { datum in
            datum.statorTemp.map { MotorMark(id: datum.id, time: datum.time, value: scale.tempToTorque($0)) }
        }
    }

    private var lateralMarks: [MotorMark] {
        marks(\.lateralG)
    }

    private var longitudinalMarks: [MotorMark] {
        marks(\.longitudinalG)
    }

    private func marks(_ key: KeyPath<MotorChartDatum, Double?>) -> [MotorMark] {
        data.compactMap { datum in
            datum[keyPath: key].map { MotorMark(id: datum.id, time: datum.time, value: $0) }
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

    /// Three temp ticks (0, mid, max) projected into the torque plotting space.
    private var tempAxisPositions: [Double] {
        [0, projection.scale.tempMax / 2, projection.scale.tempMax].map(scale.tempToTorque)
    }

    // MARK: Series identity + color tokens

    private var torqueName: String {
        MotorHistoryStrings.string("widget.motorHistory.torque", "Torque")
    }

    private var statorName: String {
        MotorHistoryStrings.string("widget.motorHistory.statorTemp", "Stator")
    }

    private var lateralName: String {
        MotorHistoryStrings.string("widget.motorHistory.lateralG", "Lateral G")
    }

    private var longitudinalName: String {
        MotorHistoryStrings.string("widget.motorHistory.longG", "Long. G")
    }

    private var torqueUnit: String {
        MotorHistoryStrings.string("widget.motorHistory.torqueUnit", "Nm")
    }

    private var seriesNames: [String] {
        var names = [torqueName, statorName]
        if showGForces { names.append(contentsOf: [lateralName, longitudinalName]) }
        return names
    }

    private var seriesColors: [Color] {
        var colors = [Color.TS.chartSeriesRegen, Color.TS.chartSeriesEnergy]
        if showGForces { colors.append(contentsOf: [Color.TS.chartSeriesPower, Color.TS.chartSeriesBattery]) }
        return colors
    }
}
