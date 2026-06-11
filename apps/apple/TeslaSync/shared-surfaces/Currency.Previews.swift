//
//  Currency.Previews.swift
//  TeslaSync — P4 shared surface · 0083 · Currency (Apple)
//
//  Xcode previews for the presentation forms the web source supports — a two-decimal amount with the
//  default `$`, a de-DE grouped amount (the symbol still prefixes the figure, exactly as the web
//  composes `{symbol}{number}`; only the grouping / decimal mark localizes), a forced `symbolOverride`,
//  a zero-precision integer amount, a negative value, and the null fallback (em dash). The figure is
//  tinted + sized at the use-site with the P1/S9 tokens (the web span carries no styling of its own).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
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

    #Preview("Default symbol — two decimals") {
        staged(
            Currency(value: 1234.5, locale: Locale(identifier: "en_US"))
                .font(Font.TS.title)
                .foregroundStyle(Color.TS.textPrimary)
        )
    }

    #Preview("de-DE grouping — euro") {
        staged(
            Currency(value: 1234.5, currencySymbol: "€", locale: Locale(identifier: "de_DE"))
                .font(Font.TS.title)
                .foregroundStyle(Color.TS.textPrimary)
        )
    }

    #Preview("Symbol override — pound") {
        staged(
            Currency(value: 89.99, symbolOverride: "£", locale: Locale(identifier: "en_GB"))
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.accent)
        )
    }

    #Preview("Zero precision — integer amount") {
        staged(
            Currency(value: 10247, precision: 0, locale: Locale(identifier: "en_US"))
                .font(Font.TS.display)
                .foregroundStyle(Color.TS.textPrimary)
        )
    }

    #Preview("Negative value") {
        staged(
            Currency(value: -42.7, locale: Locale(identifier: "en_US"))
                .font(Font.TS.title)
                .foregroundStyle(Color.TS.statusDanger)
        )
    }

    #Preview("Null fallback — em dash") {
        staged(
            Currency(value: nil)
                .font(Font.TS.title)
                .foregroundStyle(Color.TS.textMuted)
        )
    }
#endif
