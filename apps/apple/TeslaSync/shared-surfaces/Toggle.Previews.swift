//
//  Toggle.Previews.swift
//  TeslaSync — P4 shared surface · 0230 · Toggle (Apple)
//
//  Xcode previews for the presentation forms the web source supports — the labelled switch in its on
//  and off states, the two size variants (`md` / `sm`), the unlabeled switch (accessible name only),
//  and a long label exercising Dynamic Type wrapping. Each preview drives a live `@State` binding so
//  the switch flips, the native parity of the web controlled `checked` + `onChange`. The accent +
//  type + spacing come from the P1/S9 tokens. DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
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

    #Preview("Labelled — on") {
        @Previewable @State var isOn = true
        staged(ToggleSwitch(isOn: $isOn, label: "Climate keeper"))
    }

    #Preview("Labelled — off") {
        @Previewable @State var isOn = false
        staged(ToggleSwitch(isOn: $isOn, label: "Sentry mode"))
    }

    #Preview("Small variant") {
        @Previewable @State var isOn = true
        staged(ToggleSwitch(isOn: $isOn, label: "Compact", size: .small))
    }

    #Preview("No label — accessible name only") {
        @Previewable @State var isOn = true
        staged(ToggleSwitch(isOn: $isOn))
    }

    #Preview("Long label — Dynamic Type") {
        @Previewable @State var isOn = false
        staged(
            ToggleSwitch(
                isOn: $isOn,
                label: "Preheat the cabin before scheduled departure"
            )
        )
        .environment(\.dynamicTypeSize, .accessibility3)
    }
#endif
