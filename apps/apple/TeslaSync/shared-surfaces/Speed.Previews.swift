//
//  Speed.Previews.swift
//  TeslaSync — P4 shared surface · 0088 · Speed (Apple)
//
//  Xcode previews for the presentation forms the web source supports — an mph value under an imperial
//  preference (figure + tooltip share the unit), the same mph value under a metric preference (the
//  figure converts to km/h while the tooltip keeps "mph", the web's cross-unit case), a km/h value under
//  a metric preference, a km/h value under an imperial preference (converts to mph), a zero-precision
//  integer figure, a de-DE grouped high speed (the decimal mark / grouping localizes; the unit label
//  does not), and the no-value fallback (em dash). The figure is tinted + sized at the use-site with the
//  P1/S9 tokens (the web span carries no styling of its own). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
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

    #Preview("mph value — imperial preference") {
        staged(
            Speed(mph: 65, unitOfLength: "mi", locale: Locale(identifier: "en_US"))
                .font(Font.TS.title)
                .foregroundStyle(Color.TS.textPrimary)
        )
    }

    #Preview("mph value — metric preference (converts)") {
        staged(
            Speed(mph: 65, unitOfLength: "km", locale: Locale(identifier: "en_US"))
                .font(Font.TS.title)
                .foregroundStyle(Color.TS.accent)
        )
    }

    #Preview("km/h value — metric preference") {
        staged(
            Speed(kmh: 100, unitOfLength: "km", locale: Locale(identifier: "en_US"))
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
        )
    }

    #Preview("km/h value — imperial preference (converts)") {
        staged(
            Speed(kmh: 100, unitOfLength: "mi", locale: Locale(identifier: "en_US"))
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.accent)
        )
    }

    #Preview("Zero precision — integer figure") {
        staged(
            Speed(mph: 72.6, precision: 0, unitOfLength: "mi", locale: Locale(identifier: "en_US"))
                .font(Font.TS.display)
                .foregroundStyle(Color.TS.textPrimary)
        )
    }

    #Preview("de-DE grouping — high speed") {
        staged(
            Speed(kmh: 5000, unitOfLength: "km", locale: Locale(identifier: "de_DE"))
                .font(Font.TS.title)
                .foregroundStyle(Color.TS.statusWarning)
        )
    }

    #Preview("No value — em dash fallback") {
        staged(
            Speed(mph: nil, kmh: nil)
                .font(Font.TS.title)
                .foregroundStyle(Color.TS.textMuted)
        )
    }
#endif
