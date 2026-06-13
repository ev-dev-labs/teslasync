//
//  AreaChartWrapper.Views.swift
//  TeslaSync — P4 shared surface · 0064 · AreaChartWrapper (Apple)
//
//  The presentational subviews composed by `AreaChartWrapper`, reproducing the web
//  `components/charts/AreaChartWrapper.tsx` body: one gradient-filled area per series (web `<Area>`
//  `type="monotone"`, a vertical 0.3→0 opacity gradient fill, a 2pt stroke line), a shared cartesian
//  grid with formatted x / y axes (web `XAxis` / `YAxis` `tickFormatter`), and a scrub tooltip (web
//  `<Tooltip>`) — plus the P4 leaf chrome (loading skeleton, empty state, query-error retry, freshness
//  chip). All copy arrives pre-localized (P1/S10); colour comes from the web series hex with a P1/S9
//  brand-palette fallback. No networking, no Tailwind.
//

import Charts
import SwiftUI

// MARK: - Series colour (web series `color` → brand-palette fallback)

/// Resolves a series stroke / gradient colour — the verbatim `#rrggbb` when valid, otherwise the
/// index-stable brand chart palette. A dynamic, data-driven colour applied at the SwiftUI boundary,
/// decoded by the pure ``AreaChartPalette``.
func areaChartColor(hex: String, colorIndex: Int) -> Color {
    if let parts = AreaChartPalette.components(forHex: hex) {
        return Color(.sRGB, red: parts.red, green: parts.green, blue: parts.blue, opacity: 1)
    }
    return TSChartPalette.color(at: colorIndex)
}

// MARK: - Chart canvas (web `<AreaChart>` body)

/// The gradient area chart — the parity of the web `<ResponsiveContainer><AreaChart>` body. Draws one
/// unstacked monotone area per series (web `<Area>` gradient fill 0.3→0) topped by a 2pt stroke line,
/// over token-styled x / y axes (web `XAxis` / `YAxis` `tickFormatter`). A drag scrubs a shared cursor
/// (web `<Tooltip>`) that reads out the x label + each series' value at that row.
struct AreaChartCanvas: View {
    let plot: AreaChartPlot
    let height: Double

    @State private var selection: Int?

    private var maxIndex: Int {
        max(0, plot.labels.count - 1)
    }

    var body: some View {
        Chart {
            areaMarks
            lineMarks
            selectionMarks
        }
        .chartXScale(domain: 0 ... maxIndex)
        .chartXAxis(content: xAxis)
        .chartYAxis(content: yAxis)
        .frame(height: height)
        .chartOverlay { proxy in
            GeometryReader { geo in
                Rectangle()
                    .fill(Color.clear)
                    .contentShape(Rectangle())
                    .gesture(scrubGesture(proxy: proxy, geo: geo))
            }
        }
        .accessibilityHidden(true)
    }

    @ChartContentBuilder
    private var areaMarks: some ChartContent {
        ForEach(plot.series) { row in
            ForEach(row.points) { point in
                AreaMark(
                    x: .value("x", point.index),
                    y: .value("y", point.value),
                    stacking: .unstacked
                )
                .interpolationMethod(.monotone)
            }
            .foregroundStyle(areaGradient(for: row))
        }
    }

    @ChartContentBuilder
    private var lineMarks: some ChartContent {
        ForEach(plot.series) { row in
            ForEach(row.points) { point in
                LineMark(
                    x: .value("x", point.index),
                    y: .value("y", point.value),
                    series: .value("series", row.id)
                )
                .interpolationMethod(.monotone)
                .lineStyle(StrokeStyle(lineWidth: 2))
            }
            .foregroundStyle(areaChartColor(hex: row.colorHex, colorIndex: row.colorIndex))
        }
    }

    @ChartContentBuilder
    private var selectionMarks: some ChartContent {
        if let selection, selection >= 0, selection < plot.labels.count {
            RuleMark(x: .value("x", selection))
                .foregroundStyle(Color.TS.textMuted.opacity(0.5))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                .annotation(
                    position: .top,
                    alignment: .center,
                    spacing: 4,
                    overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                ) {
                    AreaChartTooltip(plot: plot, index: selection)
                }
        }
    }

    private func areaGradient(for row: AreaChartSeriesRow) -> LinearGradient {
        let color = areaChartColor(hex: row.colorHex, colorIndex: row.colorIndex)
        return LinearGradient(
            gradient: Gradient(colors: [color.opacity(0.3), color.opacity(0)]),
            startPoint: .top,
            endPoint: .bottom
        )
    }

