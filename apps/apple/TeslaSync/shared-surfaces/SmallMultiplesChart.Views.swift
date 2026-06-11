//
//  SmallMultiplesChart.Views.swift
//  TeslaSync — P4 shared surface · 0073 · SmallMultiplesChart (Apple)
//
//  The presentational subviews composed by `SmallMultiplesChart`, reproducing the web
//  `components/charts/SmallMultiplesChart.tsx` body: the per-series grid of mini line charts (each an
//  independent `Chart` so its y-scale auto-fits one series), the per-cell swatch + label, the per-cell
//  `'No data'` fallback, the optional tap-to-drill-in (web `onCellClick`), and the shared
//  cross-cell crosshair (web `syncId`) — plus the P4 leaf chrome (loading skeleton, empty state,
//  query-error retry, freshness chip). All copy arrives pre-localized (P1/S10); colour comes from the
//  P1/S9 tokens; the web `useInView` lazy-mount is the native `LazyVGrid`. No networking, no Tailwind.
//

import Charts
import SwiftUI

// MARK: - Series colour (web series `color` → brand-palette fallback)

/// Resolves a series swatch / line colour — the verbatim `#rrggbb` when present + valid, otherwise
/// the index-stable brand chart palette. A dynamic, data-driven colour applied at the SwiftUI
/// boundary, decoded by the pure ``SmallMultiplesPalette``.
func smallMultiplesColor(hex: String?, colorIndex: Int) -> Color {
    if let parts = SmallMultiplesPalette.components(forHex: hex) {
        return Color(.sRGB, red: parts.red, green: parts.green, blue: parts.blue, opacity: 1)
    }
    return TSChartPalette.color(at: colorIndex)
}

// MARK: - Cell chart (web per-cell `LineChart`)

/// One cell's mini line chart — an independent `Chart` so its y-scale auto-fits this series alone (the
/// web per-cell y-scale that stops disparate magnitudes flattening one another). Draws the monotone
/// line (web `type="monotone"`, `dot={false}`), the per-cell time x-axis (web `formatTime`
/// `tickFormatter`), and — when the shared scrub date lands within this cell's domain — the synced
/// crosshair rule + the local value readout (web `syncId` cursor with per-cell tooltips).
struct SmallMultiplesCellChart: View {
    let cell: SmallMultiplesCellRow
    let height: Double
    let selection: Date?
    let onScrub: (Date?) -> Void

    private var color: Color {
        smallMultiplesColor(hex: cell.colorHex, colorIndex: cell.colorIndex)
    }

    /// The point nearest the shared scrub date, but only while the date is inside this cell's domain —
    /// so cells whose series has no sample at that timestamp simply show no crosshair (web per-cell).
    private var crosshair: SmallMultiplesPoint? {
        guard
            let selection,
            let first = cell.points.first?.date,
            let last = cell.points.last?.date,
            selection >= first, selection <= last
        else {
            return nil
        }
        return cell.points.min {
            abs($0.date.timeIntervalSince(selection)) < abs($1.date.timeIntervalSince(selection))
        }
    }

    var body: some View {
        Chart {
            ForEach(cell.points) { point in
                LineMark(
                    x: .value("time", point.date),
                    y: .value("value", point.value)
                )
                .interpolationMethod(.monotone)
                .foregroundStyle(color)
                .lineStyle(StrokeStyle(lineWidth: 1.5))
            }
            if let crosshair {
                RuleMark(x: .value("time", crosshair.date))
                    .foregroundStyle(Color.TS.textMuted.opacity(0.6))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                PointMark(
                    x: .value("time", crosshair.date),
                    y: .value("value", crosshair.value)
                )
                .foregroundStyle(color)
                .symbolSize(36)
                .annotation(position: .top, alignment: .center, spacing: 2) {
                    Text(verbatim: SmallMultiplesAxis.numberLabel(crosshair.value))
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .foregroundStyle(Color.TS.textSecondary)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(.regularMaterial, in: Capsule())
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(verbatim: SmallMultiplesAxis.numberLabel(number))
                    }
                }
            }
        }
        .chartXAxis(content: xAxisContent)
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

    private func scrubGesture(proxy: ChartProxy, geo: GeometryProxy) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { drag in
                guard let plotFrame = proxy.plotFrame else { return }
                let xPosition = drag.location.x - geo[plotFrame].origin.x
                if let date = proxy.value(atX: xPosition, as: Date.self) {
                    onScrub(date)
                }
            }
            .onEnded { _ in onScrub(nil) }
    }

    @AxisContentBuilder
    private func xAxisContent() -> some AxisContent {
        AxisMarks(values: .automatic(desiredCount: 3)) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
            AxisValueLabel {
                if let date = value.as(Date.self) {
                    Text(verbatim: SmallMultiplesAxis.timeLabel(date))
                }
            }
        }
    }
}

// MARK: - Cell (web cell — swatch + label, chart or `'No data'` fallback, drill-in)

/// One grid cell — the swatch + verbatim label header over either the mini line chart or the per-cell
/// `'No data'` fallback. When interactive (web `onCellClick` present) the whole cell is a button
/// that drills into the series and highlights its border on hover; when passive it is a static group.
/// VoiceOver reads the series name, its latest/low/high summary (or the empty copy), and — interactive
/// only — the drill-in hint.
struct SmallMultiplesCellView: View {
    let cell: SmallMultiplesCellRow
    let height: Double
    let selection: Date?
    let onScrub: (Date?) -> Void
    let onSelect: () -> Void

