//
//  ChargingSection.Chart.swift
//  TeslaSync — P4 feature view · 0074 · ChargingSection (Apple)
//
//  The "Daily Energy Added (kWh)" chart card composed by `ChargingSection`: the web
//  Recharts `BarChart` of `dailyEnergyData` rendered as a native Swift Charts
//  `Chart { BarMark }` with a selection tooltip (web `ChartTooltip`). Kept in its own
//  file so each surface file stays within the house length limit. All copy resolves
//  through the P1/S10 facade; all chrome is token-driven (P1/S9).
//

import Charts
import SwiftUI

// MARK: - Chart card

/// The bar-chart card: the "Daily Energy Added (kWh)" label over the chart, with an
/// inline placeholder when the section has content but no daily breakdown. // parity:allow ui
struct ChargingEnergyCard: View {
    let bars: [ChargingEnergyBar]
    let locale: Locale

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ChargingStrings.text("analytics.weeklyDigest.dailyEnergyAdded", "Daily Energy Added (kWh)")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
            if bars.isEmpty {
                ChargingChartEmpty()
            } else {
                ChargingEnergyChart(bars: bars, locale: locale)
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Inline chart placeholder (content present, no daily breakdown) // parity:allow ui

/// The inline placeholder shown inside the card when the section has charging // parity:allow ui
/// activity but no per-day breakdown — never a blank box.
struct ChargingChartEmpty: View {
    var body: some View {
        ChargingStrings.text("analytics.weeklyDigest.charging.noDailyBreakdown", "No daily breakdown available")
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, minHeight: 120)
            .accessibilityElement(children: .combine)
    }
}

// MARK: - Bar chart (web Recharts `BarChart`)

/// The daily-energy bar chart — the native counterpart of the web Recharts
/// `BarChart`. One bar per day (web `<Bar dataKey="energy" fill={CHART_COLORS[1]}>`);
/// tapping a bar reveals a value tooltip (web `ChartTooltip`); each bar carries a
/// per-day VoiceOver value.
struct ChargingEnergyChart: View {
    let bars: [ChargingEnergyBar]
    let locale: Locale

    @State private var selectedDay: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var selectedBar: ChargingEnergyBar? {
        guard let selectedDay else { return nil }
        return bars.first { $0.day == selectedDay }
    }

    private var dayLabel: String {
        ChargingStrings.string("analytics.weeklyDigest.charging.day", "Day")
    }

    private var energyLabel: String {
        ChargingStrings.string("analytics.weeklyDigest.charging.energy", "Energy")
    }

    var body: some View {
        Chart {
            marks
        }
        .chartXSelection(value: $selectedDay)
        .chartLegend(.hidden)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .frame(height: 260)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: bars)
        .accessibilityLabel(
            ChargingStrings.text(
                "analytics.weeklyDigest.charging.a11y",
                "Bar chart of daily energy added in kilowatt-hours"
            )
        )
    }

    @ChartContentBuilder
    private var marks: some ChartContent {
        ForEach(bars) { bar in
            BarMark(
                x: .value(dayLabel, bar.day),
                y: .value(energyLabel, bar.energy)
            )
            .foregroundStyle(TSChartPalette.color(at: 1))
            .cornerRadius(3)
            .accessibilityLabel(Text(verbatim: bar.day))
            .accessibilityValue(
                Text(verbatim: ChargingSectionAccessibility.barLabel(
                    bar,
                    localize: ChargingStrings.string,
                    locale: locale
                ))
            )
        }
        if let selectedBar {
            RuleMark(x: .value(dayLabel, selectedBar.day))
                .foregroundStyle(Color.TS.border)
                .annotation(
                    position: .top,
                    overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                ) {
                    ChargingTooltip(bar: selectedBar, locale: locale)
                }
        }
    }

    private var xAxis: some AxisContent {
        AxisMarks { _ in
            AxisValueLabel()
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private var yAxis: some AxisContent {
        AxisMarks(position: .leading) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: ChargingFormat.number(number, fractionDigits: 1, locale: locale))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }
}

// MARK: - Tooltip (web `ChartTooltip`)

/// The selection tooltip: the day label over the "Energy Added" value, the native
/// parity of the web `ChartTooltip` payload.
struct ChargingTooltip: View {
    let bar: ChargingEnergyBar
    let locale: Locale

    private var energyText: String {
        let value = ChargingFormat.number(bar.energy, fractionDigits: 1, locale: locale)
        return "\(value) \(ChargingUnits.kwh)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: bar.day)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            HStack(spacing: TSSpacing.sm) {
                Circle().fill(TSChartPalette.color(at: 1)).frame(width: 7, height: 7)
                ChargingStrings.text("analytics.weeklyDigest.energyAdded", "Energy Added")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.md)
                Text(verbatim: energyText)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
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
}
