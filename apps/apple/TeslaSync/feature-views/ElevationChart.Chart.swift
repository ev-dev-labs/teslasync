//
//  ElevationChart.Chart.swift
//  TeslaSync — P4 feature view · 0141 · ElevationChart (Apple)
//
//  The area+line Swift Charts trace + its selection tooltip — the native
//  counterpart of the web Recharts `ComposedChart` (an `<Area dataKey="elevation">`
//  on a left axis + a `<Line dataKey="speed">` on a right axis, with a synced hover
//  reference line). Split out of the chrome in `ElevationChart.Views.swift`. All
//  copy resolves through the P1/S10 facade; all chrome is token-driven (P1/S9).
//
//  Recharts → Swift Charts mapping: Swift Charts plots a single y-scale per `Chart`,
//  so the web's dual y-axes are reproduced by keeping the LEFT scale in elevation
//  meters and projecting the speed line into that same domain
//  (`projectSpeedToElevation`) while a TRAILING `AxisMarks` reads the true speed
//  values back out — a real second axis, not a collapsed one. The hover sync
//  (web `useSyncedCursor` / `useSyncedReferenceLineX`) is a `RuleMark` driven by the
//  shared `cursorIndex` plus a `.chartXSelection` that broadcasts the local hover.
//

import Charts
import SwiftUI

// MARK: - Chart (web Recharts `ComposedChart`)

/// The elevation area + speed line trace. The elevation area (left axis, meters)
/// carries a filled gradient with a crisp top stroke; the speed line (right axis,
/// the user's unit) is projected into the elevation domain so both share one
/// scale. Hovering moves a shared reference line + reveals a per-sample tooltip.
struct ElevationProfileChart: View {
    let points: [ElevationPoint]
    let speedUnit: SpeedUnit
    let cursorIndex: Int?
    let accessibilitySummary: String
    let onCursorChange: (Int?) -> Void

    @Environment(\.locale) private var locale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var rawSelection: Int?

    private var elevationDomain: ClosedRange<Double> {
        ElevationProjection.elevationDomain(points)
    }

    private var speedDomain: ClosedRange<Double> {
        ElevationProjection.speedDomain(points)
    }

    private var xDomain: ClosedRange<Int> {
        let lower = points.first?.index ?? 0
        let upper = points.last?.index ?? lower
        return lower ... max(lower, upper)
    }

    private var cursorPoint: ElevationPoint? {
        guard let cursorIndex else { return nil }
        return points.first { $0.index == cursorIndex }
    }

