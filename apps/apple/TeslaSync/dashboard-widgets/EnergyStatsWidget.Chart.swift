//
//  EnergyStatsWidget.Chart.swift
//  TeslaSync — P4 dashboard widget · 0048 · EnergyStatsWidget (Apple)
//
//  Presentation pieces for the energy-stats surface: the Swift Charts gradient
//  area chart (web Recharts `AreaChart` of the daily breakdown) and the stat-card
//  grid (web `WidgetStatGrid` → `StatCard`). Kept out of the main surface file so
//  the shell/phase logic stays readable. No networking here.
//

import Charts
import SwiftUI

// MARK: - Stat item (web `StatGridItem`)

/// One metric cell in the grid (web `StatGridItem`). `value` is pre-formatted;
/// `unit` is an optional trailing unit chip; `systemImage` is the SF Symbol that
/// stands in for the web Lucide icon.
public struct EnergyStatItem: Identifiable, Equatable {
    public let id: String
    public let label: String
    public let value: String
    public let unit: String?
    public let systemImage: String

    public init(id: String, label: String, value: String, unit: String? = nil, systemImage: String) {
        self.id = id
        self.label = label
        self.value = value
        self.unit = unit
        self.systemImage = systemImage
    }

    /// The flattened "label value unit" string spoken by VoiceOver.
    public var accessibilityText: String {
        [label, value, unit].compactMap(\.self).joined(separator: " ")
    }
}

// MARK: - Stat grid (web `WidgetStatGrid` → `StatCard`)

/// The responsive stat-card grid (web 2-up / 3-up `WidgetStatGrid`). Columns are
/// fixed at the resolved web count; cells wrap into rows as the widget grows.
struct EnergyStatGrid: View {
    let stats: [EnergyStatItem]
    /// Resolved column count — web `cols={isWide ? 3 : 2}`.
    let columns: Int

    private var gridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: max(columns, 1))
    }

    var body: some View {
        LazyVGrid(columns: gridColumns, spacing: TSSpacing.sm) {
            ForEach(stats) { stat in
                EnergyStatCard(stat: stat)
            }
        }
    }
}

/// One stat card (web `StatCard`): the label + icon header over a monospaced
/// value with an optional trailing unit chip, on the glass surface.
struct EnergyStatCard: View {
    let stat: EnergyStatItem

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: stat.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 0)
                Image(systemName: stat.systemImage)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.TS.chartSeriesEnergy)
                    .accessibilityHidden(true)
            }
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(verbatim: stat.value)
                    .font(Font.TS.panel)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if let unit = stat.unit {
                    Text(verbatim: unit)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.sm)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: stat.accessibilityText))
    }
}

// MARK: - Area chart (web Recharts `AreaChart` → Swift Charts)

/// The gradient-filled daily energy-usage area chart. Plots kWh over the day
/// index, maps the x ticks back to the `"M/D"` labels, and formats the y ticks as
/// whole kWh — the SwiftUI parity of the web `<AreaChart>` (`#f59e0b` stroke +
/// top→bottom fade fill). Honors Reduce Motion via the caller's container.
struct EnergyUsageChart: View {
    let projection: EnergyStatsProjection
    let prefs: EnergyStatsUnitPrefs
    /// Wide widgets (cols ≥ 3) get more x ticks so the axis can breathe (web
    /// `tick = isWide ? axisTick : axisTickSm`).
    var wide: Bool = false

    private var seriesColor: Color {
        Color.TS.chartSeriesEnergy
    }

    private var areaGradient: LinearGradient {
        LinearGradient(
            colors: [seriesColor.opacity(0.4), seriesColor.opacity(0.02)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private var labelByIndex: [Int: String] {
        Dictionary(projection.points.map { ($0.index, $0.dateLabel) }, uniquingKeysWith: { first, _ in first })
    }

    /// Up-to-`maxTicks` evenly-strided x positions (keeps endpoints).
    private func xTicks() -> [Double] {
        let points = projection.points
        let maxTicks = wide ? 6 : 4
        guard points.count > maxTicks else { return points.map { Double($0.index) } }
        let step = Double(points.count - 1) / Double(maxTicks - 1)
        return (0 ..< maxTicks).map { Double(points[Int((Double($0) * step).rounded())].index) }
    }

    var body: some View {
        // The single series is "Daily Usage" (web tooltip name) — naming the y
        // value carries that label into Swift Charts' value semantics.
        let usageLabel = EnergyStatsStrings.string("widget.energyStats.dailyUsage", "Daily Usage")
        return Chart(projection.points) { point in
            AreaMark(
                x: .value("day", point.index),
                y: .value(usageLabel, point.energyKwh)
            )
            .foregroundStyle(areaGradient)
            .interpolationMethod(.monotone)

            LineMark(
                x: .value("day", point.index),
                y: .value(usageLabel, point.energyKwh)
            )
            .foregroundStyle(seriesColor)
            .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            .interpolationMethod(.monotone)
        }
        .chartXAxis {
            AxisMarks(values: xTicks()) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let raw = value.as(Double.self) {
                        Text(verbatim: labelByIndex[Int(raw.rounded())] ?? "")
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let raw = value.as(Double.self) {
                        Text(verbatim: EnergyStatsFormat.number(raw, fractionDigits: 1, locale: prefs.localeIdentifier))
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYScale(domain: 0 ... max(projection.peakKwh * 1.1, 1))
        .accessibilityElement()
        .accessibilityLabel(EnergyStatsStrings.text("widget.energyStats.chartA11y", "Daily energy usage chart"))
        .accessibilityValue(Text(verbatim: EnergyStatsAccessibility.summary(for: projection, prefs: prefs)))
    }
}
