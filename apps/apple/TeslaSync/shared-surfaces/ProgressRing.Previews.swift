//
//  ProgressRing.Previews.swift
//  TeslaSync — P4 shared surface · 0099 · ProgressRing (Apple)
//
//  Xcode previews for the presentation forms the web source supports — a battery-style gauge with a
//  centered value + unit, a compact default ring, a ring with a caption below, a full ring, an empty
//  (zero-fill) ring that still shows its track, and a custom-tinted thick ring. The fill is tinted at
//  the use-site with the P1/S9 tokens (web `color`). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope. Reduce Motion is environment-driven (handled in the
//  gauge); it is toggled through the canvas accessibility overrides.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ view: some View) -> some View {
        view
            .padding()
            .frame(maxWidth: 360, alignment: .center)
            .background(Color.TS.bg)
    }

    #Preview("Battery gauge — value + unit") {
        staged(
            ProgressRing(
                value: 86,
                size: 120,
                strokeWidth: 10,
                color: Color.TS.statusSuccess,
                centerLabel: "86",
                centerSubLabel: "%"
            )
        )
    }

    #Preview("Compact default") {
        staged(ProgressRing(value: 30))
    }

    #Preview("With caption below") {
        staged(
            ProgressRing(
                value: 62,
                size: 96,
                strokeWidth: 8,
                label: "Charge limit",
                centerLabel: "62",
                centerSubLabel: "%"
            )
        )
    }

    #Preview("Full") {
        staged(
            ProgressRing(
                value: 100,
                size: 96,
                strokeWidth: 8,
                centerLabel: "100",
                centerSubLabel: "%"
            )
        )
    }

    #Preview("Empty — track only") {
        staged(
            ProgressRing(
                value: 0,
                size: 96,
                strokeWidth: 8,
                label: "No data",
                centerLabel: "0",
                centerSubLabel: "%"
            )
        )
    }

    #Preview("Custom tint — energy") {
        staged(
            ProgressRing(
                value: 14.2,
                max: 21.5,
                size: 140,
                strokeWidth: 12,
                color: Color.TS.statusWarning,
                centerLabel: "14.2",
                centerSubLabel: "kWh"
            )
        )
    }
#endif
