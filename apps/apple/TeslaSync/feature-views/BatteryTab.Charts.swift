//
//  BatteryTab.Charts.swift
//  TeslaSync — P4 feature view · 0052 · BatteryTab (Apple)
//
//  The four Swift Charts panels — the native counterparts of the web Recharts blocks in
//  features/analytics/components/analytics/BatteryTab.tsx:
//    • Health Score Timeline   → AreaChart, y-domain [80, 100]              (web `AreaChart`)
//    • Capacity Trend          → LineChart of capacity (watt-hours)         (web `LineChart`)
//    • Range Trend             → LineChart of range in the user's unit      (web `LineChart`)
//    • Degradation & Cycles    → Area (degradation %, left) + Line (cycle   (web `ComposedChart`,
//                                count, right) on independent axes + legend   dual `yAxisId`)
//
//  Each panel reuses `BatteryPanel` (web `GlassPanel` + `SectionTitle`) and the shared chart
//  palette/gradient tokens; the x-axis maps the stable point index back to the web `date.slice(5)`
//  label. The brand series colors mirror the web `CHART_COLORS` indices.
//

import Charts
import SwiftUI

// MARK: - Series palette indices (web `CHART_COLORS[i]`)

private enum BatterySeries {
    static let health = 1
    static let capacity = 0
    static let range = 2
    static let degradation = 5
    static let cycle = 4
}

// MARK: - Shared chart axes

/// Maps the quantitative point index back to the web `date.slice(5)` ("MM-DD") label, thinned to a
/// handful of ticks so dense trends stay legible.
private struct BatteryChartXAxis: ViewModifier {
    let points: [BatteryTrendPoint]

    func body(content: Content) -> some View {
        content.chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 6)) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let label = label(for: value) {
                        Text(verbatim: label)
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
    }

    /// Maps a quantitative axis tick back to its `date.slice(5)` label (nil off the data range).
    private func label(for value: AxisValue) -> String? {
        guard let index = value.as(Int.self) else { return nil }
        return points.first(where: { $0.index == index })?.shortLabel
    }
}

/// A single leading y-axis with the shared abbreviated label formatter (web `axisTick`).
private struct BatteryChartYAxis: ViewModifier {
    func body(content: Content) -> some View {
        content.chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(verbatim: TSChartFormat.axisLabel(number))
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
    }
}

private extension View {
    func batteryChartXAxis(points: [BatteryTrendPoint]) -> some View {
        modifier(BatteryChartXAxis(points: points))
    }

    func batteryChartYAxis() -> some View {
        modifier(BatteryChartYAxis())
    }

    /// Standard chart frame + reduce-motion-aware appearance animation shared by every panel.
    func batteryChartFrame(height: CGFloat, animateOn points: [BatteryTrendPoint], reduceMotion: Bool) -> some View {
        frame(height: height)
            .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: points)
    }
}

// MARK: - Health Score Timeline (web `AreaChart`, domain [80, 100])

/// Gradient area of the battery health score over time, pinned to the web `domain={[80, 100]}`.
struct BatteryHealthTimelinePanel: View {
    let points: [BatteryTrendPoint]
    let domain: ClosedRange<Double>
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        BatteryPanel(titleKey: "analytics.battery.healthTimeline", titleFallback: "Health Score Timeline") {
            Chart {
                ForEach(points) { point in
                    AreaMark(
                        x: .value(BatteryChartLabels.date, point.index),
                        y: .value(BatteryChartLabels.health, point.healthScore)
                    )
                    .foregroundStyle(TSChartGradient.fill(colorIndex: BatterySeries.health))
                }
                ForEach(points) { point in
                    LineMark(
                        x: .value(BatteryChartLabels.date, point.index),
                        y: .value(BatteryChartLabels.health, point.healthScore)
                    )
                    .foregroundStyle(TSChartPalette.color(at: BatterySeries.health))
                    .interpolationMethod(.catmullRom)
                }
            }
            .chartYScale(domain: domain)
            .batteryChartXAxis(points: points)
            .batteryChartYAxis()
            .batteryChartFrame(height: 240, animateOn: points, reduceMotion: reduceMotion)
            .accessibilityLabel(
                BatteryTabStrings.text("analytics.battery.healthTimeline", "Health Score Timeline")
            )
        }
    }
}

// MARK: - Capacity Trend (web `LineChart`, raw watt-hours)

/// Line of the pack capacity over time. The web plots `capacity_wh` directly (watt-hours), so the
/// axis is abbreviated (e.g. "75k"); the energy unit is surfaced on the metric card.
struct BatteryCapacityTrendPanel: View {
    let points: [BatteryTrendPoint]
    let energySymbol: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        BatteryPanel(titleKey: "analytics.battery.capacityTrend", titleFallback: "Capacity Trend") {
            Chart {
                ForEach(points) { point in
                    LineMark(
                        x: .value(BatteryChartLabels.date, point.index),
                        y: .value(BatteryChartLabels.capacity, point.capacityWh)
                    )
                    .foregroundStyle(TSChartPalette.color(at: BatterySeries.capacity))
                    .interpolationMethod(.catmullRom)
                }
            }
            .batteryChartXAxis(points: points)
            .batteryChartYAxis()
            .batteryChartFrame(height: 220, animateOn: points, reduceMotion: reduceMotion)
            .accessibilityLabel(BatteryTabStrings.text("analytics.battery.capacityTrend", "Capacity Trend"))
        }
    }
}

// MARK: - Range Trend (web `LineChart`, converted distance)

