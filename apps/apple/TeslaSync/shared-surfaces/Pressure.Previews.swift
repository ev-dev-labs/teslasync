//
//  Pressure.Previews.swift
//  TeslaSync — P4 shared surface · 0086 · Pressure (Apple)
//
//  Xcode previews for the presentation forms the web source supports — the same caller value rendered
//  under bar vs. psi preferences (proving the SI conversion + unit label), a psi input, a kPa
//  preference, a per-call precision override, and the empty sentinel when no value is supplied. The
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

    private let psiPrefs = UnitPreferences(
        distance: "mi",
        speed: "mph",
        temperature: "°F",
        pressure: "psi",
        energy: "kWh",
        duration: "min",
        power: "kW",
        locale: "en-US"
    )

    private let kpaPrefs = UnitPreferences(
        distance: "km",
        speed: "km/h",
        temperature: "°C",
        pressure: "kPa",
        energy: "Wh",
        duration: "h",
        power: "W",
        locale: "en-US"
    )

    #Preview("Bar — bar input → bar") {
        staged(Pressure(bar: 2.4).tsUnits(.metric))
    }

    #Preview("Psi — bar input → psi") {
        staged(Pressure(bar: 2.4).tsUnits(psiPrefs))
    }

    #Preview("Psi input — psi") {
        staged(Pressure(psi: 34.5).tsUnits(psiPrefs))
    }

    #Preview("Kilopascal preference") {
        staged(Pressure(bar: 2.4).tsUnits(kpaPrefs))
    }

    #Preview("Precision override") {
        staged(Pressure(bar: 2.41873, precision: 3).tsUnits(.metric))
    }

    #Preview("Empty — no value") {
        staged(Pressure().tsUnits(.metric))
    }
#endif
