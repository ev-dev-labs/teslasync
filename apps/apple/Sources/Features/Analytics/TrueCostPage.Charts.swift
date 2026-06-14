import SwiftUI

// The three charts on the True Cost surface, built on the P3 native Swift Charts wrappers (never a
// WKWebView): the Cumulative-Savings-Over-Time `AreaChart`, the Cost-per-Kilometer `BarChart`, and
// the Monthly-EV-vs-Gas `BarChart` — each inside a `ChartContainer`. Each renders its own empty
// state (never a blank region) and an accessible summary. Monetary values are currency amounts;
// per-km costs are intrinsically per-km, so neither is unit-converted.

// Palette: EV = index 0 (blue), gas/ICE = index 5 (vermillion), savings = index 2 (green).
private enum TrueCostPalette {
    static let savings = 2
    static let ev = 0
    static let gas = 5
}

// MARK: - Cumulative savings area (web Cumulative-Savings ChartContainer + AreaChart)

/// The cumulative EV-vs-gas savings area chart (web `ChartContainer` + `AreaChart`): the running
/// `cumulative_savings` total month over month. Renders its monthly empty state when there is no
/// monthly data.
struct TrueCostCumulativeSavingsSection: View {
    let monthly: [MonthlyCostEntry]

    var body: some View {
        TSChartContainer("tco.cumulativeSavings", summary: "tco.cumulativeSavings.aria") {
            if monthly.isEmpty {
                TSEmptyState(title: "tco.noMonthlyData", systemImage: "chart.line.uptrend.xyaxis")
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else {
                TSAreaChart(series: series)
                    .frame(height: 260)
                    .accessibilityLabel(Text("tco.cumulativeSavings.aria"))
            }
        }
    }

    private var series: [TSChartSeries] {
        let name = String(localized: "tco.cumulativeSavings", defaultValue: "Cumulative Savings")
        let points = monthly.enumerated().map { index, entry in
            TSChartPoint(x: Double(index), y: entry.cumulativeSavings, id: entry.month)
        }
        return [
            TSChartSeries(
                id: "cumulative",
                name: LocalizedStringKey("tco.cumulativeSavings"),
                nameText: name,
                points: points,
                colorIndex: TrueCostPalette.savings
            )
        ]
    }
}

// MARK: - Cost per kilometre (web Cost-per-Kilometer ChartContainer + BarChart)

/// The cost-per-kilometre comparison (web `ChartContainer` + `BarChart`): an EV vs ICE bar pair
/// plus the two value chips beneath. Both costs are intrinsically per-km, so neither is
/// unit-converted (web renders them unchanged regardless of the distance preference).
struct TrueCostCostPerKmSection: View {
    let breakdown: CostBreakdown
    let currencySymbol: String

    var body: some View {
        TSChartContainer("tco.costPerKm", summary: "tco.costPerKm.aria") {
            VStack(spacing: TSSpacing.sm) {
                TSBarChart(series: series)
                    .frame(height: 200)
                    .accessibilityLabel(Text("tco.costKm"))
                categoryAxis
                chips
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("tco.costPerKm.aria"))
        }
    }

    /// Two single-bar series (web data rows EV + ICE, each with its own fill).
    private var series: [TSChartSeries] {
        let evName = String(localized: "tco.evElectric", defaultValue: "EV (Electric)")
        let iceName = String(localized: "tco.iceGas", defaultValue: "ICE (Gas)")
        return [
            TSChartSeries(
                id: "ev",
                name: LocalizedStringKey("tco.evElectric"),
                nameText: evName,
                points: [TSChartPoint(x: 0, y: breakdown.costPerKmEv, id: "ev")],
                colorIndex: TrueCostPalette.ev
            ),
            TSChartSeries(
                id: "ice",
                name: LocalizedStringKey("tco.iceGas"),
                nameText: iceName,
                points: [TSChartPoint(x: 1, y: breakdown.costPerKmIce, id: "ice")],
                colorIndex: TrueCostPalette.gas
            )
        ]
    }