    var body: some View {
        Chart {
            ForEach(points) { point in
                AreaMark(
                    x: .value(xAxisLabel, point.index),
                    y: .value(elevationAxisLabel, point.elevationM)
                )
                .foregroundStyle(elevationAreaGradient)
                .interpolationMethod(.monotone)
                .accessibilityHidden(true)

                LineMark(
                    x: .value(xAxisLabel, point.index),
                    y: .value(elevationAxisLabel, point.elevationM),
                    series: .value(seriesAxisLabel, ElevationSeries.elevation.rawValue)
                )
                .foregroundStyle(Color.TS.statusSuccess)
                .lineStyle(StrokeStyle(lineWidth: 2))
                .interpolationMethod(.monotone)

                LineMark(
                    x: .value(xAxisLabel, point.index),
                    y: .value(elevationAxisLabel, projectedSpeed(point.speedDisplay)),
                    series: .value(seriesAxisLabel, ElevationSeries.speed.rawValue)
                )
                .foregroundStyle(Color.TS.chartSeriesPower.opacity(0.6))
                .lineStyle(StrokeStyle(lineWidth: 1.5))
                .interpolationMethod(.monotone)
            }

            if let cursorPoint {
                RuleMark(x: .value(xAxisLabel, cursorPoint.index))
                    .foregroundStyle(Color.TS.textMuted.opacity(0.7))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    .annotation(
                        position: .top,
                        overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                    ) {
                        ElevationTooltip(point: cursorPoint, speedUnit: speedUnit)
                    }
            }
        }
        .chartYScale(domain: elevationDomain)
        .chartXScale(domain: xDomain)
        .chartYAxis { yAxisMarks }
        .chartXAxis { xAxisMarks }
        .chartXSelection(value: $rawSelection)
        .onChange(of: rawSelection) { _, newValue in onCursorChange(newValue) }
        .chartLegend(.hidden)
        .frame(height: 220)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: points)
        .accessibilityElement()
        .accessibilityLabel(
            ElevationStrings.text(
                "driveDetail.elevProfile.aria",
                "Elevation and speed area+line chart over the drive timeline"
            )
        )
        .accessibilityValue(Text(verbatim: accessibilitySummary))
    }

    // MARK: Axes

    @AxisContentBuilder
    private var yAxisMarks: some AxisContent {
        AxisMarks(position: .leading) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: ElevationProjection.intString(number, locale: locale))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.statusSuccess)
                }
            }
        }
        AxisMarks(position: .trailing, values: trailingSpeedPositions) { value in
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: speedAxisLabel(atElevation: number))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.chartSeriesPower)
                }
            }
        }
    }

    @AxisContentBuilder
    private var xAxisMarks: some AxisContent {
        AxisMarks(values: [xDomain.lowerBound, xDomain.upperBound]) { value in
            AxisValueLabel {
                if let index = value.as(Int.self) {
                    Text(verbatim: timeLabel(forIndex: index))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    // MARK: Helpers

    private var elevationAreaGradient: LinearGradient {
        LinearGradient(
            colors: [Color.TS.statusSuccess.opacity(0.25), Color.TS.statusSuccess.opacity(0.04)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    /// Speed ticks for the trailing axis, expressed as positions in the elevation
    /// domain (so they line up with the projected speed line).
    private var trailingSpeedPositions: [Double] {
        let lower = speedDomain.lowerBound
        let upper = speedDomain.upperBound
        let steps = 4
        return (0 ... steps).map { step in
            let speed = lower + (upper - lower) * Double(step) / Double(steps)
            return projectedSpeed(speed)
        }
    }

    private func projectedSpeed(_ speed: Double) -> Double {
        ElevationProjection.projectSpeedToElevation(
            speed,
            speedDomain: speedDomain,
            elevationDomain: elevationDomain
        )
    }

    /// Inverse of `projectedSpeed` — the true speed value at an elevation-domain y,
    /// used to label the trailing axis.
    private func speedAxisLabel(atElevation elevation: Double) -> String {
        let elevSpan = elevationDomain.upperBound - elevationDomain.lowerBound
        guard elevSpan > 0 else { return ElevationProjection.intString(speedDomain.lowerBound, locale: locale) }
        let ratio = (elevation - elevationDomain.lowerBound) / elevSpan
        let speed = speedDomain.lowerBound + ratio * (speedDomain.upperBound - speedDomain.lowerBound)
        return ElevationProjection.intString(speed, locale: locale)
    }

    private func timeLabel(forIndex index: Int) -> String {
        points.first { $0.index == index }?.time ?? ""
    }

    private var xAxisLabel: String {
        ElevationStrings.string("driveDetail.axis.time", "Time")
    }

    private var elevationAxisLabel: String {
        ElevationStrings.string("driveDetail.elevation", "Elevation")
    }

    private var seriesAxisLabel: String {
        ElevationStrings.string("driveDetail.axis.series", "Series")
    }
}

// MARK: - Tooltip (web `ChartTooltip`)

/// The selection tooltip: the sample's time over its elevation (m) + speed
/// (unit) values, the native parity of the web `ChartTooltip` payload list.
struct ElevationTooltip: View {
    let point: ElevationPoint
    let speedUnit: SpeedUnit
    @Environment(\.locale) private var locale

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: point.time)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            row(
                color: Color.TS.statusSuccess,
                key: ElevationSeries.elevation.localizationKey,
                fallback: ElevationSeries.elevation.fallback,
                value: elevationValue
            )
            row(
                color: Color.TS.chartSeriesPower,
                key: ElevationSeries.speed.localizationKey,
                fallback: ElevationSeries.speed.fallback,
                value: speedValue
            )
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .frame(minWidth: 150, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func row(color: Color, key: String, fallback: String, value: String) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Circle().fill(color).frame(width: 7, height: 7)
            ElevationStrings.text(key, fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: value)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
    }

    private var elevationValue: String {
        let meters = ElevationStrings.string("driveDetail.unit.m", "m")
        return "\(ElevationProjection.intString(point.elevationM, locale: locale)) \(meters)"
    }

    private var speedValue: String {
        "\(ElevationProjection.intString(point.speedDisplay, locale: locale)) \(speedUnit.label)"
    }
}
