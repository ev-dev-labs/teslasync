//
//  ForecastDetails.Panels.swift
//  TeslaSync — P4 feature view · 0113 · ForecastDetails (Apple)
//
//  The three data panels composed by `ForecastDetails`, split out from the chrome:
//  Charging Breakdown (web donut + per-source `/kWh` legend), Gas vs EV Savings (web
//  monthly hero + annual/lifetime cards + gas/EV/avg-km rows), and Insights (web
//  `insights.map`). Each panel renders its content or a self-contained empty state —
//  never hidden — using the P1/S10 facade strings + shared P1/S9 tokens.
//

import SwiftUI

// MARK: - Charging Breakdown panel (web donut + legend)

/// The breakdown panel (web "Charging Breakdown"). Hosts the donut over a two-row
/// legend (Home / Supercharger with each `avg_cost_per_kwh` `/kWh`), or the empty
/// state when no forecast is present.
struct ForecastBreakdownPanel: View {
    let slices: [ForecastBreakdownSlice]
    let hasForecast: Bool
    let localize: (String, String) -> String
    let formatting: any ForecastFormatting

    var body: some View {
        ForecastGlassPanel(title: localize("costAnalysis.forecast.breakdown", "Charging Breakdown")) {
            if hasForecast {
                VStack(spacing: TSSpacing.lg) {
                    ForecastBreakdownDonut(slices: slices, localize: localize, formatting: formatting)
                    VStack(spacing: TSSpacing.sm) {
                        ForEach(slices) { slice in
                            ForecastLegendRow(slice: slice, localize: localize, formatting: formatting)
                        }
                    }
                }
            } else {
                ForecastEmptyState(
                    message: localize(
                        "costAnalysis.forecast.noBreakdown",
                        "Breakdown will appear once charging data is available."
                    )
                )
            }
        }
    }
}

/// One legend row: a tinted dot + the category label, with the per-kWh rate trailing
/// (web `<Currency precision=3 />/kWh`).
struct ForecastLegendRow: View {
    let slice: ForecastBreakdownSlice
    let localize: (String, String) -> String
    let formatting: any ForecastFormatting

    private var label: String {
        localize(slice.kind.labelKey.key, slice.kind.labelKey.fallback)
    }

    private var rate: String {
        formatting.formatCurrency(slice.avgCostPerKwh, decimals: 3)
            + localize("costAnalysis.forecast.perKwhSuffix", "/kWh")
    }

    private var summary: String {
        ForecastAccessibility.sliceSummary(
            slice,
            label: label,
            perKwhWord: localize("costAnalysis.forecast.perKwh", "per kWh"),
            formatCurrency: { formatting.formatCurrency($0, decimals: 3) }
        )
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Circle()
                .fill(ForecastPalette.color(for: slice.kind))
                .frame(width: 8, height: 8)
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: rate)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: summary))
    }
}

// MARK: - Gas vs EV Savings panel (web `gas_comparison`)

/// The savings panel (web "Gas vs EV Savings"). The monthly-savings hero over the
/// annual/lifetime cards and the gas / EV / avg-km rows, or the empty state when no
/// forecast is present.
struct ForecastSavingsPanel: View {
    let savings: ForecastGasComparison?
    let localize: (String, String) -> String
    let formatting: any ForecastFormatting

    private var labels: ForecastSavingsLabels {
        ForecastSavingsLabels(
            monthly: localize("costAnalysis.forecast.monthlySavings", "Monthly Savings"),
            annual: localize("costAnalysis.forecast.annual", "Annual"),
            lifetime: localize("costAnalysis.forecast.lifetime", "Lifetime"),
            gasCost: localize("costAnalysis.forecast.gasCost", "Gas cost/mo"),
            evCost: localize("costAnalysis.forecast.evCost", "EV cost/mo"),
            avgKm: localize("costAnalysis.forecast.avgKm", "Avg km/mo")
        )
    }

    private func summary(_ comparison: ForecastGasComparison) -> String {
        ForecastAccessibility.savingsSummary(
            comparison,
            labels: labels,
            formatCurrency: { formatting.formatCurrency($0, decimals: 0) },
            formatInt: formatting.formatInt
        )
    }

