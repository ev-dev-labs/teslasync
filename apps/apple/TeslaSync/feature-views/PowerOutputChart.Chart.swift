//
//  PowerOutputChart.Chart.swift
//  TeslaSync — P4 feature view · 0158 · PowerOutputChart (Apple)
//
//  The overlaid Swift Charts area chart (web Recharts `AreaChart` → native
//  `Chart { AreaMark }`) with its selection tooltip (web `ChartTooltip`), the y=0 regen
//  reference line (web `ReferenceLine y={0}`), and the toggleable legend (web
//  `ChartLegend` over `useHiddenSeries`). Split out of Views.swift to keep both files
//  within the file-length budget. Token-driven (P1/S9), localized via P1/S10.
//
//  The two areas are drawn `stacking: .unstacked` so they overlap from the shared
//  baseline exactly like the web translucent fills, rather than forming a stacked area
//  chart. Peak maps to the design-token power color (web #8b5cf6 violet); regen maps to
//  the design-token red (web #ef4444) — the value-exact token for the below-zero trace.
//

import Charts
import SwiftUI

// MARK: - Series styling (web `<Area stroke=… fill=…>`)

/// Series → color/gradient mapping. The web hardcodes #8b5cf6 (peak) and #ef4444 (regen);
/// native binds those to the matching design tokens so light / dark / high-contrast all
/// agree while preserving the violet-up / red-down contrast.
enum PowerOutputStyle {
    static func color(for role: PowerSeriesRole) -> Color {
        switch role {
        case .peak: Color.TS.chartSeriesPower
        case .regen: Color.TS.statusDanger
        }
    }

