import Charts
import SwiftUI

// The trip-replay elevation profile (web `<ElevationProfile>`). Rendered with native Swift Charts —
// never a web view — with a playhead `RuleMark` synced to `currentIndex` and tap-to-seek into the
// shared replay clock (web chart-click → `seekTo`). The cumulative distance converts to the user's
// distance unit at the render boundary via `Units` (ADR-005). The speed & power timeline is the
// composed canonical `TripReplayCharts` surface (see `TripReplayPage.swift`); this file owns only
// the elevation chart, which the page renders with its own playhead + seek.

// MARK: - Titled chart panel (web `ChartContainer`)

/// A glass panel with a title + optional subtitle header (web `ChartContainer`).
struct TripReplayChartPanel<Content: View>: View {
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

struct TripReplayElevationSection: View {
    let model: TripReplayPageModel
    @Environment(\.tsUnits) private var units

    private var data: [TripReplayElevationPoint] {
        model.elevationData
    }

    var body: some View {
        TripReplayChartPanel(title: "replay.elevation.title") {
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
            TripReplaySeekOverlay(proxy: proxy) { tappedX in
                seek(toDistance: tappedX)
            }
        }
    }

    private func distance(_ point: TripReplayElevationPoint) -> Double {
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

// MARK: - Tap-to-seek overlay (web chart `onClick` → `seekToIndex`)

/// A transparent overlay that maps a tap on the chart plot area to its x-value and forwards it to
/// `onSeek` (web chart-click seek). Decorative for VoiceOver — the scrubber carries the accessible
/// seek control.
struct TripReplaySeekOverlay: View {
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
