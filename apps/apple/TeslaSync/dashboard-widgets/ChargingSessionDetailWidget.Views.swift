//
//  ChargingSessionDetailWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0024 · ChargingSessionDetailWidget (Apple)
//
//  The presentational subviews composed by `ChargingSessionDetailWidget`: the stat
//  strip (web `WidgetChartSummary` stats), the dual-axis power/SoC chart (web
//  Recharts `ComposedChart` → Swift Charts `AreaMark` + `LineMark`), its legend,
//  the compact big-kWh body (web `isCompact` layout), the charger chip (web
//  `Badge`), and the friendly empty surface. All consume pre-localized strings from
//  the P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import Charts
import SwiftUI

// MARK: - Series colors (web `#22c55e` power / `#22d3ee` SoC)

enum ChargingSessionDetailPalette {
    /// The power area/line stroke — the exact web `#22c55e` emerald.
    static let power = Color(.sRGB, red: 0.133, green: 0.773, blue: 0.369, opacity: 1)
    /// The SoC line stroke — the exact web `#22d3ee` cyan.
    static let soc = Color(.sRGB, red: 0.133, green: 0.827, blue: 0.933, opacity: 1)
}

// MARK: - Stat item + strip (web `WidgetChartSummary` stats)

/// One header stat cell (web `ChartSummaryStat`): a muted label over a value with an
/// optional trailing unit. The value is pre-formatted so the locale already applies.
struct ChargingSessionDetailStatItem: Identifiable {
    let labelKey: String
    let fallback: String
    let value: String
    let unit: String?

    var id: String {
        labelKey
    }
}

