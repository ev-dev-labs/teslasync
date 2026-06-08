//
//  SOCRouteChart.Chart.swift
//  TeslaSync — P4 feature view · 0176 · SOCRouteChart (Apple)
//
//  The Swift Charts composition for the "Battery Along Route" surface — the native
//  counterpart of the web Recharts `AreaChart` in
//  features/driving/components/SOCRouteChart.tsx. A filled `AreaMark` with the
//  green→amber→red SOC gradient (web `url(#socGradient)`) sits under a 2pt `LineMark`
//  stroke (web `stroke="#22c55e"`); a dashed horizontal `RuleMark` marks the minimum
//  arrival SOC (web red `ReferenceLine y`), one dashed vertical `RuleMark` marks each
//  charge stop (web blue `ReferenceLine x`), and tapping the plot drops a hover
//  tooltip (web `<Tooltip>`). Token-driven (P1/S9); copy via the P1/S10 facade.
//

import Charts
import SwiftUI

// MARK: - Chart (web Recharts `AreaChart`)

/// The planned-route state-of-charge area chart. The Y axis is the `[0, 100]` SOC
/// domain; the X axis is the along-route distance (web-labeled "km").
struct SOCRouteChartAreaChart: View {
    let samples: [SOCRouteSample]
    let markers: [SOCRouteChargeMarker]
    let minArrivalSoc: Double
    @Binding var selectedDistance: Double?
    let locale: Locale

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Web SOC green (`#22c55e`) → the success token (theme-aware).
    private static let socColor = Color.TS.statusSuccess
    /// Web minimum-arrival red (`#ef4444`) → the danger token (theme-aware).
    private static let minArrivalColor = Color.TS.statusDanger
    /// Web charge-stop blue (`#3b82f6`) → the speed series token (exact sRGB).
    private static let stopColor = Color.TS.chartSeriesSpeed

    private var distanceAxisName: String {
        SOCRouteChartStrings.string("tripPlanner.socChart.col.distance", "Distance")
    }

    private var socAxisName: String {
        SOCRouteChartStrings.string("tripPlanner.socChart.col.soc", "SOC %")
    }

    private var distanceUnit: String {
        SOCRouteChartStrings.string("tripPlanner.socChart.axis.distance", "km")
    }

    /// The sample nearest the current selection (web `<Tooltip>` active datum).
    private var selectedSample: SOCRouteSample? {
        SOCRouteChartProjection.sample(nearestDistance: selectedDistance, in: samples)
    }

