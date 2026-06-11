//
//  Temperature.Previews.swift
//  TeslaSync — P4 shared surface · 0089 · Temperature (Apple)
//
//  Xcode previews for the presentation forms the web source supports — the same caller value rendered
//  under metric vs. imperial preferences (proving the SI conversion + unit label), a Fahrenheit input, a
//  per-call precision override, a sub-zero figure, and the empty sentinel when no value is supplied. The
//  figure is tinted + sized at the use-site with the P1/S9 tokens (the web span carries none of its
//  own); the active units are injected through the `\.tsUnits` environment (the parity of the
//  `useUnits()` provider). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ view: some View) -> some View {
        view
            .font(Font.TS.title)
            .foregroundStyle(Color.TS.textPrimary)
            .padding()
            .frame(maxWidth: 360, alignment: .leading)
            .background(Color.TS.bg)
    }

    #Preview("Metric — °C input") {
        staged(Temperature(celsius: 21.5).tsUnits(.metric))
    }

    #Preview("Imperial — °C input → °F") {
        staged(Temperature(celsius: 21.5).tsUnits(.imperial))
    }

    #Preview("Fahrenheit input — metric") {
        staged(Temperature(fahrenheit: 68).tsUnits(.metric))
    }

    #Preview("Precision override") {
        staged(Temperature(celsius: 20.456, precision: 1).tsUnits(.metric))
    }

    #Preview("Sub-zero — metric") {
        staged(Temperature(celsius: -12.3).tsUnits(.metric))
    }

    #Preview("Empty — no value") {
        staged(Temperature().tsUnits(.metric))
    }
#endif
