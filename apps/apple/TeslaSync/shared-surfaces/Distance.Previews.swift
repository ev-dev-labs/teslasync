//
//  Distance.Previews.swift
//  TeslaSync — P4 shared surface · 0085 · Distance (Apple)
//
//  Xcode previews for the presentation forms the web source supports — the same caller value rendered
//  under metric vs. imperial preferences (proving the SI conversion + unit label), a kilometre input, a
//  per-call precision override, a large grouped figure, and the empty sentinel when no value is
//  supplied. The figure is tinted + sized at the use-site with the P1/S9 tokens (the web span carries
//  none of its own); the active units are injected through the `\.tsUnits` environment (the parity of
//  the `useUnits()` provider). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
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

    #Preview("Metric — miles input → km") {
        staged(Distance(miles: 248.5).tsUnits(.metric))
    }

    #Preview("Imperial — miles input → mi") {
        staged(Distance(miles: 248.5).tsUnits(.imperial))
    }

    #Preview("Kilometre input — metric") {
        staged(Distance(km: 412.7).tsUnits(.metric))
    }

    #Preview("Precision override") {
        staged(Distance(km: 12.3456, precision: 3).tsUnits(.metric))
    }

    #Preview("Large grouped value") {
        staged(Distance(km: 128_477).tsUnits(.metric))
    }

    #Preview("Empty — no value") {
        staged(Distance().tsUnits(.metric))
    }
#endif