    @State private var hovering = false

    private var color: Color {
        smallMultiplesColor(hex: cell.colorHex, colorIndex: cell.colorIndex)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
                .accessibilityHidden(true)
            Text(verbatim: cell.label)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(color)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(.horizontal, TSSpacing.xs)
    }

    @ViewBuilder
    private var chartArea: some View {
        if cell.hasData {
            SmallMultiplesCellChart(
                cell: cell,
                height: height,
                selection: selection,
                onScrub: onScrub
            )
        } else {
            Text(verbatim: cell.emptyLabel)
                .font(.system(size: 10))
                .foregroundStyle(Color.TS.textMuted)
                .frame(maxWidth: .infinity)
                .frame(height: height)
        }
    }

    private var cellBody: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            header
            chartArea
        }
        .padding(TSSpacing.sm)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(borderColor, lineWidth: 1)
        )
    }

    private var borderColor: Color {
        if cell.isInteractive, hovering {
            return Color.TS.accent
        }
        return Color.TS.border
    }

    var body: some View {
        if cell.isInteractive {
            Button(action: onSelect) {
                cellBody
            }
            .buttonStyle(.plain)
            .onHover { hovering = $0 }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: cell.accessibilityLabel))
            .accessibilityValue(Text(verbatim: cell.accessibilityValue))
            .accessibilityHint(Text(verbatim: cell.accessibilityHint ?? ""))
            .accessibilityAddTraits(.isButton)
        } else {
            cellBody
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: cell.accessibilityLabel))
                .accessibilityValue(Text(verbatim: cell.accessibilityValue))
        }
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown above the grid when the snapshot is not live — a coloured dot + label
/// that re-requests the data on tap (warning tone for stale, muted tone for offline).
struct SmallMultiplesFreshnessChip: View {
    let freshness: SmallMultiplesFreshness
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

// MARK: - Grid columns (web responsive grid → SwiftUI GridItem)

/// Builds the `LazyVGrid` columns — a fixed count (web `repeat(columns, 1fr)`) or an adaptive minimum
/// width (web `auto-fill minmax(cellMinWidth, 1fr)`).
func smallMultiplesGridItems(for layout: SmallMultiplesLayout) -> [GridItem] {
    if let columns = layout.columns, columns > 0 {
        return Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: columns)
    }
    return [GridItem(.adaptive(minimum: CGFloat(layout.cellMinWidth)), spacing: TSSpacing.md)]
}

// MARK: - Populated (web rendered grid)

/// The populated grid — per-cell mini charts + the P4 freshness chip, sharing one scrub selection so
/// the crosshair stays synced across cells (web `syncId`); off-screen cells lazy-mount via `LazyVGrid`.
struct SmallMultiplesPopulatedView: View {
    let gridAccessibilityLabel: String
    let layout: SmallMultiplesLayout
    let freshness: SmallMultiplesFreshness?
    let cells: [SmallMultiplesCellRow]
    let onRefresh: () -> Void
    let onSelect: (String) -> Void

    @State private var selection: Date?

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if let freshness {
                    HStack(spacing: 0) {
                        Spacer(minLength: 0)
                        SmallMultiplesFreshnessChip(freshness: freshness, onRefresh: onRefresh)
                    }
                }
                LazyVGrid(columns: smallMultiplesGridItems(for: layout), spacing: TSSpacing.md) {
                    ForEach(cells) { cell in
                        SmallMultiplesCellView(
                            cell: cell,
                            height: layout.cellHeight,
                            selection: selection,
                            onScrub: { selection = $0 },
                            onSelect: { onSelect(cell.id) }
                        )
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: gridAccessibilityLabel))
    }
}

// MARK: - Loading (host fetch → skeleton grid)

/// The skeleton grid shown while the data resolves — a grid of cell-shaped shimmers that mirror the
/// populated layout. Shimmer respects Reduce Motion via the shared `TSSkeleton`.
struct SmallMultiplesLoadingView: View {
    let layout: SmallMultiplesLayout

    var body: some View {
        LazyVGrid(columns: smallMultiplesGridItems(for: layout), spacing: TSSpacing.md) {
            ForEach(0 ..< 4, id: \.self) { _ in
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TSSkeleton(width: 72, height: 12)
                    TSSkeleton(height: layout.cellHeight, cornerRadius: TSRadius.sm)
                }
                .padding(TSSpacing.sm)
                .background(
                    Color.TS.surfaceGlass,
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: SmallMultiplesStrings.string(
            "smallMultiples.loadingA11y",
            "Loading chart"
        )))
    }
}

// MARK: - Empty (P4 "never a blank box")

/// The friendly empty state shown when the data resolves with no series under the `.emptyState`
/// policy — the P4 stand-in for the web empty-grid collapse, so the standalone surface is never blank.
struct SmallMultiplesEmptyView: View {
    let content: SmallMultiplesEmpty

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
    }
}

// MARK: - Error (web `QueryError` peer)

/// The query-failure state shown when the data fetch fails — an inline error with a retry affordance
/// (the native peer of the web `QueryError`). Never a blank box (P4).
struct SmallMultiplesErrorView: View {
    let content: SmallMultiplesErrorContent
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
                Text(verbatim: SmallMultiplesStrings.string("smallMultiples.error.retry", "Retry"))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: content.accessibilityLabel))
    }
}
