//
//  SavingsCalculator.Content.swift
//  TeslaSync — P4 feature view · 0118 · SavingsCalculator (Apple)
//
//  The assembled "Comparison" region — a faithful port of the web grid of four
//  inner `<GlassPanel>` cards (Gas Cost equivalent / EV Cost actual / Total
//  Savings / Monthly Savings). Pure presentation over a resolved
//  `SavingsCalculatorProjection`; no data access lives here. The whole grid
//  carries one combined VoiceOver label so the comparison reads as a single
//  sentence.
//

import SwiftUI

/// The four-card comparison grid (web comparison column, `gasComparison` branch).
struct SavingsCalculatorComparison: View {
    let projection: SavingsCalculatorProjection

    private var columns: [GridItem] {
        [GridItem(.flexible(), spacing: TSSpacing.md), GridItem(.flexible(), spacing: TSSpacing.md)]
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            SavingsComparisonCard(
                title: SavingsCalculatorStrings.text("costAnalysis.calculator.gasCost", "Gas Cost (equivalent)"),
                value: projection.gasCostText,
                valueTint: Color.TS.statusDanger,
                caption: projection.gasPerDistanceText
            )
            SavingsComparisonCard(
                title: SavingsCalculatorStrings.text("costAnalysis.calculator.evCost", "EV Cost (actual)"),
                value: projection.evCostText,
                valueTint: Color.TS.accent,
                caption: projection.evPerDistanceText
            )
            SavingsComparisonCard(
                title: SavingsCalculatorStrings.text("costAnalysis.calculator.totalSavings", "Total Savings"),
                value: projection.totalSavingsText,
                valueTint: Color.TS.statusSuccess,
                caption: SavingsCalculatorStrings.string("costAnalysis.calculator.overPeriod", "over selected period")
            )
            SavingsComparisonCard(
                title: SavingsCalculatorStrings.text("costAnalysis.calculator.monthlySavings", "Monthly Savings"),
                value: projection.monthlySavingsText,
                valueTint: Color.TS.statusSuccess,
                caption: monthlyCaption
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: SavingsCalculatorAccessibility.summary(for: projection)))
    }

    /// The Monthly Savings sub-caption, web `~${yearlySavings} / year`.
    private var monthlyCaption: String {
        let perYear = SavingsCalculatorStrings.string("costAnalysis.calculator.perYear", "/ year")
        return projection.yearlySavingsText + " " + perYear
    }
}