    /// The web green→amber→red vertical fill (full SOC at top, depleted at bottom).
    private var areaGradient: LinearGradient {
        LinearGradient(
            stops: [
                Gradient.Stop(color: Color.TS.statusSuccess.opacity(0.40), location: 0.0),
                Gradient.Stop(color: Color.TS.statusWarning.opacity(0.20), location: 0.5),
                Gradient.Stop(color: Color.TS.statusDanger.opacity(0.10), location: 1.0)
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    var body: some View {
        Chart {
            areaMarks
            lineMarks
            minArrivalRule
            stopRules
            selectionRule
        }
        .chartYScale(domain: SOCRouteChartProjection.socDomain)
        .chartXScale(domain: SOCRouteChartProjection.distanceDomain(samples))
        .chartXSelection(value: $selectedDistance)
        .chartLegend(.hidden)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .chartXAxisLabel(position: .bottomTrailing, alignment: .trailing) {
            Text(verbatim: distanceUnit)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
        }
        .chartYAxisLabel(position: .leading, alignment: .center) {
            Text(verbatim: socAxisName)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(height: 260)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: samples)
        .accessibilityElement()
        .accessibilityLabel(
            SOCRouteChartStrings.text(
                "tripPlanner.socChart.aria",
                "Planned route battery state-of-charge area chart"
            )
        )
        .accessibilityValue(
            Text(verbatim: SOCRouteChartAccessibility.chartSummary(
                samples: samples,
                markers: markers,
                minArrivalSoc: minArrivalSoc,
                localize: SOCRouteChartStrings.string,
                locale: locale
            ))
        )
    }

    @ChartContentBuilder
    private var areaMarks: some ChartContent {
        ForEach(samples) { sample in
            AreaMark(
                x: .value(distanceAxisName, sample.distance),
                y: .value(socAxisName, sample.soc)
            )
            .foregroundStyle(areaGradient)
            .interpolationMethod(.monotone)
        }
    }

    @ChartContentBuilder
    private var lineMarks: some ChartContent {
        ForEach(samples) { sample in
            LineMark(
                x: .value(distanceAxisName, sample.distance),
                y: .value(socAxisName, sample.soc)
            )
            .foregroundStyle(Self.socColor)
            .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            .interpolationMethod(.monotone)
        }
    }

    /// The minimum-arrival SOC horizontal reference line (web red `ReferenceLine y`).
    @ChartContentBuilder
    private var minArrivalRule: some ChartContent {
        RuleMark(y: .value(socAxisName, minArrivalSoc))
            .foregroundStyle(Self.minArrivalColor)
            .lineStyle(StrokeStyle(lineWidth: 1, dash: [6, 4]))
            .annotation(position: .top, alignment: .trailing, spacing: 2) {
                SOCRouteChartMinArrivalLabel(minArrivalSoc: minArrivalSoc, locale: locale)
            }
    }

    /// One vertical reference line per charge stop (web blue `ReferenceLine x`).
    @ChartContentBuilder
    private var stopRules: some ChartContent {
        ForEach(markers) { marker in
            RuleMark(x: .value(distanceAxisName, marker.distance))
                .foregroundStyle(Self.stopColor)
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                .annotation(
                    position: .top,
                    spacing: 2,
                    overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                ) {
                    SOCRouteChartStopLabel(marker: marker, locale: locale)
                }
        }
    }

    /// The hover tooltip reference line + card (web `<Tooltip>`).
    @ChartContentBuilder
    private var selectionRule: some ChartContent {
        if let selectedSample {
            RuleMark(x: .value(distanceAxisName, selectedSample.distance))
                .foregroundStyle(Color.TS.border)
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                .annotation(
                    position: .top,
                    overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                ) {
                    SOCRouteChartTooltip(sample: selectedSample, unit: distanceUnit, locale: locale)
                }
        }
    }

    @AxisContentBuilder
    private var xAxis: some AxisContent {
        AxisMarks(position: .bottom) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: SOCRouteChartFormat.distance(number, locale: locale))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    @AxisContentBuilder
    private var yAxis: some AxisContent {
        AxisMarks(position: .leading, values: [0, 25, 50, 75, 100]) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: SOCRouteChartFormat.percent(number, locale: locale))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }
}

// MARK: - Reference-line labels

/// The minimum-arrival reference-line chip (web `Min {n}%`).
struct SOCRouteChartMinArrivalLabel: View {
    let minArrivalSoc: Double
    let locale: Locale

    var body: some View {
        let value = SOCRouteChartFormat.percent(minArrivalSoc, locale: locale)
        let prefix = SOCRouteChartStrings.string("tripPlanner.socChart.min", "Min")
        let long = SOCRouteChartStrings.string("tripPlanner.socChart.minArrivalLong", "minimum arrival")
        return Text(verbatim: "\(prefix) \(value)")
            .font(Font.TS.label)
            .fontWeight(.semibold)
            .monospacedDigit()
            .foregroundStyle(Color.TS.statusDanger)
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, 1)
            .background(Color.TS.statusDanger.opacity(0.12), in: Capsule())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: "\(long) \(value)"))
    }
}

/// One charge-stop reference-line chip (web `⚡ Stop {n}`).
struct SOCRouteChartStopLabel: View {
    let marker: SOCRouteChargeMarker
    let locale: Locale

    var body: some View {
        let stop = SOCRouteChartStrings.string("tripPlanner.socChart.stop", "Stop")
        return HStack(spacing: 2) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 9, weight: .bold))
            Text(verbatim: "\(stop) \(marker.ordinal)")
                .font(Font.TS.label)
                .fontWeight(.semibold)
                .monospacedDigit()
        }
        .foregroundStyle(Color.TS.chartSeriesSpeed)
        .padding(.horizontal, TSSpacing.xs)
        .padding(.vertical, 1)
        .background(Color.TS.chartSeriesSpeed.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(verbatim: SOCRouteChartAccessibility.stopValue(
                marker,
                localize: SOCRouteChartStrings.string,
                locale: locale
            ))
        )
    }
}

// MARK: - Tooltip (web `<Tooltip>`)

/// The hover tooltip: the sample's distance over its SOC percent — the native parity
/// of the web Recharts `<Tooltip>` payload (`{distance} km` / `SOC: {soc}%`).
struct SOCRouteChartTooltip: View {
    let sample: SOCRouteSample
    let unit: String
    let locale: Locale

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: "\(SOCRouteChartFormat.distance(sample.distance, locale: locale)) \(unit)")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            HStack(spacing: TSSpacing.sm) {
                Circle().fill(Color.TS.statusSuccess).frame(width: 7, height: 7)
                SOCRouteChartStrings.text("tripPlanner.socChart.soc", "SOC")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.md)
                Text(verbatim: SOCRouteChartFormat.percent(sample.soc, locale: locale))
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
