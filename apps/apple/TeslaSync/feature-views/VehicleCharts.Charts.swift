//
//  VehicleCharts.Charts.swift
//  TeslaSync — P4 feature view · 0303 · VehicleCharts (Apple)
//
//  The Swift Charts speed-history chart + its selection tooltip + the accessible
//  data-series descriptor — the native counterpart of the web Recharts `AreaChart`
//  in features/vehicles/components/VehicleCharts.tsx (one `<Area>` of speed over
//  time, with the cyan `areaGradient` fill and the `ChartTooltip`).
//
//  Recharts → Swift Charts mapping: the web `<Area dataKey="speed" stroke="#00f0ff"
//  fill="url(#vehicleSpeedGrad)">` becomes an `AreaMark` (the translucent cyan
//  gradient) under a `LineMark` (the stroke), both `.interpolationMethod(.monotone)`.
//  The series color binds to the brand `chartSeriesSpeed` token. SI speed is
//  converted to the user's unit at THIS render boundary (web `convertSpeedFromSI`).
//  The web `ResponsiveContainer` data is reproduced as a native `AXChartDescriptor`
//  so VoiceOver can navigate every (time, speed) point.
//

import Accessibility
import Charts
import SwiftUI

private let vehicleChartsSpeedChartHeight: CGFloat = 256

// MARK: - Display point (SI speed converted at the render boundary)

/// A chart point with the speed already converted to the user's display unit.
struct VehicleChartsSpeedPoint: Identifiable, Equatable {
    let id: Int
    let timestamp: Date
    let speed: Double

    /// Projects the SI samples into display points (web `convertSpeedFromSI`).
    static func points(
        from samples: [VehicleChartsSpeedSample],
        units: any VehicleChartsUnits
    ) -> [VehicleChartsSpeedPoint] {
        samples.map { sample in
            VehicleChartsSpeedPoint(
                id: sample.id,
                timestamp: sample.timestamp,
                speed: units.convertSpeedFromSI(sample.speedMps)
            )
        }
    }
}

// MARK: - Speed area chart (web Recharts `AreaChart`)

/// The speed-over-time area chart — the native counterpart of the web Recharts
/// `AreaChart`. Time on x, display speed on y; tapping snaps to the nearest sample
/// and reveals a value tooltip (web `ChartTooltip`).
struct VehicleChartsSpeedChart: View {
    let samples: [VehicleChartsSpeedSample]
    let units: any VehicleChartsUnits
    let formatting: any VehicleChartsFormatting
    let localize: (String, String) -> String

    @State private var selectedTime: Date?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let seriesColor = Color.TS.chartSeriesSpeed

    private var points: [VehicleChartsSpeedPoint] {
        VehicleChartsSpeedPoint.points(from: samples, units: units)
    }

    private var unitLabel: String {
        units.speedUnitLabel
    }

    private var timeAxisName: String {
        VehicleChartsLabels.speedTimeAxis(localize: localize)
    }

    private var speedAxisName: String {
        VehicleChartsLabels.speedValueAxis(unit: unitLabel, localize: localize)
    }

    /// The selection snapped to the nearest plotted time so the tooltip reads an
    /// exact sample rather than the raw gesture location.
    private var snappedPoint: VehicleChartsSpeedPoint? {
        guard let selectedTime else { return nil }
        return points.min(by: {
            abs($0.timestamp.timeIntervalSince(selectedTime)) < abs($1.timestamp.timeIntervalSince(selectedTime))
        })
    }

    private var yDomain: ClosedRange<Double> {
        let peak = points.map(\.speed).max() ?? 0
        return 0 ... max(peak * 1.1, 1)
    }

