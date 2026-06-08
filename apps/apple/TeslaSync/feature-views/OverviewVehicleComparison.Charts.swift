//
//  OverviewVehicleComparison.Charts.swift
//  TeslaSync — P4 feature view · 0060 · OverviewVehicleComparison (Apple)
//
//  The data-visualization leaves: the efficiency-leaderboard fill row (web
//  progress `div`), the series legend, the multi-vehicle radar (web `RadarChart`,
//  drawn with `Canvas` since Swift Charts has no radar mark — one polygon per
//  vehicle over the shared Distance / Energy / Drives / Efficiency axes), and the
//  grouped energy/activity bar chart (web `BarChart`, a Swift Charts `BarMark`
//  grouped by series over a categorical vehicle axis). Colors come from the brand
//  palette (P1/S9) so the indices line up 1:1 with the web `CHART_COLORS`.
//

import Charts
import SwiftUI

// MARK: - Efficiency leaderboard row (web progress `div`)

/// One leaderboard row: a "#rank name" line over a fill bar whose width is the
/// efficiency percent. The bar grows in on appear (web `transition-all
/// duration-slow`), honoring Reduce Motion.
struct OverviewLeaderboardRow: View {
    let entry: OverviewLeaderboardEntry

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var grown = false

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: "#\(entry.rank) \(entry.name)")
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: entry.efficiencyText)
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textMuted)
            }
            fillBar
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: OverviewComparisonAccessibility.leaderboardLabel(entry)))
        .onAppear { grown = true }
    }

    private var fillBar: some View {
        GeometryReader { geometry in
            let fraction = max(0, min(entry.pct, 100)) / 100
            ZStack(alignment: .leading) {
                Capsule().fill(Color.TS.border.opacity(0.4))
                Capsule()
                    .fill(Color.TS.accent)
                    .frame(width: geometry.size.width * (grown ? fraction : 0))
                    .animation(TSAnimation.slow(reduceMotion: reduceMotion), value: grown)
            }
        }
        .frame(height: 8)
    }
}

// MARK: - Series / vehicle legend

/// One colored legend entry (a vehicle on the radar, or a series on the bars).
struct OverviewLegendItem: Identifiable, Equatable {
    let id: String
    let name: String
    let colorIndex: Int
}

