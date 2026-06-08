//
//  SolarProductionWidget.Chart.swift
//  TeslaSync — P4 dashboard widget · 0093 · SolarProductionWidget (Apple)
//
//  Presentation pieces for the solar surface: the Swift Charts gradient area
//  chart (web Recharts `AreaChart`) and the Today / 30-Day Total / Daily-Avg stat
//  row (shared `WidgetChartSummary`). Kept out of the main surface file so the
//  shell/phase logic stays readable. No networking here.
//

import Charts
import SwiftUI

// MARK: - Stat summary row (web `WidgetChartSummary` stat header)

/// One labelled metric in the summary row (web `ChartSummaryStat`). `value` is
/// pre-formatted; `unit` is an optional trailing unit chip.
public struct SolarStat: Identifiable, Equatable {
    public let id: String
    public let label: String
    public let value: String
    public let unit: String?

    public init(id: String, label: String, value: String, unit: String? = nil) {
        self.id = id
        self.label = label
        self.value = value
        self.unit = unit
    }

    /// The flattened "label value unit" string spoken by VoiceOver.
    public var accessibilityText: String {
        [label, value, unit].compactMap(\.self).joined(separator: " ")
    }
}

/// The horizontal stat header (web grid/flex of `label` + `value``unit`). Left
/// aligned, monospaced values so columns line up as data ticks.
struct SolarStatRow: View {
    let stats: [SolarStat]

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            ForEach(stats) { stat in
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: stat.label)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        Text(verbatim: stat.value)
                            .font(Font.TS.panel)
                            .fontWeight(.semibold)
                            .monospacedDigit()
                            .foregroundStyle(Color.TS.textPrimary)
                            .lineLimit(1)
                        if let unit = stat.unit {
                            Text(verbatim: unit)
                                .font(Font.TS.caption)
                                .foregroundStyle(Color.TS.textMuted)
                        }
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text(verbatim: stat.accessibilityText))
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Area chart (web Recharts `AreaChart` → Swift Charts)

/// The gradient-filled daily solar-production area chart. Plots kWh over the day
/// index, maps the x ticks back to the `"M/D"` labels, and formats the y ticks as
/// whole kWh — the SwiftUI parity of the web `<AreaChart>` (`#facc15` stroke +
/// top→bottom fade fill). Honors Reduce Motion via the caller's container.
struct SolarProductionChart: View {
    let projection: SolarProjection
    /// Wide widgets (cols ≥ 3) get more x ticks so the 30-day axis can breathe
    /// (web `tick = isWide ? axisTick : axisTickSm`).
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
        // The single series is "Solar" (web tooltip/area name) — naming the y
        // value carries that label into Swift Charts' value semantics.
        let solarLabel = SolarProductionStrings.string("widget.solarProduction.solar", "Solar")
        return Chart(projection.points) { point in
            AreaMark(
                x: .value("day", point.index),
                y: .value(solarLabel, point.solarKwh)
            )
            .foregroundStyle(areaGradient)
            .interpolationMethod(.monotone)

            LineMark(
                x: .value("day", point.index),
                y: .value(solarLabel, point.solarKwh)
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
                        Text(verbatim: SolarProductionFormat.number(raw, fractionDigits: 0))
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYScale(domain: 0 ... max(projection.peakKwh * 1.1, 1))
        .accessibilityElement()
        .accessibilityLabel(SolarProductionStrings.text(
            "widget.solarProduction.chartA11y",
            "Daily solar production chart"
        ))
        .accessibilityValue(Text(verbatim: SolarProductionAccessibility.summary(for: projection)))
    }
}
