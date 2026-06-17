import Charts
import SwiftUI

// MARK: - Titled chart panel (web `ChartContainer`)

/// A glass panel with a title header wrapping a native Swift Chart (web `ChartContainer`).
struct TripsReplayChartPanel<Content: View>: View {
    let title: LocalizedStringKey
    var subtitle: LocalizedStringKey?
    @ViewBuilder var content: () -> Content

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TSPanelTitle(title)
                    if let subtitle {
                        TSCaption(subtitle)
                    }
                }
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Elevation profile (web `ElevationProfile`)

/// The elevation profile rendered with native Swift Charts — never a web view — with a playhead
/// `RuleMark` synced to `currentIndex` and tap-to-seek into the shared replay clock (web
/// chart-click → `seekTo`). Cumulative distance converts to the user's unit at render (ADR-005).
struct TripsReplayElevationSection: View {
    let model: TripsReplayModel
    @Environment(\.tsUnits) private var units

    private var data: [TripsReplayElevationPoint] { model.elevationData }

    var body: some View {
        TripsReplayChartPanel(title: "replay.elevation.title") {
            if data.count > 1 {
                chart
                    .frame(height: 200)
                    .accessibilityLabel(Text("replay.elevation.aria"))
            } else {
                TSEmptyState(title: "replay.elevation.noData", systemImage: "mountain.2")
                    .frame(maxWidth: .infinity, minHeight: 160)
            }
        }
    }

    private var chart: some View {
        Chart {
            ForEach(data) { point in
                AreaMark(
                    x: .value("distance", distance(point)),
                    y: .value("elevation", point.elevationM)
                )
                .foregroundStyle(TSChartGradient.fill(colorIndex: 2))
                LineMark(
                    x: .value("distance", distance(point)),
                    y: .value("elevation", point.elevationM)
                )
                .foregroundStyle(TSChartPalette.color(at: 2))
                .interpolationMethod(.catmullRom)
            }
            if let cursor = cursorDistance {
                RuleMark(x: .value("playhead", cursor))
                    .foregroundStyle(Color.TS.accent)
                    .lineStyle(StrokeStyle(lineWidth: 2, dash: [4, 2]))
            }
        }
        .chartXAxisLabel { Text(verbatim: units.distance) }
        .tsChartAxes()
        .chartOverlay { proxy in
            TripsReplaySeekOverlay(proxy: proxy) { tappedX in seek(toDistance: tappedX) }
        }
    }

    private func distance(_ point: TripsReplayElevationPoint) -> Double {
        Units.convertDistance(point.cumulativeDistanceM, units)
    }

    private var cursorDistance: Double? {
        guard data.indices.contains(model.currentIndex) else { return nil }
        return distance(data[model.currentIndex])
    }

    private func seek(toDistance value: Double) {
        guard !data.isEmpty else { return }
        let nearest = data.min { abs(distance($0) - value) < abs(distance($1) - value) }
        if let nearest { model.seekTo(index: nearest.index) }
    }
}

// MARK: - Speed + power timeline (web `TripReplayCharts`)

/// The cursor-synced speed & power timeline (web `<TripReplayCharts>`): two native line charts over
/// minutes-since-start, each with a playhead + tap-to-seek. Speed converts to the user's unit;
/// power shows kW (web parity).
struct TripsReplayTimelineSection: View {
    let model: TripsReplayModel
    @Environment(\.tsUnits) private var units

    private var points: [TripsReplayTimelinePoint] { model.timelineData }

    var body: some View {
        TripsReplayChartPanel(title: "replay.timeline.title", subtitle: "replay.timeline.subtitle") {
            if points.count > 1 {
                VStack(spacing: TSSpacing.lg) {
                    TripsReplayLineChart(
                        title: "replay.timeline.speed",
                        unitLabel: units.speed,
                        colorIndex: 0,
                        points: speedPoints,
                        cursorX: cursorTime,
                        onSeekX: seek
                    )
                    TripsReplayLineChart(
                        title: "replay.timeline.power",
                        unitLabel: "kW",
                        colorIndex: 1,
                        points: powerPoints,
                        cursorX: cursorTime,
                        onSeekX: seek
                    )
                }
                .accessibilityLabel(Text("replay.timeline.aria"))
            } else {
                TSEmptyState(title: "replay.timeline.noData", systemImage: "chart.xyaxis.line")
                    .frame(maxWidth: .infinity, minHeight: 160)
            }
        }
    }

    private var speedPoints: [TripsReplayXYPoint] {
        points.map { point in
            TripsReplayXYPoint(
                index: point.index,
                xValue: point.timeMin,
                yValue: Units.convertSpeed(point.speedMps, units)
            )
        }
    }

    private var powerPoints: [TripsReplayXYPoint] {
        points.map { TripsReplayXYPoint(index: $0.index, xValue: $0.timeMin, yValue: $0.powerW / 1000) }
    }

    private var cursorTime: Double? {
        guard points.indices.contains(model.currentIndex) else { return nil }
        return points[model.currentIndex].timeMin
    }

    private func seek(toX value: Double) {
        guard !points.isEmpty else { return }
        let nearest = points.min { abs($0.timeMin - value) < abs($1.timeMin - value) }
        if let nearest { model.seekTo(index: nearest.index) }
    }
}

/// One x/y timeline sample for `TripsReplayLineChart`.
struct TripsReplayXYPoint: Identifiable {
    let index: Int
    let xValue: Double
    let yValue: Double

    var id: Int { index }
}

/// A single titled timeline line chart with a playhead + tap-to-seek overlay.
struct TripsReplayLineChart: View {
    let title: LocalizedStringKey
    let unitLabel: String
    let colorIndex: Int
    let points: [TripsReplayXYPoint]
    let cursorX: Double?
    let onSeekX: (Double) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                TSCaption(title)
                Text(verbatim: "(\(unitLabel))").font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            }
            chart.frame(height: 120)
        }
    }

    private var chart: some View {
        Chart {
            ForEach(points) { point in
                LineMark(x: .value("time", point.xValue), y: .value("value", point.yValue))
                    .foregroundStyle(TSChartPalette.color(at: colorIndex))
                    .interpolationMethod(.catmullRom)
            }
            if let cursorX {
                RuleMark(x: .value("playhead", cursorX))
                    .foregroundStyle(Color.TS.accent)
                    .lineStyle(StrokeStyle(lineWidth: 2, dash: [4, 2]))
            }
        }
        .chartXAxisLabel { Text("replay.timeline.minutesAxis") }
        .tsChartAxes()
        .chartOverlay { proxy in
            TripsReplaySeekOverlay(proxy: proxy, onSeek: onSeekX)
        }
    }
}

// MARK: - Tap-to-seek overlay (web chart `onClick` → `seekToIndex`)

/// A transparent overlay mapping a tap on the plot area to its x-value and forwarding it to
/// `onSeek` (web chart-click seek). Decorative for VoiceOver — the scrubber carries the accessible
/// seek control.
struct TripsReplaySeekOverlay: View {
    let proxy: ChartProxy
    let onSeek: (Double) -> Void

    var body: some View {
        GeometryReader { geometry in
            Rectangle()
                .fill(Color.clear)
                .contentShape(Rectangle())
                .onTapGesture { location in
                    guard let plotFrame = proxy.plotFrame else { return }
                    let origin = geometry[plotFrame].origin
                    if let value: Double = proxy.value(atX: location.x - origin.x) {
                        onSeek(value)
                    }
                }
        }
        .accessibilityHidden(true)
    }
}
