//
//  SessionComparisonChart.Chart.swift
//  TeslaSync — P4 feature view · 0089 · SessionComparisonChart (Apple)
//
//  The overlaid Swift Charts line chart (web Recharts `LineChart` → native
//  `Chart { LineMark }`) with its selection tooltip (web `ChartTooltip`) and the
//  wrapping legend (web flex-wrap date swatches), plus the series styling that maps
//  each session to a brand-palette color. Split out of Views.swift to keep both files
//  within the file-length budget. Token-driven (P1/S9), localized via P1/S10.
//

import Charts
import SwiftUI

// MARK: - Series styling (web `useChartPalette()[i % n]`)

/// Series → fill mapping. The web indexes the user's chart palette by session order;
/// native uses the index-stable brand palette (`TSChartPalette`, the same Okabe-Ito
/// set the web CB-safe default resolves to) so light / dark / high-contrast agree.
enum ComparisonStyle {
    static func color(for series: ComparisonSeries) -> Color {
        TSChartPalette.color(at: series.colorIndex)
    }

    /// The composed series name (web `<Line name={`{date} ({charger})`}>`).
    static func displayName(for series: ComparisonSeries) -> String {
        let charger = SessionComparisonStrings.string(series.charger.localizationKey, series.charger.fallback)
        return "\(series.dateLabel) (\(charger))"
    }
}

// MARK: - Chart (web Recharts overlaid `LineChart`)

/// The overlaid line chart — the native counterpart of the web Recharts `LineChart`
/// with one `<Line>` per session. SOC on x ("SOC (%)"), power on y ("Power (kW)");
/// tapping snaps to the nearest SOC and reveals a value tooltip (web `ChartTooltip`).
struct SessionComparisonCurveChart: View {
    let series: [ComparisonSeries]

    @State private var selectedSoc: Double?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var socLabel: String {
        SessionComparisonStrings.string("charging.curve.chart.soc", "SOC")
    }

    private var powerLabel: String {
        SessionComparisonStrings.string("charging.curve.chart.power", "Power")
    }

    private var seriesLabel: String {
        SessionComparisonStrings.string("charging.curve.chart.series", "Session")
    }

