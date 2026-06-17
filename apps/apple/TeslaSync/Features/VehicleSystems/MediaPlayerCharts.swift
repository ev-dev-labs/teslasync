//
//  MediaPlayerCharts.swift
//  TeslaSync — P4 feature view · P7 · MediaPlayer (Apple) — Swift Charts
//
//  The three native Swift Charts surfaces (never a WKWebView):
//   • `MediaPlayerRadialGauge` — the volume gauge (web Recharts/SVG `RadialGauge`)
//     drawn as a donut with `SectorMark`: a tinted fill arc over a hairline track,
//     the value centered, the label beneath.
//   • `MediaVolumeAreaChart` — volume over time (web Recharts `AreaChart`) drawn
//     with `AreaMark` + `LineMark` and a vertical gradient fill.
//   • `MediaSourcePieChart` — the source distribution donut (web Recharts
//     `PieChart` with `innerRadius`) drawn with `SectorMark`, one slice per source.
//
//  Series colors come from the shared categorical palette (P1/S9 →
//  `TSChartPalette`); the gauge track + axes come from the design tokens (P2).
//

import Charts
import SwiftUI

// MARK: - Chart — RadialGauge (web `RadialGauge`)

/// The volume donut gauge: a tinted fill arc proportional to `value / maximum`
/// layered over a hairline track, with the value centered and the label below.
/// The web gauge renders no unit suffix (`unit=""`), so only the value shows.
struct MediaPlayerRadialGauge: View {
    let value: Double
    let maximum: Double
    let label: String
    let color: Color

    private var clamped: Double { min(max(value, 0), maximum) }
    private var fraction: Double { maximum > 0 ? clamped / maximum : 0 }

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Chart(sectors) { sector in
                SectorMark(
                    angle: .value("Fraction", sector.amount),
                    innerRadius: .ratio(0.68),
                    angularInset: 1
                )
                .foregroundStyle(sector.color)
                .cornerRadius(3)
            }
            .chartLegend(.hidden)
            .frame(width: 120, height: 120)
            .overlay { centerOverlay }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(label))
            .accessibilityValue(Text(valueText))

            Text(label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }

    private var centerOverlay: some View {
        Text(MediaPlayerFormat.number(clamped, fractionDigits: clamped < 10 ? 1 : 0))
            .font(.system(size: 22, weight: .bold))
            .monospacedDigit()
            .foregroundStyle(Color.TS.textPrimary)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            .padding(.horizontal, TSSpacing.sm)
            .accessibilityHidden(true)
    }

    private var valueText: String {
        "\(MediaPlayerFormat.number(clamped, fractionDigits: 1)) / \(MediaPlayerFormat.number(maximum))"
    }

    private var sectors: [MediaGaugeSector] {
        [
            MediaGaugeSector(id: "fill", amount: fraction, color: color),
            MediaGaugeSector(id: "track", amount: max(0, 1 - fraction), color: Color.TS.border)
        ]
    }
}

/// One slice of the gauge donut (fill or track).
private struct MediaGaugeSector: Identifiable {
    let id: String
    let amount: Double
    let color: Color
}

// MARK: - Chart — Volume over time (web `AreaChart`)

/// The volume-over-time area chart. An `AreaMark` with a vertical gradient fill
/// under a `LineMark` stroke; the X axis is time, the Y axis the volume step,
/// clamped to `[0, maximum]` (web `domain={[0, audio_volume_max]}`). The caller
/// renders an empty state when there are no points, so this view always plots.
struct MediaVolumeAreaChart: View {
    let points: [MediaVolumePoint]
    let maximum: Double

    private var color: Color { TSChartPalette.color(at: 0) }

