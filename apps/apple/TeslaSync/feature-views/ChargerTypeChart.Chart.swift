//
//  ChargerTypeChart.Chart.swift
//  TeslaSync — P4 feature view · 0087 · ChargerTypeChart (Apple)
//
//  The clustered Swift Charts bar chart + its selection tooltip — the native
//  counterpart of the web Recharts `ComposedChart` (two `<Bar>` series, avg kW + avg
//  kWh, colored per charger via `<Cell>`). Split out of the chrome in
//  `ChargerTypeChart.Views.swift`. Colors come from `ChargerTypePalette`; all copy
//  resolves through the P1/S10 facade; all chrome is token-driven (P1/S9).
//
//  Recharts → Swift Charts mapping: the web's dual y-axes (a kW scale + a kWh scale)
//  collapse to one Swift Charts y-domain — the two units are disambiguated by the
//  metric legend, the tooltip ("X kW" / "Y kWh"), and the data table rather than by a
//  second axis (Swift Charts plots a single y-scale per `Chart`). Grouping is by
//  charger column; the two metrics cluster via `position(by:)`, the energy bar at a
//  reduced opacity (web `<Bar opacity={0.6}>`).
//

import Charts
import SwiftUI

// MARK: - Chart (web Recharts grouped `ComposedChart`)

/// The clustered bar chart — one column per charger, two bars (avg kW + avg kWh)
/// colored by charger. Tapping a column reveals a value tooltip (web `ChartTooltip`);
/// each segment carries a per-charger VoiceOver value.
struct ChargerTypeBarChart: View {
    let points: [ChargerTypePoint]
    let rows: [ChargerChartRow]

    @State private var selectedKey: String?
    @Environment(\.locale) private var locale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var selectedPoint: ChargerTypePoint? {
        guard let selectedKey else { return nil }
        return points.first { $0.type.rawValue == selectedKey }
    }

    private var chargerAxisLabel: String {
        ChargerTypeStrings.string("charging.curve.col.charger", "Charger Type")
    }

    private var valueAxisLabel: String {
        ChargerTypeStrings.string("charging.curve.chart.value", "Average")
    }

    private var metricAxisLabel: String {
        ChargerTypeStrings.string("charging.curve.chart.metric", "Metric")
    }

    var body: some View {
        Chart {
            ForEach(rows) { row in
                BarMark(
                    x: .value(chargerAxisLabel, row.type.rawValue),
                    y: .value(valueAxisLabel, row.value)
                )
                .position(by: .value(metricAxisLabel, localizedMetric(row.metric)))
                .foregroundStyle(ChargerTypePalette.barColor(for: row.type, metric: row.metric))
                .cornerRadius(3)
                .accessibilityLabel(Text(verbatim: localizedName(row.type)))
                .accessibilityValue(Text(verbatim: columnValue(for: row.type.rawValue)))
            }

            if let selectedPoint {
                RuleMark(x: .value(chargerAxisLabel, selectedPoint.type.rawValue))
                    .foregroundStyle(Color.TS.border)
                    .annotation(
                        position: .top,
                        overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                    ) {
                        ChargerTypeTooltip(point: selectedPoint)
                    }
            }
        }
        .chartXScale(domain: points.map(\.type.rawValue))
        .chartXSelection(value: $selectedKey)
        .chartLegend(.hidden)
        .chartXAxis {
            AxisMarks { value in
                AxisValueLabel {
                    if let key = value.as(String.self) {
                        Text(verbatim: labelForKey(key))
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(verbatim: ChargerTypeProjection.intString(number, locale: locale))
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .frame(height: 240)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: rows)
        .accessibilityLabel(
            ChargerTypeStrings.text(
                "charging.curve.chargerType.aria",
                "Composed bar/line chart of average power and energy per charger type"
            )
        )
    }

    private func localizedName(_ type: ChargerType) -> String {
        ChargerTypeStrings.string(type.localizationKey, type.fallback)
    }

    private func localizedMetric(_ metric: ChargerMetric) -> String {
        ChargerTypeStrings.string(metric.localizationKey, metric.fallback)
    }

    private func labelForKey(_ key: String) -> String {
        guard let type = ChargerType(rawValue: key) else { return key }
        return localizedName(type)
    }

    private func columnValue(for key: String) -> String {
        guard let point = points.first(where: { $0.type.rawValue == key }) else { return "" }
        return ChargerTypeAccessibility.rowLabel(
            point,
            name: localizedName(point.type),
            locale: locale,
            localize: ChargerTypeStrings.string
        )
    }
}

// MARK: - Tooltip (web `ChartTooltip`)

/// The selection tooltip: the charger name over its Avg Power (kW) + Avg Energy
/// (kWh) values, the native parity of the web `ChartTooltip` payload list.
struct ChargerTypeTooltip: View {
    let point: ChargerTypePoint
    @Environment(\.locale) private var locale

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ChargerTypeStrings.text(point.type.localizationKey, point.type.fallback)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            ForEach(ChargerMetric.allCases.sorted { $0.order < $1.order }) { metric in
                HStack(spacing: TSSpacing.sm) {
                    Circle()
                        .fill(ChargerTypePalette.barColor(for: point.type, metric: metric))
                        .frame(width: 7, height: 7)
                    ChargerTypeStrings.text(metric.localizationKey, metric.fallback)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                    Spacer(minLength: TSSpacing.md)
                    Text(verbatim: valueText(for: metric))
                        .font(Font.TS.caption)
                        .fontWeight(.semibold)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textPrimary)
                }
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .frame(minWidth: 150, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func valueText(for metric: ChargerMetric) -> String {
        let value = ChargerTypeProjection.decimalString(point.value(for: metric), decimals: 1, locale: locale)
        let unit = ChargerTypeStrings.string(metric.unitKey, metric.unitFallback)
        return "\(value) \(unit)"
    }
}
