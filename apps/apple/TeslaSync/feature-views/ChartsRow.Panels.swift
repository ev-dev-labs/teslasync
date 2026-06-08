//
//  ChartsRow.Panels.swift
//  TeslaSync — P4 feature view · 0099 · ChartsRow (Apple)
//
//  The two data panels composed by `ChartsRow`, split out from the shell views: Energy
//  & Cost Trend (web `<AreaChart>` host) and Charger Breakdown (web `<PieChart>` donut +
//  the cost-by-type legend list). Each panel renders its content or a self-contained
//  empty state — never hidden — using the P1/S10 facade strings + shared P1/S9 tokens.
//

import SwiftUI

// MARK: - Energy & Cost Trend panel (web `<AreaChart>`)

/// The energy & cost trend panel. Hosts the area+line chart, or the empty state when
/// there are no points.
struct ChartsRowEnergyPanel: View {
    let points: [ChartsRowEnergyPoint]
    let scale: ChartsRowEnergyScale
    let localize: (String, String) -> String
    let formatting: any ChartsRowFormatting

    var body: some View {
        ChartsRowGlassPanel(
            title: localize("charging.charts.energyCostTrend", "Energy & Cost Trend"),
            systemImage: "calendar",
            tint: Color.TS.accent
        ) {
            if points.isEmpty {
                ChartsRowEmptyState(message: localize("charging.charts.noTrend", "No energy or cost data"))
            } else {
                ChartsRowEnergyChart(
                    points: points,
                    scale: scale,
                    localize: localize,
                    formatting: formatting
                )
            }
        }
    }
}

// MARK: - Charger Breakdown panel (web `<PieChart>` donut + cost-by-type list)

/// The charger-breakdown panel. Hosts the donut next to the cost-by-type legend list
/// (web `flex-col sm:flex-row`), collapsing to a single column when narrow, or the empty
/// state when there is neither a slice nor a row.
struct ChartsRowBreakdownPanel: View {
    let donut: ChartsRowDonut
    let rows: [ChartsRowCostRow]
    let localize: (String, String) -> String
    let formatting: any ChartsRowFormatting

    private var isEmpty: Bool {
        donut.isEmpty && rows.isEmpty
    }

    private var donutSummary: String {
        ChartsRowAccessibility.breakdownSummary(
            donut,
            formatNumber: { formatting.formatNumber($0, decimals: 0) }
        )
    }

    var body: some View {
        ChartsRowGlassPanel(
            title: localize("charging.charts.chargerBreakdown", "Charger Breakdown"),
            systemImage: "powerplug.fill",
            tint: Color.TS.chartSeriesPower
        ) {
            if isEmpty {
                ChartsRowEmptyState(message: localize("charging.charts.noBreakdown", "No charger breakdown data"))
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .center, spacing: TSSpacing.lg) {
                        donutView
                        list
                    }
                    VStack(alignment: .leading, spacing: TSSpacing.lg) {
                        donutView
                        list
                    }
                }
            }
        }
    }

    private var donutView: some View {
        ChartsRowDonutChart(donut: donut, accessibilitySummary: donutSummary)
    }

    private var list: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(rows) { row in
                ChartsRowCostRowView(row: row, localize: localize, formatting: formatting)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Cost-by-type legend row (web `costByType.map`)

/// One cost-by-type legend row: the type label and energy on the first line, then the
/// total cost and per-kWh price on a muted second line (web two-row layout).
struct ChartsRowCostRowView: View {
    let row: ChartsRowCostRow
    let localize: (String, String) -> String
    let formatting: any ChartsRowFormatting

    private var energyUnit: String {
        localize("charging.charts.energyUnit", "kWh")
    }

    private var totalWord: String {
        localize("charging.charts.costTotalSuffix", "total")
    }

    private var perKwhSuffix: String {
        localize("charging.charts.perKwhSuffix", "/kWh")
    }

    private var summary: String {
        ChartsRowAccessibility.costRowSummary(
            row,
            labels: ChartsRowCostRowLabels(
                energyUnit: energyUnit,
                totalWord: totalWord,
                perKwhSuffix: perKwhSuffix
            ),
            formatNumber: { formatting.formatNumber($0) },
            formatCurrency: { formatting.formatCurrency($0) }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: row.label)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: formatting.formatWithUnit(row.energy, unit: energyUnit))
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: "\(formatting.formatCurrency(row.cost)) \(totalWord)")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: "\(formatting.formatCurrency(row.perKwh))\(perKwhSuffix)")
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: summary))
    }
}