    @AxisContentBuilder
    private func xAxis() -> some AxisContent {
        AxisMarks(values: .automatic(desiredCount: 4)) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
            AxisValueLabel {
                if let index = value.as(Int.self), index >= 0, index < plot.labels.count {
                    Text(verbatim: plot.labels[index])
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    @AxisContentBuilder
    private func yAxis() -> some AxisContent {
        AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: AreaChartFormat.number(number, format: plot.valueFormat))
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    private func scrubGesture(proxy: ChartProxy, geo: GeometryProxy) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { drag in
                guard let plotFrame = proxy.plotFrame else { return }
                let xPosition = drag.location.x - geo[plotFrame].origin.x
                if let index = proxy.value(atX: xPosition, as: Int.self) {
                    selection = min(max(0, index), maxIndex)
                }
            }
            .onEnded { _ in selection = nil }
    }
}

// MARK: - Tooltip (web `<Tooltip>`)

/// The scrub tooltip — the parity of the web `<Tooltip>`: the x label (web `labelFormatter`) over each
/// series' swatch, label, and value at the scrubbed row (web `formatter` → `[value, series.label]`). A
/// series with no finite point at that row is omitted, exactly as recharts drops a null datum.
struct AreaChartTooltip: View {
    let plot: AreaChartPlot
    let index: Int

    private var label: String {
        guard index >= 0, index < plot.labels.count else { return "" }
        return plot.labels[index]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            ForEach(plot.series) { row in
                if let value = row.points.first(where: { $0.index == index })?.value {
                    HStack(spacing: TSSpacing.xs) {
                        Circle()
                            .fill(areaChartColor(hex: row.colorHex, colorIndex: row.colorIndex))
                            .frame(width: 7, height: 7)
                        Text(verbatim: row.label)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textSecondary)
                        Spacer(minLength: TSSpacing.sm)
                        Text(verbatim: AreaChartFormat.number(value, format: plot.valueFormat))
                            .font(.system(size: 12, weight: .semibold, design: .monospaced))
                            .foregroundStyle(Color.TS.textPrimary)
                    }
                }
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown above the chart when the snapshot is not live — a coloured dot + label
/// that re-requests the data on tap (warning tone for stale, muted tone for offline).
struct AreaChartFreshnessChip: View {
    let freshness: AreaChartFreshness
    let onRefresh: () -> Void

    private var tone: Color {
        freshness.isOffline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle()
                    .fill(tone)
                    .frame(width: 6, height: 6)
                Text(verbatim: freshness.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: freshness.accessibilityLabel))
    }
}

// MARK: - Populated (web rendered chart)

/// The populated chart — the gradient area canvas + the P4 freshness chip, wrapped as one VoiceOver
/// element that reads the chart label + the per-series latest / low / high summary.
struct AreaChartPopulatedView: View {
    let chartAccessibilityLabel: String
    let plot: AreaChartPlot
    let height: Double
    let freshness: AreaChartFreshness?
    let onRefresh: () -> Void

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if let freshness {
                    HStack(spacing: 0) {
                        Spacer(minLength: 0)
                        AreaChartFreshnessChip(freshness: freshness, onRefresh: onRefresh)
                    }
                }
                AreaChartCanvas(plot: plot, height: height)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: chartAccessibilityLabel))
        .accessibilityValue(Text(verbatim: plot.accessibilitySummary))
    }
}

// MARK: - Loading (host fetch → skeleton chart)

/// The skeleton chart shown while the data resolves — a chart-shaped shimmer that mirrors the populated
/// height. Shimmer respects Reduce Motion via the shared `TSSkeleton`.
struct AreaChartLoadingView: View {
    let height: Double

    var body: some View {
        TSSkeleton(height: height, cornerRadius: TSRadius.md)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: AreaChartWrapperStrings.string(
                "areaChart.loadingA11y",
                "Loading chart"
            )))
    }
}

// MARK: - Empty (P4 "never a blank box")

/// The friendly empty state shown when the data resolves with nothing to chart under the `.emptyState`
/// policy — the P4 stand-in for a host that would hide the region, so the standalone surface is never
/// blank.
struct AreaChartEmptyView: View {
    let content: AreaChartEmpty
    let height: Double

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: content.title)
            } icon: {
                Image(systemName: "chart.xyaxis.line")
            }
        } description: {
            Text(verbatim: content.message)
        }
        .frame(minHeight: height)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The query-failure state shown when the data fetch fails — an inline error with a retry affordance
/// (the native peer of the web `QueryError`). Never a blank box (P4).
struct AreaChartErrorView: View {
    let content: AreaChartErrorContent
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: content.message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: AreaChartWrapperStrings.string("areaChart.error.retry", "Retry"))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: content.accessibilityLabel))
    }
}
