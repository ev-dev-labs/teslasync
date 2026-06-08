//
//  SavingsSlide.Content.swift
//  TeslaSync — P4 feature view · 0065 · SavingsSlide (Apple)
//
//  The assembled loaded-state composition — a faithful port of the web slide's
//  centered column: the spring emoji, the "You saved" label, the count-up hero
//  amount, the "vs. driving a gas car" caption, and the gas/electric comparison
//  bars + cups-of-coffee note. The pieces fade in in a cascade (web `motion`
//  delays), honoring Reduce Motion. The whole column carries one combined
//  VoiceOver label so the slide reads as a single sentence.
//

import SwiftUI

/// The loaded slide body (web `SavingsSlide` render tree). Pure presentation over
/// a resolved `SavingsSlideProjection`; no data access lives here.
struct SavingsContent: View {
    let projection: SavingsSlideProjection

    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            SavingsEmoji()
            TSFadeIn(delay: 0.1) { youSaved }
            SavingsAnimatedAmount(target: projection.savingsValue)
            TSFadeIn(delay: 0.3) { vsGas }
            TSFadeIn(delay: 0.5) { comparison }
        }
        .frame(maxWidth: 360)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .multilineTextAlignment(.center)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: SavingsSlideAccessibility.summary(for: projection)))
    }

    private var youSaved: some View {
        SavingsSlideStrings.text("yearReview.youSaved", "You saved")
            .font(Font.TS.body)
            .textCase(.uppercase)
            .tracking(1.5)
            .foregroundStyle(Color.TS.textSecondary)
    }

    private var vsGas: some View {
        SavingsSlideStrings.text("yearReview.vsGas", "vs. driving a gas car")
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textMuted)
    }

    private var comparison: some View {
        VStack(spacing: TSSpacing.md) {
            SavingsComparisonBar(
                systemImage: "fuelpump.fill",
                tint: Color.TS.statusDanger,
                label: SavingsSlideStrings.text("yearReview.gasCost", "Gas would cost"),
                valueText: projection.gasCostText,
                fraction: 1
            )
            SavingsComparisonBar(
                systemImage: "bolt.fill",
                tint: Color.TS.statusSuccess,
                label: SavingsSlideStrings.text("yearReview.electricCost", "Electric cost"),
                valueText: projection.electricCostText,
                fraction: projection.electricFraction
            )
            SavingsCoffeeNote(note: projection.coffeeNote)
        }
        .frame(maxWidth: 280)
    }
}