    /// Per-bar category labels beneath the bars (web X-axis ticks EV / ICE).
    private var categoryAxis: some View {
        HStack(spacing: TSSpacing.xs) {
            Text("tco.evElectric")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .frame(maxWidth: .infinity)
            Text("tco.iceGas")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .frame(maxWidth: .infinity)
        }
        .accessibilityHidden(true)
    }

    /// The two per-km value chips (web tinted readout tiles).
    private var chips: some View {
        HStack(spacing: TSSpacing.md) {
            TrueCostValueChip(
                value: TrueCostFormat.costPerKm(breakdown.costPerKmEv, symbol: currencySymbol),
                label: "tco.perKmEv",
                colorIndex: TrueCostPalette.ev
            )
            TrueCostValueChip(
                value: TrueCostFormat.costPerKm(breakdown.costPerKmIce, symbol: currencySymbol),
                label: "tco.perKmGas",
                colorIndex: TrueCostPalette.gas
            )
        }
    }
}

/// One tinted per-km value tile (web `rounded-xl bg-…/10 border-…/20` chip): value + muted label.
struct TrueCostValueChip: View {
    let value: String
    let label: LocalizedStringKey
    let colorIndex: Int

    var body: some View {
        let tint = TSChartPalette.color(at: colorIndex)
        return VStack(spacing: TSSpacing.xs) {
            Text(verbatim: value)
                .font(Font.TS.section)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            TSCaption(label)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.md)
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tint.opacity(0.25), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Monthly EV vs gas (web Monthly-EV-vs-Gas ChartContainer + BarChart)

/// The month-by-month EV vs gas cost comparison (web `ChartContainer` + `BarChart`): grouped
/// `ev_cost` + `equiv_gas_cost` bars per month with a two-series legend. Renders its monthly empty
/// state when there is no monthly data.
struct TrueCostMonthlyComparisonSection: View {
    let monthly: [MonthlyCostEntry]

    var body: some View {
        TSChartContainer("tco.monthlyEvVsGas", summary: "tco.monthlyEvVsGas.aria") {
            if monthly.isEmpty {
                TSEmptyState(title: "tco.noMonthlyData", systemImage: "chart.bar.xaxis")
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else {
                VStack(spacing: TSSpacing.sm) {
                    TSBarChart(series: series)
                        .frame(height: 200)
                    TrueCostSeriesLegend()
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("tco.monthlyEvVsGas.aria"))
            }
        }
    }

    private var series: [TSChartSeries] {
        let evName = String(localized: "tco.evCost", defaultValue: "EV Cost")
        let gasName = String(localized: "tco.gasEquiv", defaultValue: "Gas Equiv.")
        let evPoints = monthly.enumerated().map { index, entry in
            TSChartPoint(x: Double(index), y: entry.evCost, id: "ev-\(entry.month)")
        }
        let gasPoints = monthly.enumerated().map { index, entry in
            TSChartPoint(x: Double(index), y: entry.equivGasCost, id: "gas-\(entry.month)")
        }
        return [
            TSChartSeries(
                id: "ev",
                name: LocalizedStringKey("tco.evCost"),
                nameText: evName,
                points: evPoints,
                colorIndex: TrueCostPalette.ev
            ),
            TSChartSeries(
                id: "gas",
                name: LocalizedStringKey("tco.gasEquiv"),
                nameText: gasName,
                points: gasPoints,
                colorIndex: TrueCostPalette.gas
            )
        ]
    }
}

/// Two-series legend for the monthly chart (web recharts `<Legend />`): EV Cost + Gas Equiv.
struct TrueCostSeriesLegend: View {
    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            legendItem(colorIndex: TrueCostPalette.ev, label: "tco.evCost")
            legendItem(colorIndex: TrueCostPalette.gas, label: "tco.gasEquiv")
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private func legendItem(colorIndex: Int, label: LocalizedStringKey) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(TSChartPalette.color(at: colorIndex)).frame(width: 8, height: 8)
            Text(label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
    }
}