/// The stat strip shown above the chart, the native port of the web
/// `WidgetChartSummary` stat grid (label over value + unit).
struct ChargingSessionDetailStatRow: View {
    let stats: [ChargingSessionDetailStatItem]

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            ForEach(stats) { stat in
                statCell(stat)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func statCell(_ stat: ChargingSessionDetailStatItem) -> some View {
        let label = ChargingSessionDetailStrings.string(stat.labelKey, stat.fallback)
        let accessibleUnit = stat.unit.map { " \($0)" } ?? ""
        return VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(verbatim: stat.value)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if let unit = stat.unit {
                    Text(verbatim: unit)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(stat.value)\(accessibleUnit)"))
    }
}

// MARK: - Dual-axis power/SoC chart (web `ComposedChart` → Swift Charts)

/// The charge power-curve with SoC overlay — the native port of the web
/// `ComposedChart` (a green power `<Area>` on the left axis + a dashed cyan SoC
/// `<Line>` on the right axis). The SoC is mapped into the kW plotting space via
/// `ChargingSessionDetailScale` so a single Swift Charts y-scale renders both and
/// the trailing percent axis lines up exactly with the web.
struct ChargingSessionDetailChart: View {
    let points: [ChargingSessionDetailPoint]
    let scale: ChargingSessionDetailScale
    let summary: ChargingSessionDetailSummary
    let isWide: Bool

    private struct Mark: Identifiable {
        let id: String
        let date: Date
        let value: Double
    }

    private var powerMarks: [Mark] {
        points.compactMap { point in
            point.powerKw.map { Mark(id: "p-\(point.id)", date: point.date, value: $0) }
        }
    }

    private var socMarks: [Mark] {
        points.compactMap { point in
            point.soc.map { Mark(id: "s-\(point.id)", date: point.date, value: scale.socToPower($0)) }
        }
    }

    /// The trailing SoC axis ticks (0 / 50 / 100 %) projected into the kW space.
    private var socAxisPositions: [Double] {
        [0, 50, 100].map(scale.socToPower)
    }

    var body: some View {
        Chart {
            ForEach(powerMarks) { mark in
                AreaMark(
                    x: .value(
                        ChargingSessionDetailStrings.string("widget.chargingSessionDetail.axisTime", "Time"),
                        mark.date
                    ),
                    y: .value(
                        ChargingSessionDetailStrings.string("widget.chargingSessionDetail.powerKw", "Power (kW)"),
                        mark.value
                    )
                )
                .interpolationMethod(.monotone)
                .foregroundStyle(
                    LinearGradient(
                        colors: [
                            ChargingSessionDetailPalette.power.opacity(0.3),
                            ChargingSessionDetailPalette.power.opacity(0.02)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
            }
            ForEach(powerMarks) { mark in
                LineMark(
                    x: .value(
                        ChargingSessionDetailStrings.string("widget.chargingSessionDetail.axisTime", "Time"),
                        mark.date
                    ),
                    y: .value(
                        ChargingSessionDetailStrings.string("widget.chargingSessionDetail.powerKw", "Power (kW)"),
                        mark.value
                    ),
                    series: .value("series", "power")
                )
                .interpolationMethod(.monotone)
                .lineStyle(StrokeStyle(lineWidth: 1.5))
                .foregroundStyle(ChargingSessionDetailPalette.power)
            }
            ForEach(socMarks) { mark in
                LineMark(
                    x: .value(
                        ChargingSessionDetailStrings.string("widget.chargingSessionDetail.axisTime", "Time"),
                        mark.date
                    ),
                    y: .value(
                        ChargingSessionDetailStrings.string("widget.chargingSessionDetail.soc", "SoC %"),
                        mark.value
                    ),
                    series: .value("series", "soc")
                )
                .interpolationMethod(.monotone)
                .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                .foregroundStyle(ChargingSessionDetailPalette.soc)
            }
        }
        .chartYScale(domain: 0 ... max(scale.powerMax, 1))
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: ChargingSessionDetailAccessibility.summary(
            summary,
            localize: ChargingSessionDetailStrings.string
        )))
    }

    @AxisContentBuilder
    private var xAxis: some AxisContent {
        AxisMarks(values: .automatic(desiredCount: isWide ? 6 : 4)) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
            AxisValueLabel {
                if let date = value.as(Date.self) {
                    Text(verbatim: ChargingSessionDetailFormat.shortTime(date))
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    @AxisContentBuilder
    private var yAxis: some AxisContent {
        AxisMarks(position: .leading) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: ChargingSessionDetailFormat.decimal1(number))
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        AxisMarks(position: .trailing, values: socAxisPositions) { value in
            AxisValueLabel {
                if let position = value.as(Double.self) {
                    Text(verbatim: "\(Int(scale.powerToSoc(position).rounded()))%")
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }
}

// MARK: - Legend (series swatches)

/// A compact legend of the two chart series (web `<Area>`/`<Line>` `name` props):
/// a solid emerald power swatch + a dashed cyan SoC swatch with localized names.
struct ChargingSessionDetailLegend: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            legendItem(
                color: ChargingSessionDetailPalette.power,
                dashed: false,
                label: ChargingSessionDetailStrings.string("widget.chargingSessionDetail.powerKw", "Power (kW)")
            )
            legendItem(
                color: ChargingSessionDetailPalette.soc,
                dashed: true,
                label: ChargingSessionDetailStrings.string("widget.chargingSessionDetail.soc", "SoC %")
            )
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func legendItem(color: Color, dashed: Bool, label: String) -> some View {
        HStack(spacing: TSSpacing.xs) {
            if dashed {
                Capsule()
                    .strokeBorder(color, style: StrokeStyle(lineWidth: 2, dash: [3, 2]))
                    .frame(width: 14, height: 6)
            } else {
                Capsule()
                    .fill(color)
                    .frame(width: 14, height: 6)
            }
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Charger chip (web `Badge`)

/// The charger classification chip — the native port of the web `Badge`
/// (`variant: 'warning' | 'neutral'`). Amber for Supercharger / DC Fast, neutral
/// for AC-Home.
struct ChargingSessionDetailChargerChip: View {
    let charger: ChargingSessionDetailCharger

    private var tint: Color {
        switch charger.tone {
        case .warning: Color.TS.statusWarning
        case .neutral: Color.TS.textMuted
        }
    }

    var body: some View {
        let label = charger.localizedLabel(ChargingSessionDetailStrings.string)
        return Text(verbatim: label)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tint)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 3)
            .background(tint.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.25), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Compact body (web `isCompact` layout)

/// The compact layout (web `size.cols <= 1`): the large kWh-added figure, its unit
/// caption, and the charger chip — centered.
struct ChargingSessionDetailCompact: View {
    let energyKwh: Double
    let charger: ChargingSessionDetailCharger

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: ChargingSessionDetailFormat.decimal1(energyKwh))
                .font(.system(size: 26, weight: .bold))
                .foregroundStyle(Color.TS.statusSuccess)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            ChargingSessionDetailStrings.text("widget.chargingSessionDetail.unitKwh", "kWh added")
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            ChargingSessionDetailChargerChip(charger: charger)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: compactA11y))
    }

    private var compactA11y: String {
        let value = ChargingSessionDetailFormat.decimal1(energyKwh)
        let unit = ChargingSessionDetailStrings.string("widget.chargingSessionDetail.unitKwh", "kWh added")
        let chargerLabel = charger.localizedLabel(ChargingSessionDetailStrings.string)
        return "\(value) \(unit). \(chargerLabel)"
    }
}

// MARK: - Empty surface (web `EmptyState`)

/// The friendly empty surface (web `EmptyState` with the `Zap` icon + "No charge
/// sessions"). Never a blank panel.
struct ChargingSessionDetailEmptyState: View {
    var body: some View {
        let message = ChargingSessionDetailStrings.string("widget.chargingSessionDetail.empty", "No charge sessions")
        return VStack(spacing: TSSpacing.sm) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: message))
    }
}