/// A compact, horizontally scrolling legend: a color swatch + name per item. The
/// native counterpart of the web chart `Legend` (and the radar, which the web omits
/// a legend for — added here so touch / VoiceOver users can map color → vehicle).
struct OverviewComparisonLegend: View {
    let items: [OverviewLegendItem]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.md) {
                ForEach(items) { item in
                    HStack(spacing: TSSpacing.xs) {
                        Circle()
                            .fill(TSChartPalette.color(at: item.colorIndex))
                            .frame(width: 8, height: 8)
                        Text(verbatim: item.name)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textSecondary)
                            .lineLimit(1)
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Multi-vehicle radar (web `RadarChart`)

/// The vehicle-comparison radar: the shared grid + spokes drawn once, one filled
/// polygon per vehicle (colored from the palette), the four metric labels at the
/// cardinal points, and a legend below. A `Canvas` reproduction of the web Recharts
/// `RadarChart` (which has no native Swift Charts mark).
struct OverviewComparisonRadar: View {
    let vehicles: [OverviewRadarVehicle]

    private var legendItems: [OverviewLegendItem] {
        vehicles.enumerated().map { offset, vehicle in
            OverviewLegendItem(id: String(vehicle.id), name: vehicle.name, colorIndex: offset)
        }
    }

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ZStack {
                canvas
                axisLabels
            }
            .frame(height: OverviewMetrics.chartHeight)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: summary))
            OverviewComparisonLegend(items: legendItems)
        }
    }

    private var canvas: some View {
        Canvas { context, size in
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let maxRadius = min(size.width, size.height) / 2 - 24
            guard maxRadius > 0 else { return }
            Self.drawGrid(context: context, center: center, maxRadius: maxRadius)
            for (offset, vehicle) in vehicles.enumerated() {
                let path = Self.dataPolygon(vehicle: vehicle, center: center, maxRadius: maxRadius)
                let color = TSChartPalette.color(at: offset)
                context.fill(path, with: .color(color.opacity(0.18)))
                context.stroke(path, with: .color(color), lineWidth: 2)
            }
        }
    }

    private var axisLabels: some View {
        ZStack {
            VStack {
                metricLabel(.distance)
                Spacer()
                metricLabel(.drives)
            }
            HStack {
                metricLabel(.efficiency)
                Spacer()
                metricLabel(.energy)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityHidden(true)
    }

    private func metricLabel(_ metric: OverviewRadarMetric) -> some View {
        Text(verbatim: OverviewComparisonAccessibility.radarMetricLabel(metric))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(1)
    }

    private var summary: String {
        vehicles.map(OverviewComparisonAccessibility.radarVehicleLabel).joined(separator: "; ")
    }
}

// MARK: Radar geometry (mirrors the shared `TSRadarChart` math)

extension OverviewComparisonRadar {
    private static let axisCount = OverviewRadarMetric.allCases.count

    static func drawGrid(context: GraphicsContext, center: CGPoint, maxRadius: CGFloat) {
        for fraction in [0.25, 0.5, 0.75, 1.0] {
            context.stroke(
                polygon(fraction: fraction, center: center, maxRadius: maxRadius),
                with: .color(Color.TS.border.opacity(0.3)),
                lineWidth: 1
            )
        }
        for index in 0 ..< axisCount {
            var spoke = Path()
            spoke.move(to: center)
            spoke.addLine(to: vertex(index: index, fraction: 1, center: center, maxRadius: maxRadius))
            context.stroke(spoke, with: .color(Color.TS.border.opacity(0.2)), lineWidth: 1)
        }
    }

    static func dataPolygon(vehicle: OverviewRadarVehicle, center: CGPoint, maxRadius: CGFloat) -> Path {
        var path = Path()
        for (index, metric) in OverviewRadarMetric.allCases.enumerated() {
            let fraction = min(max(OverviewComparisonBuilder.radarValue(vehicle, metric: metric), 0), 1)
            let point = vertex(index: index, fraction: fraction, center: center, maxRadius: maxRadius)
            if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        path.closeSubpath()
        return path
    }

    static func vertex(index: Int, fraction: Double, center: CGPoint, maxRadius: CGFloat) -> CGPoint {
        let angle = (Double(index) / Double(axisCount)) * 2 * .pi - .pi / 2
        let radius = maxRadius * fraction
        return CGPoint(x: center.x + cos(angle) * radius, y: center.y + sin(angle) * radius)
    }

    static func polygon(fraction: Double, center: CGPoint, maxRadius: CGFloat) -> Path {
        var path = Path()
        for index in 0 ..< axisCount {
            let point = vertex(index: index, fraction: fraction, center: center, maxRadius: maxRadius)
            if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        path.closeSubpath()
        return path
    }
}

// MARK: - Energy & Activity grouped bars (web `BarChart`)

/// The energy/activity chart: per-vehicle Energy (kWh) and Drives bars, grouped by
/// series over a categorical vehicle axis. A Swift Charts `BarMark` reproduction of
/// the web Recharts grouped `BarChart` (energy = `CHART_COLORS[1]`, drives =
/// `CHART_COLORS[3]`).
struct OverviewEnergyActivityChart: View {
    let bars: [OverviewActivityBar]

    private struct Datum: Identifiable {
        let id: String
        let vehicle: String
        let series: String
        let value: Double
    }

    private var energyName: String {
        OverviewComparisonStrings.string("analytics.overview.energykWh", "Energy (kWh)")
    }

    private var drivesName: String {
        OverviewComparisonStrings.string("analytics.overview.drives", "Drives")
    }

    private var data: [Datum] {
        bars.flatMap { bar in
            [
                Datum(id: "\(bar.id)-energy", vehicle: bar.name, series: energyName, value: bar.energyKwh),
                Datum(id: "\(bar.id)-drives", vehicle: bar.name, series: drivesName, value: bar.drives)
            ]
        }
    }

    var body: some View {
        Chart(data) { datum in
            BarMark(
                x: .value("vehicle", datum.vehicle),
                y: .value("value", datum.value)
            )
            .position(by: .value("series", datum.series))
            .foregroundStyle(by: .value("series", datum.series))
            .cornerRadius(4)
        }
        .chartForegroundStyleScale(domain: [energyName, drivesName], range: seriesColors)
        .chartLegend(.visible)
        .chartXAxis { axisX }
        .chartYAxis { axisY }
        .frame(height: OverviewMetrics.chartHeight)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: summary))
    }

    private var seriesColors: [Color] {
        [
            TSChartPalette.color(at: OverviewComparisonBuilder.energyColorIndex),
            TSChartPalette.color(at: OverviewComparisonBuilder.drivesColorIndex)
        ]
    }

    private var summary: String {
        bars.map(OverviewComparisonAccessibility.activityLabel).joined(separator: "; ")
    }

    @AxisContentBuilder
    private var axisX: some AxisContent {
        AxisMarks { value in
            AxisValueLabel {
                if let label = value.as(String.self) {
                    Text(verbatim: label)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    @AxisContentBuilder
    private var axisY: some AxisContent {
        AxisMarks(position: .leading) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.5))
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: TSChartFormat.axisLabel(number))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }
}