    var body: some View {
        Chart {
            ForEach(points) { point in
                AreaMark(
                    x: .value(timeAxisName, point.timestamp),
                    y: .value(speedAxisName, point.speed)
                )
                .interpolationMethod(.monotone)
                .foregroundStyle(Self.areaGradient)
            }
            ForEach(points) { point in
                LineMark(
                    x: .value(timeAxisName, point.timestamp),
                    y: .value(speedAxisName, point.speed)
                )
                .interpolationMethod(.monotone)
                .lineStyle(StrokeStyle(lineWidth: 2))
                .foregroundStyle(Self.seriesColor)
            }
            if let snappedPoint {
                RuleMark(x: .value(timeAxisName, snappedPoint.timestamp))
                    .foregroundStyle(Color.TS.border)
                    .annotation(
                        position: .top,
                        overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                    ) {
                        VehicleChartsSpeedTooltip(
                            point: snappedPoint,
                            unitLabel: unitLabel,
                            formatting: formatting,
                            localize: localize
                        )
                    }
                PointMark(
                    x: .value(timeAxisName, snappedPoint.timestamp),
                    y: .value(speedAxisName, snappedPoint.speed)
                )
                .foregroundStyle(Self.seriesColor)
                .symbolSize(64)
            }
        }
        .chartYScale(domain: yDomain)
        .chartXSelection(value: $selectedTime)
        .chartLegend(.hidden)
        .chartXAxis { timeAxisMarks() }
        .chartYAxis { speedAxisMarks() }
        .frame(height: vehicleChartsSpeedChartHeight)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: points)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: VehicleChartsLabels.speedChartAccessibility(localize: localize)))
        .accessibilityChartDescriptor(
            VehicleChartsSpeedChartDescriptor(
                points: points,
                title: VehicleChartsLabels.speedSeriesName(unit: unitLabel, localize: localize),
                timeAxisName: timeAxisName,
                speedAxisName: speedAxisName,
                formatting: formatting
            )
        )
    }

    /// The translucent cyan fill (web `areaGradient('vehicleSpeedGrad', '#00f0ff', 0.1)`):
    /// the series color fading from the top to near-transparent at the base.
    private static var areaGradient: LinearGradient {
        LinearGradient(
            colors: [seriesColor.opacity(0.3), seriesColor.opacity(0.02)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    /// Time x labels (web `XAxis dataKey="time"`) on the token dashed grid.
    private func timeAxisMarks() -> some AxisContent {
        AxisMarks { mark in
            AxisGridLine(stroke: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                .foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let date = mark.as(Date.self) {
                    Text(verbatim: formatting.formatTime(date))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    /// Muted speed value labels (web `YAxis`) on the token dashed grid.
    private func speedAxisMarks() -> some AxisContent {
        AxisMarks(position: .leading) { mark in
            AxisGridLine(stroke: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                .foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let speed = mark.as(Double.self) {
                    Text(verbatim: formatting.formatNumber(speed, decimals: 0))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }
}

// MARK: - Tooltip (web `ChartTooltip`)

/// The selection tooltip: the time over its speed — the native parity of the web
/// `ChartTooltip` payload (`Speed {unit}: N` at the hovered time).
struct VehicleChartsSpeedTooltip: View {
    let point: VehicleChartsSpeedPoint
    let unitLabel: String
    let formatting: any VehicleChartsFormatting
    let localize: (String, String) -> String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: formatting.formatTime(point.timestamp))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            HStack(spacing: TSSpacing.sm) {
                Circle()
                    .fill(Color.TS.chartSeriesSpeed)
                    .frame(width: 7, height: 7)
                Text(verbatim: VehicleChartsLabels.speedSeriesName(unit: unitLabel, localize: localize))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.md)
                Text(verbatim: formatting.formatNumber(point.speed, decimals: 1))
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
        .frame(minWidth: 132, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Accessible data series (web Recharts data)

/// The native parity of the web chart's data series: an `AXChartDescriptor`
/// exposing every (time, speed) point so VoiceOver can read the curve as a data
/// series ("view as table" on Apple platforms).
struct VehicleChartsSpeedChartDescriptor: AXChartDescriptorRepresentable {
    let points: [VehicleChartsSpeedPoint]
    let title: String
    let timeAxisName: String
    let speedAxisName: String
    let formatting: any VehicleChartsFormatting

    func makeChartDescriptor() -> AXChartDescriptor {
        let times = points.map(\.timestamp.timeIntervalSinceReferenceDate)
        let speeds = points.map(\.speed)

        let xAxis = AXNumericDataAxisDescriptor(
            title: timeAxisName,
            range: (times.min() ?? 0) ... (times.max() ?? 0),
            gridlinePositions: []
        ) { value in
            formatting.formatTime(Date(timeIntervalSinceReferenceDate: value))
        }

        let yAxis = AXNumericDataAxisDescriptor(
            title: speedAxisName,
            range: 0 ... (speeds.max() ?? 0),
            gridlinePositions: []
        ) { value in
            formatting.formatNumber(value, decimals: 1)
        }

        let series = AXDataSeriesDescriptor(
            name: title,
            isContinuous: true,
            dataPoints: points.map {
                AXDataPoint(x: $0.timestamp.timeIntervalSinceReferenceDate, y: $0.speed)
            }
        )

        return AXChartDescriptor(
            title: title,
            summary: nil,
            xAxis: xAxis,
            yAxis: yAxis,
            additionalAxes: [],
            series: [series]
        )
    }

    func updateChartDescriptor(_: AXChartDescriptor) {}
}