    var body: some View {
        Chart {
            ForEach(series) { item in
                ForEach(item.points) { point in
                    LineMark(
                        x: .value(socLabel, point.soc),
                        y: .value(powerLabel, point.powerKw)
                    )
                    .interpolationMethod(.monotone)
                    .lineStyle(StrokeStyle(lineWidth: 1.5))
                    .foregroundStyle(by: .value(seriesLabel, item.id))
                }
            }
            if let snapped = snappedSoc {
                RuleMark(x: .value(socLabel, snapped))
                    .foregroundStyle(Color.TS.border)
                    .annotation(
                        position: .top,
                        overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                    ) {
                        SessionComparisonTooltip(soc: snapped, series: series)
                    }
            }
        }
        .chartForegroundStyleScale(domain: series.map(\.id), range: series.map(ComparisonStyle.color))
        .chartLegend(.hidden)
        .chartXSelection(value: $selectedSoc)
        .chartXAxisLabel(position: .bottom, alignment: .trailing) {
            SessionComparisonStrings.text("charging.curve.socPercent", "SOC (%)")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
        }
        .chartYAxisLabel(position: .leading, alignment: .center) {
            SessionComparisonStrings.text("charging.curve.powerKw", "Power (kW)")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
        }
        .chartXAxis { axisMarks() }
        .chartYAxis { axisMarks() }
        .frame(height: 260)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: series)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            SessionComparisonStrings.text(
                "charging.curve.sessionComparison.aria",
                "Overlaid power-vs-SOC line chart comparing the last several charging sessions"
            )
        )
    }

    /// Snaps the live selection to the nearest sampled SOC (selection lands on a
    /// continuous axis; the tooltip reads exact per-series values at that column).
    private var snappedSoc: Double? {
        guard let selectedSoc else { return nil }
        let socs = Set(series.flatMap { $0.points.map(\.soc) })
        return socs.min(by: { abs($0 - selectedSoc) < abs($1 - selectedSoc) })
    }

    /// Shared dashed grid + muted value labels (web `chartGrid` "3 3" + `axisTickSm`).
    private func axisMarks() -> some AxisContent {
        AxisMarks { mark in
            AxisGridLine(stroke: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                .foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let number = mark.as(Double.self) {
                    Text(verbatim: "\(Int(number.rounded()))")
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }
}

// MARK: - Tooltip (web `ChartTooltip`)

/// One tooltip row: a series swatch, its name, and its power at the selected SOC.
private struct ComparisonTooltipEntry: Identifiable {
    let id: String
    let name: String
    let colorIndex: Int
    let powerKw: Double
}

/// The selection tooltip: the SOC column header over each session's power at that
/// SOC, the native parity of the web `ChartTooltip` payload list.
struct SessionComparisonTooltip: View {
    let soc: Double
    let series: [ComparisonSeries]

    private var entries: [ComparisonTooltipEntry] {
        series.compactMap { item in
            guard let point = item.points.first(where: { $0.soc == soc }) else { return nil }
            return ComparisonTooltipEntry(
                id: item.id,
                name: ComparisonStyle.displayName(for: item),
                colorIndex: item.colorIndex,
                powerKw: point.powerKw
            )
        }
    }

    private var unit: String {
        SessionComparisonStrings.string("charging.curve.unitKw", "kW")
    }

    private var header: String {
        let soc = SessionComparisonStrings.string("charging.curve.chart.soc", "SOC")
        return "\(Int(self.soc.rounded()))% \(soc)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: header)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            ForEach(entries) { entry in
                HStack(spacing: TSSpacing.sm) {
                    Circle()
                        .fill(TSChartPalette.color(at: entry.colorIndex))
                        .frame(width: 7, height: 7)
                    Text(verbatim: entry.name)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                    Spacer(minLength: TSSpacing.md)
                    Text(verbatim: "\(ComparisonAccessibility.formatPower(entry.powerKw)) \(unit)")
                        .font(Font.TS.caption)
                        .fontWeight(.semibold)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textPrimary)
                }
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .frame(minWidth: 168, maxWidth: 240, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Legend (web flex-wrap date swatches)

/// The wrapping legend below the chart (web `<div className="flex flex-wrap">`): a
/// colored swatch + the short date for each overlaid session.
struct SessionComparisonLegend: View {
    let series: [ComparisonSeries]

    var body: some View {
        ComparisonFlowLayout(spacing: TSSpacing.md, lineSpacing: TSSpacing.xs) {
            ForEach(series) { item in
                HStack(spacing: TSSpacing.xs) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(ComparisonStyle.color(for: item))
                        .frame(width: 12, height: 8)
                    Text(verbatim: item.dateLabel)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text(verbatim: legendLabel(item)))
            }
        }
    }

    private func legendLabel(_ item: ComparisonSeries) -> String {
        ComparisonAccessibility.seriesLabel(item, localize: SessionComparisonStrings.string)
    }
}

/// A minimal wrapping flow layout (no native SwiftUI equivalent) for the legend
/// chips, so they reflow across lines like the web flex-wrap row.
struct ComparisonFlowLayout: Layout {
    var spacing: CGFloat = TSSpacing.md
    var lineSpacing: CGFloat = TSSpacing.xs

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var cursorX: CGFloat = 0
        var cursorY: CGFloat = 0
        var rowHeight: CGFloat = 0
        var widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if cursorX > 0, cursorX + size.width > maxWidth {
                cursorY += rowHeight + lineSpacing
                cursorX = 0
                rowHeight = 0
            }
            cursorX += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, cursorX - spacing)
        }
        return CGSize(width: min(widest, maxWidth), height: cursorY + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
        var cursorX = bounds.minX
        var cursorY = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if cursorX > bounds.minX, cursorX + size.width > bounds.maxX {
                cursorY += rowHeight + lineSpacing
                cursorX = bounds.minX
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: cursorX, y: cursorY), anchor: .topLeading, proposal: ProposedViewSize(size))
            cursorX += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