/// Line of the estimated range over time, already converted to the user's distance unit by the
/// projector (web `fromKm(range_km)`).
struct BatteryRangeTrendPanel: View {
    let points: [BatteryTrendPoint]
    let distanceSymbol: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        BatteryPanel(titleKey: "analytics.battery.rangeTrend", titleFallback: "Range Trend") {
            Chart {
                ForEach(points) { point in
                    LineMark(
                        x: .value(BatteryChartLabels.date, point.index),
                        y: .value(BatteryChartLabels.range, point.rangeDisplay)
                    )
                    .foregroundStyle(TSChartPalette.color(at: BatterySeries.range))
                    .interpolationMethod(.catmullRom)
                }
            }
            .batteryChartXAxis(points: points)
            .batteryChartYAxis()
            .batteryChartFrame(height: 220, animateOn: points, reduceMotion: reduceMotion)
            .accessibilityLabel(
                Text(verbatim: BatteryChartAccessibility.range(symbol: distanceSymbol))
            )
        }
    }
}

// MARK: - Degradation & Cycles (web `ComposedChart`, dual axis + legend)

/// Degradation % as a gradient area on the left axis with the cycle count as a line on an
/// independent right axis. The cycle series is plotted on the left domain via a normalization so a
/// single Swift `Chart` keeps both axes perfectly aligned; the trailing ticks are relabeled back to
/// real cycle counts.
struct BatteryDegradationCyclesPanel: View {
    let points: [BatteryTrendPoint]
    let degradationMax: Double
    let cycleMax: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var safeDegradationMax: Double {
        max(degradationMax, 0.0001)
    }

    private func normalizedCycle(_ point: BatteryTrendPoint) -> Double {
        guard cycleMax > 0 else { return 0 }
        return safeDegradationMax * (point.cycleCount / cycleMax)
    }

    private var rightAxisTicks: [Double] {
        let count = 4
        return (0 ... count).map { safeDegradationMax * Double($0) / Double(count) }
    }

    private func cycleAxisLabel(forLeftValue value: Double) -> String {
        TSChartFormat.axisLabel(value / safeDegradationMax * cycleMax)
    }

    var body: some View {
        BatteryPanel(titleKey: "analytics.battery.degradationCycles", titleFallback: "Degradation & Cycles") {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                chart
                legend
            }
        }
    }

    private var chart: some View {
        Chart {
            ForEach(points) { point in
                AreaMark(
                    x: .value(BatteryChartLabels.date, point.index),
                    y: .value(BatteryChartLabels.degradation, point.degradationPct)
                )
                .foregroundStyle(TSChartGradient.fill(colorIndex: BatterySeries.degradation))
            }
            ForEach(points) { point in
                LineMark(
                    x: .value(BatteryChartLabels.date, point.index),
                    y: .value(BatteryChartLabels.degradation, point.degradationPct)
                )
                .foregroundStyle(TSChartPalette.color(at: BatterySeries.degradation))
                .interpolationMethod(.catmullRom)
            }
            ForEach(points) { point in
                LineMark(
                    x: .value(BatteryChartLabels.date, point.index),
                    y: .value(BatteryChartLabels.cycles, normalizedCycle(point))
                )
                .foregroundStyle(TSChartPalette.color(at: BatterySeries.cycle))
                .interpolationMethod(.catmullRom)
            }
        }
        .chartYScale(domain: 0 ... safeDegradationMax)
        .batteryChartXAxis(points: points)
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(verbatim: TSChartFormat.axisLabel(number))
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
            AxisMarks(position: .trailing, values: rightAxisTicks) { value in
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(verbatim: cycleAxisLabel(forLeftValue: number))
                            .font(Font.TS.label)
                            .foregroundStyle(TSChartPalette.color(at: BatterySeries.cycle))
                    }
                }
            }
        }
        .batteryChartFrame(height: 240, animateOn: points, reduceMotion: reduceMotion)
        .accessibilityLabel(BatteryTabStrings.text("analytics.battery.degradationCycles", "Degradation & Cycles"))
    }

    private var legend: some View {
        HStack(spacing: TSSpacing.lg) {
            BatteryTabLegendItem(
                colorIndex: BatterySeries.degradation,
                key: "analytics.battery.degradPct",
                fallback: "Degradation %"
            )
            BatteryTabLegendItem(
                colorIndex: BatterySeries.cycle,
                key: "analytics.battery.cycleCount",
                fallback: "Cycle Count"
            )
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

/// One legend swatch + localized series name (web `<Legend/>` entry).
private struct BatteryTabLegendItem: View {
    let colorIndex: Int
    let key: String
    let fallback: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(TSChartPalette.color(at: colorIndex))
                .frame(width: 8, height: 8)
            BatteryTabStrings.text(key, fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
    }
}

// MARK: - Localized chart data labels + accessibility

/// Localized axis/series descriptors fed to Swift Charts `.value(_:_:)` so VoiceOver and the audio
/// graph read localized names — never hardcoded English.
enum BatteryChartLabels {
    static var date: String {
        BatteryTabStrings.string("analytics.battery.date", "Date")
    }

    static var health: String {
        BatteryTabStrings.string("analytics.battery.health", "Health %")
    }

    static var capacity: String {
        BatteryTabStrings.string("analytics.battery.capacity", "Capacity")
    }

    static var range: String {
        BatteryTabStrings.string("analytics.battery.range", "Range")
    }

    static var degradation: String {
        BatteryTabStrings.string("analytics.battery.degradPct", "Degradation %")
    }

    static var cycles: String {
        BatteryTabStrings.string("analytics.battery.cycleCount", "Cycle Count")
    }
}

enum BatteryChartAccessibility {
    /// "Range Trend (mi)" — the Range chart's accessibility label includes the active unit, matching
    /// the web series name `${t('…range')} (${distanceUnit})`.
    static func range(symbol: String) -> String {
        "\(BatteryTabStrings.string("analytics.battery.rangeTrend", "Range Trend")) (\(symbol))"
    }
}