    /// The translucent area fill (web `areaGradient`): the series color fading to near-
    /// transparent top-to-bottom.
    static func gradient(for role: PowerSeriesRole) -> LinearGradient {
        let base = color(for: role)
        return LinearGradient(
            colors: [base.opacity(0.35), base.opacity(0.02)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    /// The localized series name (web `<Area name={t(...)}>`).
    static func name(for role: PowerSeriesRole) -> String {
        PowerOutputStrings.string(role.nameKey, role.nameFallback)
    }
}

private let powerChartHeight: CGFloat = 300

// MARK: - Area chart (web Recharts overlaid `AreaChart`)

/// The overlaid area chart — the native counterpart of the web Recharts `AreaChart` with
/// one `<Area>` per series. Drives on x, power (kW) on y; a y=0 reference line separates
/// peak from regen, and tapping snaps to the nearest drive and reveals a value tooltip
/// (web `ChartTooltip`).
struct PowerOutputAreaChart: View {
    let series: [PowerOutputSeries]
    let hidden: Set<String>

    @State private var selectedDate: Date?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var visible: [PowerOutputSeries] {
        series.filter { !hidden.contains($0.id) }
    }

    private var dateLabel: String {
        PowerOutputStrings.string("drivetrain.col.date", "Date")
    }

    private var powerLabel: String {
        PowerOutputStrings.string("drivetrain.chart.power", "Power")
    }

    var body: some View {
        Chart {
            ForEach(visible) { item in
                ForEach(item.samples) { sample in
                    AreaMark(
                        x: .value(dateLabel, sample.date),
                        y: .value(powerLabel, sample.kw),
                        series: .value(powerLabel, item.id),
                        stacking: .unstacked
                    )
                    .interpolationMethod(.monotone)
                    .foregroundStyle(PowerOutputStyle.gradient(for: item.role))
                }
                ForEach(item.samples) { sample in
                    LineMark(
                        x: .value(dateLabel, sample.date),
                        y: .value(powerLabel, sample.kw),
                        series: .value(powerLabel, item.id)
                    )
                    .interpolationMethod(.monotone)
                    .lineStyle(StrokeStyle(lineWidth: 1.5))
                    .foregroundStyle(PowerOutputStyle.color(for: item.role))
                }
            }
            RuleMark(y: .value(powerLabel, 0))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 2]))
                .foregroundStyle(Color.TS.textMuted)
            if let snapped = snappedDate {
                RuleMark(x: .value(dateLabel, snapped))
                    .foregroundStyle(Color.TS.border)
                    .annotation(
                        position: .top,
                        overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                    ) {
                        PowerOutputTooltip(date: snapped, series: visible)
                    }
            }
        }
        .chartLegend(.hidden)
        .chartXSelection(value: $selectedDate)
        .chartYAxisLabel(position: .leading, alignment: .center) {
            PowerOutputStrings.text("drivetrain.unitKw", "kW")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
        }
        .chartXAxis { dateAxisMarks() }
        .chartYAxis { valueAxisMarks() }
        .frame(height: powerChartHeight)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: visible)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            PowerOutputStrings.text(
                "drivetrain.powerOutput.aria",
                "Per-drive peak and regen motor power output history area chart"
            )
        )
    }

    /// Snaps the live selection to the nearest sampled drive date so the tooltip reads
    /// exact per-series values at that column.
    private var snappedDate: Date? {
        guard let selectedDate else { return nil }
        let dates = visible.flatMap { $0.samples.map(\.date) }
        return dates.min(by: {
            abs($0.timeIntervalSince(selectedDate)) < abs($1.timeIntervalSince(selectedDate))
        })
    }

    /// Short-date x labels (web `XAxis dataKey="date"`) on the token dashed grid.
    private func dateAxisMarks() -> some AxisContent {
        AxisMarks { mark in
            AxisGridLine(stroke: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                .foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let date = mark.as(Date.self) {
                    Text(verbatim: PowerOutputProjection.shortLabel(for: date))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    /// Muted kW value labels (web `YAxis`) on the token dashed grid.
    private func valueAxisMarks() -> some AxisContent {
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

/// One tooltip row: a series swatch, its name, and its power at the selected drive.
private struct PowerTooltipEntry: Identifiable {
    let id: String
    let name: String
    let role: PowerSeriesRole
    let kw: Double
}

/// The selection tooltip: the drive's short date over each visible series' power at that
/// drive — the native parity of the web `ChartTooltip` payload list.
struct PowerOutputTooltip: View {
    let date: Date
    let series: [PowerOutputSeries]

    private var entries: [PowerTooltipEntry] {
        series.compactMap { item in
            guard let sample = item.samples.first(where: { $0.date == date }) else { return nil }
            return PowerTooltipEntry(
                id: item.id,
                name: PowerOutputStyle.name(for: item.role),
                role: item.role,
                kw: sample.kw
            )
        }
    }

    private var unit: String {
        PowerOutputStrings.string("drivetrain.unitKw", "kW")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: PowerOutputProjection.shortLabel(for: date))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            ForEach(entries) { entry in
                HStack(spacing: TSSpacing.sm) {
                    Circle()
                        .fill(PowerOutputStyle.color(for: entry.role))
                        .frame(width: 7, height: 7)
                    Text(verbatim: entry.name)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                    Spacer(minLength: TSSpacing.md)
                    Text(verbatim: "\(PowerOutputAccessibility.formatPower(entry.kw)) \(unit)")
                        .font(Font.TS.caption)
                        .fontWeight(.semibold)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textPrimary)
                }
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .frame(minWidth: 180, maxWidth: 260, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Toggleable legend (web `ChartLegend` over `useHiddenSeries`)

/// The legend below the chart: a tappable chip per series that hides/shows its trace
/// (web `ChartLegend` driving `useHiddenSeries`). A hidden series dims + strikes through,
/// matching the web's decluttering affordance.
struct PowerOutputLegend: View {
    let series: [PowerOutputSeries]
    let hidden: Set<String>
    let onToggle: (PowerSeriesRole) -> Void

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(series) { item in
                let isHidden = hidden.contains(item.id)
                Button {
                    onToggle(item.role)
                } label: {
                    HStack(spacing: TSSpacing.xs) {
                        RoundedRectangle(cornerRadius: 2, style: .continuous)
                            .fill(PowerOutputStyle.color(for: item.role))
                            .frame(width: 12, height: 8)
                            .opacity(isHidden ? 0.3 : 1)
                            .accessibilityHidden(true)
                        Text(verbatim: PowerOutputStyle.name(for: item.role))
                            .font(Font.TS.caption)
                            .foregroundStyle(isHidden ? Color.TS.textMuted : Color.TS.textSecondary)
                            .strikethrough(isHidden)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: PowerOutputStyle.name(for: item.role)))
                .accessibilityValue(legendStateText(isHidden))
                .accessibilityHint(PowerOutputStrings.text(
                    "drivetrain.legend.hint",
                    "Double tap to toggle this series"
                ))
                .accessibilityAddTraits(isHidden ? .isButton : [.isButton, .isSelected])
            }
            Spacer(minLength: 0)
        }
        .padding(.top, TSSpacing.xs)
        .accessibilityElement(children: .contain)
    }

    private func legendStateText(_ isHidden: Bool) -> Text {
        isHidden
            ? PowerOutputStrings.text("drivetrain.legend.hidden", "Hidden")
            : PowerOutputStrings.text("drivetrain.legend.shown", "Shown")
    }
}

// MARK: - Chart body (chart + legend + VoiceOver value)

/// The content body: the overlaid area chart above its toggleable legend, carrying the
/// VoiceOver value summary for the whole figure.
struct PowerOutputChartBody: View {
    let series: [PowerOutputSeries]
    let hidden: Set<String>
    let summary: String
    let onToggle: (PowerSeriesRole) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            PowerOutputAreaChart(series: series, hidden: hidden)
                .accessibilityValue(Text(verbatim: summary))
            PowerOutputLegend(series: series, hidden: hidden, onToggle: onToggle)
        }
    }
}
