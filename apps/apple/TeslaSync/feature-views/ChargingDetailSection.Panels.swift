//
//  ChargingDetailSection.Panels.swift
//  TeslaSync — P4 feature view · 0053 · ChargingDetailSection (Apple)
//
//  The four data panels composed by `ChargingDetailSection`, split out from the
//  shell views: Charger Brands (web `brandLeaderboard`), Cost Analysis (web
//  `MetricCard` grid), Cost by Charger Type (web `chargerTypes.map`), and the
//  Monthly Charging Trend host (web `ComposedChart`). Each panel renders its
//  content or a self-contained empty state — never hidden — using the P1/S10
//  facade strings + shared P1/S9 tokens.
//

import SwiftUI

// MARK: - Charger Brands panel (web `brandLeaderboard`)

/// The charger-brand leaderboard panel (web "Charger Brands"). Renders ranked rows
/// with a proportion bar, or the empty state when there are no brands.
struct ChargerBrandsPanel: View {
    let rows: [BrandLeaderboardRow]
    let localize: (String, String) -> String
    let formatting: any ChargingDetailFormatting

    var body: some View {
        ChargingGlassPanel(title: localize("analytics.charging.chargerBrands", "Charger Brands")) {
            if rows.isEmpty {
                ChargingEmptyState(message: localize("analytics.charging.noBrands", "No charger brand data"))
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    ForEach(rows) { row in
                        BrandLeaderboardRowView(
                            row: row,
                            sessionsWord: localize("analytics.charging.sessions", "sessions"),
                            formatting: formatting
                        )
                    }
                }
            }
        }
    }
}

/// One leaderboard row: "#1 Tesla" + "1,204 sessions" over a green proportion bar.
struct BrandLeaderboardRowView: View {
    let row: BrandLeaderboardRow
    let sessionsWord: String
    let formatting: any ChargingDetailFormatting

    private var summary: String {
        ChargingAccessibility.brandRowSummary(row, sessionsWord: sessionsWord, formatInt: formatting.formatInt)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: "#\(row.rank) \(row.brand)")
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: "\(formatting.formatInt(row.count)) \(sessionsWord)")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            ChargingProportionBar(fraction: row.fraction, color: Color.TS.statusSuccess, height: 8)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: summary))
    }
}

// MARK: - Cost Analysis panel (web `MetricCard` grid)

/// The cost-analysis panel (web "Cost Analysis"). Four metric cards (min / avg /
/// median / max) in a responsive grid, or the empty state when stats are absent.
struct CostAnalysisPanel: View {
    let stats: CostStats?
    let localize: (String, String) -> String
    let formatting: any ChargingDetailFormatting

    private let columns = [GridItem(.adaptive(minimum: 140), spacing: TSSpacing.md, alignment: .top)]

    private func summary(_ stats: CostStats) -> String {
        ChargingAccessibility.costSummary(
            stats,
            labels: CostLabels(
                min: localize("analytics.charging.minCost", "Min Cost"),
                avg: localize("analytics.charging.avgCost", "Avg Cost"),
                median: localize("analytics.charging.medianCost", "Median Cost"),
                max: localize("analytics.charging.maxCost", "Max Cost")
            ),
            formatCurrency: { formatting.formatCurrency($0, decimals: 2) }
        )
    }

    var body: some View {
        ChargingGlassPanel(title: localize("analytics.charging.costAnalysis", "Cost Analysis")) {
            if let stats {
                LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                    CostMetricCardView(
                        label: localize("analytics.charging.minCost", "Min Cost"),
                        value: formatting.formatCurrency(ChargingNumeric.safe(stats.min), decimals: 2),
                        tint: Color.TS.statusSuccess
                    )
                    CostMetricCardView(
                        label: localize("analytics.charging.avgCost", "Avg Cost"),
                        value: formatting.formatCurrency(ChargingNumeric.safe(stats.avg), decimals: 2),
                        tint: Color.TS.accent
                    )
                    CostMetricCardView(
                        label: localize("analytics.charging.medianCost", "Median Cost"),
                        value: formatting.formatCurrency(ChargingNumeric.safe(stats.median), decimals: 2),
                        tint: Color.TS.chartSeriesPower
                    )
                    CostMetricCardView(
                        label: localize("analytics.charging.maxCost", "Max Cost"),
                        value: formatting.formatCurrency(ChargingNumeric.safe(stats.max), decimals: 2),
                        tint: Color.TS.statusWarning
                    )
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: summary(stats)))
            } else {
                ChargingEmptyState(message: localize("analytics.charging.noCostStats", "No cost statistics"))
            }
        }
    }
}

/// One cost card (web `MetricCard` — label, value, a tinted dollar glyph).
struct CostMetricCardView: View {
    let label: String
    let value: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.xs)
                Image(systemName: "dollarsign.circle.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(tint)
                    .accessibilityHidden(true)
            }
            Text(verbatim: value)
                .font(Font.TS.panel)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Cost by Charger Type panel (web `chargerTypes.map`)

/// The charger-type share panel (web "Cost by Charger Type"). One bar per type
/// (type label · proportion bar · count + percent), or the empty state.
struct CostByTypePanel: View {
    let shares: [ChargerTypeShare]
    let localize: (String, String) -> String
    let formatting: any ChargingDetailFormatting

    var body: some View {
        ChargingGlassPanel(title: localize("analytics.charging.costByType", "Cost by Charger Type")) {
            if shares.isEmpty {
                ChargingEmptyState(message: localize("analytics.charging.noCostByType", "No charger type data"))
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    ForEach(shares) { share in
                        ChargingDetailSectionChargerTypeRowView(share: share, formatting: formatting)
                    }
                }
            }
        }
    }
}

/// One charger-type row: a right-aligned label, a tinted proportion bar, and a
/// monospaced "count (percent%)" trailing value (web row layout `w-28 / flex /
/// w-20`).
struct ChargingDetailSectionChargerTypeRowView: View {
    let share: ChargerTypeShare
    let formatting: any ChargingDetailFormatting

    private var trailing: String {
        "\(formatting.formatInt(share.count)) (\(formatting.formatInt(share.percent))%)"
    }

    private var summary: String {
        ChargingAccessibility.chargerTypeSummary(share, formatInt: formatting.formatInt)
    }

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: share.type)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .frame(width: 112, alignment: .trailing)
            ChargingProportionBar(
                fraction: share.fraction,
                color: TSChartPalette.color(at: share.colorIndex),
                height: 12
            )
            Text(verbatim: trailing)
                .font(Font.TS.caption.monospaced())
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .frame(width: 80, alignment: .trailing)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: summary))
    }
}

// MARK: - Monthly Charging Trend panel (web `ComposedChart`)

/// The monthly-trend panel (web "Monthly Charging Trend"). Hosts the composed
/// chart, or the empty state when there are no months.
struct MonthlyTrendPanel: View {
    let points: [MonthlyChargePoint]
    let scale: MonthlyTrendScale
    let localize: (String, String) -> String
    let formatting: any ChargingDetailFormatting

    var body: some View {
        ChargingGlassPanel(title: localize("analytics.charging.monthlyTrend", "Monthly Charging Trend")) {
            if points.isEmpty {
                ChargingEmptyState(message: localize("analytics.charging.noMonthly", "No monthly data"))
            } else {
                MonthlyChargingTrendChart(
                    points: points,
                    scale: scale,
                    localize: localize,
                    formatting: formatting
                )
            }
        }
    }
}