    var body: some View {
        Chart(points) { point in
            AreaMark(
                x: .value("Time", point.time),
                y: .value("Volume", point.volume)
            )
            .foregroundStyle(areaGradient)
            .interpolationMethod(.monotone)

            LineMark(
                x: .value("Time", point.time),
                y: .value("Volume", point.volume)
            )
            .foregroundStyle(color)
            .lineStyle(StrokeStyle(lineWidth: 2))
            .interpolationMethod(.monotone)
        }
        .chartYScale(domain: 0 ... max(maximum, 1))
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .frame(height: 260)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(accessibilityLabel))
        .accessibilityValue(Text("\(points.count)"))
    }

    private var areaGradient: LinearGradient {
        LinearGradient(
            colors: [color.opacity(0.35), color.opacity(0.02)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    @AxisContentBuilder
    private var xAxis: some AxisContent {
        AxisMarks(values: .automatic(desiredCount: 4)) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let date = value.as(Date.self) {
                    Text(date.formatted(date: .abbreviated, time: .omitted))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    @AxisContentBuilder
    private var yAxis: some AxisContent {
        AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let volume = value.as(Double.self) {
                    Text(MediaPlayerFormat.number(volume))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    private var accessibilityLabel: String {
        String(localized: "translation.Volume over Time", defaultValue: "Volume over Time")
    }
}

// MARK: - GlassPanel 7 — Volume over Time panel

/// The volume-over-time panel (web GlassPanel 7, `lg:col-span-2`): the section
/// header over the area chart, a redacted skeleton while reloading, and a
/// `ContentUnavailableView` when the window holds no volume points.
struct MediaVolumeChartPanel: View {
    let points: [MediaVolumePoint]
    let maximum: Double
    let isLoading: Bool

    var body: some View {
        MediaPlayerCard {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                MediaPlayerSectionHeader(
                    systemImage: "speaker.wave.2",
                    title: String(localized: "translation.Volume over Time", defaultValue: "Volume over Time")
                )
                if isLoading {
                    chartSkeleton
                } else if points.isEmpty {
                    emptyState
                } else {
                    MediaVolumeAreaChart(points: points, maximum: maximum)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var emptyState: some View {
        ContentUnavailableView(
            String(
                localized: "translation.No volume data for this period",
                defaultValue: "No volume data for this period"
            ),
            systemImage: "chart.bar"
        )
        .frame(height: 260)
        .frame(maxWidth: .infinity)
    }

    private var chartSkeleton: some View {
        RoundedRectangle(cornerRadius: TSRadius.md)
            .fill(Color.TS.surface)
            .frame(height: 260)
            .redacted(reason: .placeholder) // parity:allow native shimmer for the chart loading state
    }
}

// MARK: - Chart — Source distribution (web `PieChart`)

/// The source-distribution donut. One `SectorMark` per source slice, the angle
/// proportional to the play count (web `dataKey="value"`), an inner-radius ratio
/// of 0.56 (web 45/80) and an angular inset standing in for `paddingAngle={3}`.
struct MediaSourcePieChart: View {
    let slices: [MediaSourceSlice]

    var body: some View {
        Chart(slices) { slice in
            SectorMark(
                angle: .value("Plays", slice.value),
                innerRadius: .ratio(0.56),
                angularInset: 3
            )
            .cornerRadius(2)
            .foregroundStyle(slice.color)
        }
        .chartLegend(.hidden)
        .frame(height: 200)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(accessibilityLabel))
        .accessibilityValue(Text(accessibilityValue))
    }

    private var accessibilityLabel: String {
        String(localized: "translation.Source Distribution", defaultValue: "Source Distribution")
    }

    private var accessibilityValue: String {
        slices.map { "\($0.name): \($0.value)" }.joined(separator: ", ")
    }
}

// MARK: - GlassPanel 8 — Source Distribution panel

/// The source-distribution panel (web GlassPanel 8): the section header over the
/// donut and a wrapping legend, a redacted skeleton while reloading, and a
/// `ContentUnavailableView` when no source data is available.
struct MediaSourceDistributionPanel: View {
    let slices: [MediaSourceSlice]
    let isLoading: Bool

    private let legendColumns = [GridItem(.adaptive(minimum: 110), spacing: TSSpacing.md)]

    var body: some View {
        MediaPlayerCard {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                MediaPlayerSectionHeader(
                    systemImage: "chart.pie",
                    title: String(localized: "translation.Source Distribution", defaultValue: "Source Distribution"),
                    tint: Color.TS.chartSeriesPower
                )
                if isLoading {
                    chartSkeleton
                } else if slices.isEmpty {
                    emptyState
                } else {
                    MediaSourcePieChart(slices: slices)
                    legend
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var legend: some View {
        LazyVGrid(columns: legendColumns, alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(slices) { slice in
                HStack(spacing: TSSpacing.xs) {
                    Circle()
                        .fill(slice.color)
                        .frame(width: 10, height: 10)
                        .accessibilityHidden(true)
                    Text(slice.name)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                    Text("(\(slice.value))")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text("\(slice.name): \(slice.value)"))
            }
        }
    }

    private var emptyState: some View {
        ContentUnavailableView(
            String(
                localized: "translation.No source data available",
                defaultValue: "No source data available"
            ),
            systemImage: "chart.pie"
        )
        .frame(height: 200)
        .frame(maxWidth: .infinity)
    }

    private var chartSkeleton: some View {
        RoundedRectangle(cornerRadius: TSRadius.md)
            .fill(Color.TS.surface)
            .frame(height: 200)
            .redacted(reason: .placeholder) // parity:allow native shimmer for the chart loading state
    }
}
