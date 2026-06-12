//
//  Slider.Previews.swift
//  TeslaSync — P4 shared surface · 0226 · Slider (Apple)
//
//  Xcode previews for the presentation forms the web source supports — the labelled slider with a
//  unit-aware `formatValue` readout, a fractional `step`, the `showLabel = false` variant (track
//  only, accessible name preserved), the disabled track, and the raw `String(value)` default. Each
//  preview drives a live `@State` binding so the thumb + readout move, the native parity of the web
//  controlled `value` + `onChange`. The accent + type + spacing come from the P1/S9 tokens.
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

    #Preview("Labelled — percent") {
        @Previewable @State var value = 32.0
        staged(
            SliderField(
                value: $value,
                minimum: 0,
                maximum: 100,
                step: 1,
                label: "Brightness",
                format: { "\(Int($0)) percent" }
            )
        )
    }

    #Preview("Labelled — fractional step") {
        @Previewable @State var value = 12.5
        staged(
            SliderField(
                value: $value,
                minimum: 0,
                maximum: 25,
                step: 0.5,
                label: "Charge limit",
                format: { String(format: "%.1f kWh", $0) }
            )
        )
    }

    #Preview("No label — accessible name only") {
        @Previewable @State var value = 175.0
        staged(
            SliderField(
                value: $value,
                minimum: 0,
                maximum: 250,
                step: 5,
                label: "Speed limit",
                format: { "\(Int($0)) km/h" },
                showLabel: false
            )
        )
    }

    #Preview("Disabled") {
        @Previewable @State var value = 60.0
        staged(
            SliderField(
                value: $value,
                minimum: 0,
                maximum: 100,
                label: "Locked",
                format: { "\(Int($0))%" },
                isDisabled: true
            )
        )
    }

    #Preview("Default readout — String(value)") {
        @Previewable @State var value = 7.0
        staged(
            SliderField(
                value: $value,
                minimum: 0,
                maximum: 10,
                label: "Steps"
            )
        )
    }
#endif