    var body: some View {
        ForecastGlassPanel(
            title: localize("costAnalysis.forecast.savings", "Gas vs EV Savings"),
            systemImage: "fuelpump.fill",
            tint: Color.TS.statusSuccess
        ) {
            if let savings {
                VStack(spacing: TSSpacing.lg) {
                    MonthlySavingsHero(
                        caption: labels.monthly,
                        value: formatting.formatCurrency(savings.monthlySavings, decimals: 0)
                    )
                    HStack(spacing: TSSpacing.md) {
                        ForecastMiniStat(
                            label: labels.annual,
                            value: formatting.formatCurrency(savings.annualSavings, decimals: 0)
                        )
                        ForecastMiniStat(
                            label: labels.lifetime,
                            value: formatting.formatCurrency(savings.lifetimeSavings, decimals: 0)
                        )
                    }
                    VStack(spacing: TSSpacing.xs) {
                        ForecastCostRow(
                            label: labels.gasCost,
                            value: formatting.formatCurrency(savings.gasCostPerMonth),
                            tint: Color.TS.statusDanger
                        )
                        ForecastCostRow(
                            label: labels.evCost,
                            value: formatting.formatCurrency(savings.evCostPerMonth),
                            tint: Color.TS.statusSuccess
                        )
                        ForecastCostRow(
                            label: labels.avgKm,
                            value: formatting.formatInt(savings.avgKmPerMonth),
                            tint: Color.TS.textSecondary
                        )
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: summary(savings)))
            } else {
                ForecastEmptyState(
                    message: localize(
                        "costAnalysis.forecast.noSavings",
                        "Savings data will appear once driving history is available."
                    ),
                    systemImage: "fuelpump"
                )
            }
        }
    }
}

/// The monthly-savings hero (web green-tinted card: uppercase caption + a `text-3xl`
/// emerald count-up). The value animates with a numeric content transition that
/// honors Reduce Motion (the native `AnimatedNumber` technique).
struct MonthlySavingsHero: View {
    let caption: String
    let value: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: caption.uppercased())
                .font(Font.TS.label)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: value)
                .font(Font.TS.display)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.statusSuccess)
                .contentTransition(.numericText())
                .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.normalDuration), value: value)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .background(
            Color.TS.statusSuccess.opacity(0.06),
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusSuccess.opacity(0.18), lineWidth: 1)
        )
    }
}

/// One annual/lifetime card (web `rounded-lg bg-white/[0.04] p-3`): a small muted
/// label over a semibold value.
struct ForecastMiniStat: View {
    let label: String
    let value: String

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: value)
                .font(Font.TS.panel)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.md)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

/// One gas / EV / avg-km row (web `flex justify-between`): a muted label and a
/// tinted, monospaced trailing value.
struct ForecastCostRow: View {
    let label: String
    let value: String
    let tint: Color

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: value)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .monospacedDigit()
                .foregroundStyle(tint)
        }
    }
}

// MARK: - Insights panel (web `insights.map`)

/// The insights panel (web "Insights"). One row per insight (a bolt glyph + the
/// text), or the empty state when there are none.
struct ForecastInsightsPanel: View {
    let insights: [ForecastInsight]
    let localize: (String, String) -> String

    var body: some View {
        ForecastGlassPanel(
            title: localize("costAnalysis.forecast.insights", "Insights"),
            systemImage: "lightbulb.fill",
            tint: Color.TS.statusWarning
        ) {
            if insights.isEmpty {
                ForecastEmptyState(
                    message: localize(
                        "costAnalysis.forecast.noInsights",
                        "Insights will appear as more data is collected."
                    ),
                    systemImage: "lightbulb"
                )
            } else {
                VStack(spacing: TSSpacing.md) {
                    ForEach(insights) { insight in
                        ForecastInsightRow(
                            insight: insight,
                            total: insights.count,
                            prefix: localize("costAnalysis.forecast.insightPrefix", "Insight")
                        )
                    }
                }
            }
        }
    }
}

/// One insight row (web `flex items-start gap-3 rounded-xl p-3 bg-white/[0.03]`): a
/// leading amber bolt + the insight text, spoken with its "n of m" position.
struct ForecastInsightRow: View {
    let insight: ForecastInsight
    let total: Int
    let prefix: String

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .padding(.top, 2)
                .accessibilityHidden(true)
            Text(verbatim: insight.text)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(verbatim: ForecastAccessibility.insightSummary(insight, total: total, prefix: prefix))
        )
    }
}
