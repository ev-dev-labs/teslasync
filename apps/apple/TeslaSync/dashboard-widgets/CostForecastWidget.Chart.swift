//
//  CostForecastWidget.Chart.swift
//  TeslaSync — P4 dashboard widget · 0032 · CostForecastWidget (Apple)
//
//  The Swift Charts bar chart — the native counterpart of the web Recharts
//  `BarChart` in features/dashboard/widgets/CostForecastWidget.tsx. Renders one
//  bar per month of the 6-month charging-cost window, with the projected
//  (forecast) months rendered translucent so the historical→forecast boundary
//  reads at a glance, a tap-to-inspect tooltip, per-bar VoiceOver values, and a
//  currency-formatted value axis.
//

import Charts
import SwiftUI

// MARK: - Cost-forecast bar chart (web Recharts `BarChart`)

/// Monthly charging-cost bar chart. Bars are filled with the brand indigo the
/// web uses (`#6366f1`); forecast months are drawn translucent (the data carries
/// `isForecast`, which the web computes but renders flat — the native surface
/// surfaces it for clarity, backed by the legend). Bars are plotted against a
/// stable per-month key so a historical and a forecast month sharing a label
/// never collapse, and the x-axis renders the human month label.
struct CostForecastWidgetChart: View {
    let bars: [CostForecastWidgetBar]
    let currency: CostForecastWidgetCurrencyFormatter
    var isWide: Bool = false

    @State private var selectedKey: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The web bar fill `#6366f1` (indigo). The web has no design token for it,
    /// so the parity color is reproduced verbatim here (the generated palette in
    /// Tokens.swift likewise expresses brand chart colors as sRGB literals).
    static let barColor = Color(.sRGB, red: 0.388, green: 0.400, blue: 0.945, opacity: 1.0)

    static func fill(for bar: CostForecastWidgetBar) -> Color {
        barColor.opacity(bar.isForecast ? 0.55 : 1.0)
    }

    private var monthLabel: String {
        CostForecastWidgetStrings.string("widget.costForecast.month", "Month")
    }

    private var costLabel: String {
        CostForecastWidgetStrings.string("widget.costForecast.costLabel", "Cost")
    }

    private var labelsByKey: [String: String] {
        Dictionary(bars.map { ($0.plotKey, $0.month) }, uniquingKeysWith: { first, _ in first })
    }

    private var selectedBar: CostForecastWidgetBar? {
        guard let selectedKey else { return nil }
        return bars.first { $0.plotKey == selectedKey }
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            chart
            legend
        }
    }

    private var chart: some View {
        Chart {
            ForEach(bars) { bar in
                BarMark(
                    x: .value(monthLabel, bar.plotKey),
                    y: .value(costLabel, bar.cost)
                )
                .foregroundStyle(Self.fill(for: bar))
                .cornerRadius(4)
                .accessibilityLabel(Text(verbatim: bar.month))
                .accessibilityValue(Text(verbatim: CostForecastWidgetAccessibility.barLabel(bar, currency: currency)))
            }

            if let selectedBar {
                RuleMark(x: .value(monthLabel, selectedBar.plotKey))
                    .foregroundStyle(Color.TS.border)
                    .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        tooltip(for: selectedBar)
                    }
            }
        }
        .chartXScale(domain: bars.map(\.plotKey))
        .chartXSelection(value: $selectedKey)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: bars)
        .accessibilityLabel(
            CostForecastWidgetStrings.text(
                "widget.costForecast.chartA11y",
                "Bar chart of monthly charging cost, with the most recent months projected as a forecast"
            )
        )
    }

    @AxisContentBuilder
    private var xAxis: some AxisContent {
        AxisMarks(values: axisKeys) { value in
            AxisValueLabel {
                if let key = value.as(String.self), let label = labelsByKey[key] {
                    Text(verbatim: label)
                        .font(Font.TS.label)
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
                    Text(verbatim: currency.string(number, decimals: 0))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    /// The month keys shown on the x-axis: all of them on a wide widget, evenly
    /// thinned on a narrow one so the month labels never collide (the web swaps
    /// `axisTick` ↔ `axisTickSm` by width for the same reason).
    private var axisKeys: [String] {
        let keys = bars.map(\.plotKey)
        let limit = isWide ? 10 : 6
        guard keys.count > limit else { return keys }
        let step = Int(ceil(Double(keys.count) / Double(limit)))
        return keys.enumerated().filter { $0.offset.isMultiple(of: step) }.map(\.element)
    }

    private func tooltip(for bar: CostForecastWidgetBar) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(verbatim: bar.month)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: currency.string(bar.cost))
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            CostForecastWidgetStrings.text(
                bar.isForecast ? "widget.costForecast.forecast" : "widget.costForecast.actual",
                bar.isForecast ? "Forecast" : "Actual"
            )
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    // MARK: Legend (historical vs forecast)

    private var legend: some View {
        HStack(spacing: TSSpacing.md) {
            legendItem(fill: Self.barColor, key: "widget.costForecast.actual", fallback: "Actual")
            legendItem(
                fill: Self.barColor.opacity(0.55),
                key: "widget.costForecast.forecast",
                fallback: "Forecast"
            )
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            CostForecastWidgetStrings.text("widget.costForecast.legendA11y", "Actual versus forecast legend")
        )
    }

    private func legendItem(fill: Color, key: String, fallback: String) -> some View {
        HStack(spacing: TSSpacing.xs) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(fill)
                .frame(width: 10, height: 10)
            CostForecastWidgetStrings.text(key, fallback)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
    }
}
