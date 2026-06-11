//
//  AnimatedNumber.Previews.swift
//  TeslaSync — P4 shared surface · 0075 · AnimatedNumber (Apple)
//
//  Xcode previews for the presentation forms the web source supports — a plain integer count-up, a
//  two-decimal value with a currency prefix, a percentage with a suffix, a large grouped figure, and a
//  negative value. The figure is tinted at the use-site with the P1/S9 tokens (the web span carries no
//  colour of its own). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate
//  scope. Reduce Motion is environment-driven (handled in the roller and exercised by the inert-path
//  view tests); it is toggled through the canvas accessibility overrides.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ view: some View) -> some View {
        view
            .padding()
            .frame(maxWidth: 360, alignment: .leading)
            .background(Color.TS.bg)
    }

    #Preview("Integer count-up") {
        staged(
            AnimatedNumber(value: 10247)
                .font(Font.TS.display)
                .foregroundStyle(Color.TS.textPrimary)
        )
    }

    #Preview("Two decimals — currency prefix") {
        staged(
            AnimatedNumber(value: 1234.5, duration: 1.2, decimals: 2, prefix: "$")
                .font(Font.TS.title)
                .foregroundStyle(Color.TS.accent)
        )
    }

    #Preview("Percentage — suffix") {
        staged(
            AnimatedNumber(value: 86.4, decimals: 1, suffix: "%")
                .font(Font.TS.title)
                .foregroundStyle(Color.TS.statusSuccess)
        )
    }

    #Preview("Large grouped value") {
        staged(
            AnimatedNumber(value: 1_284_771, suffix: " km")
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
        )
    }

    #Preview("Negative value") {
        staged(
            AnimatedNumber(value: -42.7, decimals: 1, suffix: " kWh")
                .font(Font.TS.title)
                .foregroundStyle(Color.TS.statusDanger)
        )
    }
#endif
