//
//  SessionCurveChart.Chart.swift
//  TeslaSync — P4 feature view · 0090 · SessionCurveChart (Apple)
//
//  The Swift Charts area chart + its selection tooltip + the accessible data-series
//  descriptor — the native counterpart of the web Recharts `AreaChart` in
//  features/charging/components/charging-curve/SessionCurveChart.tsx (one smoothed
//  `<Area>` of charging power over state-of-charge, with the `areaGradient` fill and
//  the `ChartTooltip`). Split out of the chrome in `SessionCurveChart.Views.swift`.
//  All copy resolves through the P1/S10 facade; all chrome is token-driven (P1/S9).
//
//  Recharts → Swift Charts mapping: the web `<Area type="monotone" stroke={CHART_COLORS[0]}
//  fill="url(#curvePowerGrad)" strokeWidth={2}>` becomes an `AreaMark` (the translucent
//  gradient fill) under a `LineMark` (the 2 pt stroke), both `.interpolationMethod(.monotone)`.
//  The series color binds to the index-stable brand palette slot 0 (web `CHART_COLORS[0]`
//  = #0072B2). The web `ChartContainer` `data` + `dataColumns` accessible table is
//  reproduced as a native `AXChartDescriptor` so VoiceOver can navigate every
//  (SOC %, Power kW) point — the Apple-idiomatic equivalent of "view as table".
//

import Accessibility
import Charts
import SwiftUI

private let sessionCurveChartHeight: CGFloat = 320

// MARK: - Area chart (web Recharts `AreaChart`)

/// The power-vs-SOC area chart — the native counterpart of the web Recharts
/// `AreaChart`. SOC (%) on x, charging power (kW) on y; tapping snaps to the
/// nearest curve point and reveals a value tooltip (web `ChartTooltip`).
struct SessionCurveAreaChart: View {
    let points: [SessionCurvePoint]
    let chartData: [SessionCurvePoint]

    @State private var selectedSoc: Double?
    @Environment(\.locale) private var locale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The web `CHART_COLORS[0]` (#0072B2) → the index-stable brand palette slot 0,
    /// so the curve reads identically across platforms.
    private static let seriesColor = Color.TS.chartCategorical[0]

    private var socAxisName: String {
        SessionCurveStrings.string("charging.curve.socPercent", "SOC (%)")
    }

    private var powerAxisName: String {
        SessionCurveStrings.string("charging.curve.powerKw", "Power (kW)")
    }

    private var seriesName: String {
        SessionCurveStrings.string("charging.curve.power", "Power")
    }

    /// The selection snapped to the nearest plotted SOC so the tooltip reads an
    /// exact curve point rather than the raw gesture location.
    private var snappedPoint: SessionCurvePoint? {
        guard let selectedSoc else { return nil }
        return points.min(by: { abs($0.soc - selectedSoc) < abs($1.soc - selectedSoc) })
    }

    private var xDomain: ClosedRange<Double> {
        let socs = points.map(\.soc)
        let lower = socs.min() ?? 0
        let upper = socs.max() ?? 100
        return lower <= upper ? lower ... upper : lower ... lower
    }

    private var yDomain: ClosedRange<Double> {
        let peak = points.map(\.power).max() ?? 0
        return 0 ... max(peak * 1.1, 1)
    }

    var body: some View {
        Chart {
            ForEach(points) { point in
                AreaMark(
                    x: .value(socAxisName, point.soc),
                    y: .value(powerAxisName, point.power)
                )
                .interpolationMethod(.monotone)
                .foregroundStyle(Self.areaGradient)
            }
            ForEach(points) { point in
                LineMark(
                    x: .value(socAxisName, point.soc),
                    y: .value(powerAxisName, point.power)
                )
                .interpolationMethod(.monotone)
                .lineStyle(StrokeStyle(lineWidth: 2))
                .foregroundStyle(Self.seriesColor)
            }
            if let snappedPoint {
                RuleMark(x: .value(socAxisName, snappedPoint.soc))
                    .foregroundStyle(Color.TS.border)
                    .annotation(
                        position: .top,
                        overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                    ) {
                        SessionCurveTooltip(point: snappedPoint)
                    }
                PointMark(
                    x: .value(socAxisName, snappedPoint.soc),
                    y: .value(powerAxisName, snappedPoint.power)
                )
                .foregroundStyle(Self.seriesColor)
                .symbolSize(64)
            }
        }
        .chartXScale(domain: xDomain)
        .chartYScale(domain: yDomain)
        .chartXSelection(value: $selectedSoc)
        .chartLegend(.hidden)
        .chartXAxisLabel(position: .bottom, alignment: .trailing) {
            Text(verbatim: socAxisName)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
        }
        .chartYAxisLabel(position: .leading, alignment: .center) {
            Text(verbatim: powerAxisName)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
        }
        .chartXAxis { socAxisMarks() }
        .chartYAxis { powerAxisMarks() }
        .frame(height: sessionCurveChartHeight)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: points)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            SessionCurveStrings.text(
                "charging.curve.powerVsSoc.aria",
                "Charging power versus state-of-charge area chart for the selected session"
            )
        )
        .accessibilityChartDescriptor(
            SessionCurveChartDescriptor(
                points: chartData,
                title: SessionCurveStrings.string("charging.curve.powerVsSoc", "Power vs SOC"),
                socAxisName: socAxisName,
                powerAxisName: powerAxisName,
                locale: locale
            )
        )
    }

    /// The translucent area fill (web `areaGradient('curvePowerGrad', CHART_COLORS[0])`):
    /// the series color fading from 0.3 opacity at the top to near-transparent at the base.
    private static var areaGradient: LinearGradient {
        LinearGradient(
            colors: [seriesColor.opacity(0.3), seriesColor.opacity(0.02)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    /// SOC (%) x labels (web `XAxis dataKey="soc"`) on the token dashed grid.
    private func socAxisMarks() -> some AxisContent {
        AxisMarks { mark in
            AxisGridLine(stroke: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                .foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let soc = mark.as(Double.self) {
                    Text(verbatim: SessionCurveFormat.decimal(soc, decimals: 0, locale: locale))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    /// Muted kW value labels (web `YAxis`) on the token dashed grid.
    private func powerAxisMarks() -> some AxisContent {
        AxisMarks(position: .leading) { mark in
            AxisGridLine(stroke: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                .foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let power = mark.as(Double.self) {
                    Text(verbatim: SessionCurveFormat.decimal(power, decimals: 0, locale: locale))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }
}

// MARK: - Tooltip (web `ChartTooltip`)

/// The selection tooltip: the SOC over its charging power — the native parity of
/// the web `ChartTooltip` payload (`Power: N kW` at the hovered SOC).
struct SessionCurveTooltip: View {
    let point: SessionCurvePoint
    @Environment(\.locale) private var locale

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: socHeading)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            HStack(spacing: TSSpacing.sm) {
                Circle()
                    .fill(Color.TS.chartCategorical[0])
                    .frame(width: 7, height: 7)
                SessionCurveStrings.text("charging.curve.power", "Power")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.md)
                Text(verbatim: powerValue)
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

    private var socHeading: String {
        let soc = SessionCurveFormat.decimal(point.soc, decimals: 0, locale: locale)
        let label = SessionCurveStrings.string("charging.curve.socPercent", "SOC (%)")
        return "\(label): \(soc)"
    }

    private var powerValue: String {
        let power = SessionCurveFormat.decimal(
            SessionCurveBuilder.roundedPower(point.power),
            decimals: 1,
            locale: locale
        )
        let kw = SessionCurveStrings.string("charging.curve.unit.kw", "kW")
        return "\(power) \(kw)"
    }
}

// MARK: - Accessible data series (web `ChartContainer` data + dataColumns)

/// The native parity of the web `ChartContainer` `data` + `dataColumns` accessible
/// table: an `AXChartDescriptor` exposing every (SOC %, Power kW) point so VoiceOver
/// can read the curve as a data series ("view as table" on Apple platforms).
struct SessionCurveChartDescriptor: AXChartDescriptorRepresentable {
    let points: [SessionCurvePoint]
    let title: String
    let socAxisName: String
    let powerAxisName: String
    let locale: Locale

    func makeChartDescriptor() -> AXChartDescriptor {
        let socs = points.map(\.soc)
        let powers = points.map(\.power)

        let xAxis = AXNumericDataAxisDescriptor(
            title: socAxisName,
            range: (socs.min() ?? 0) ... (socs.max() ?? 0),
            gridlinePositions: []
        ) { value in
            SessionCurveFormat.decimal(value, decimals: 0, locale: locale) + "%"
        }

        let yAxis = AXNumericDataAxisDescriptor(
            title: powerAxisName,
            range: 0 ... (powers.max() ?? 0),
            gridlinePositions: []
        ) { value in
            SessionCurveFormat.decimal(value, decimals: 1, locale: locale)
        }

        let series = AXDataSeriesDescriptor(
            name: title,
            isContinuous: true,
            dataPoints: points.map { AXDataPoint(x: $0.soc, y: $0.power) }
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
