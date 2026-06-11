//
//  Range.Previews.swift
//  TeslaSync — P4 shared surface · 0087 · Range (Apple)
//
//  Xcode previews for the presentation forms the web source supports — the preferred range under
//  metric vs. imperial units, the rated vs. ideal `rangeType` preference (proving the selection picks
//  a different field + label), a per-call precision override, the companion label, a combined
//  label-over-value tile, and the empty sentinel when no state / no value is supplied. The figure is
//  tinted + sized at the use-site with the P1/S9 tokens (the web span carries none of its own); the
//  active preferences are injected through the `\.tsUnits` + `\.tsRangeType` environment (the parity
//  of the web providers). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
//

import SwiftUI

#if DEBUG
    /// A Model-3-ish state: rated ≈ 358 mi, ideal ≈ 374 mi, in SI metres.
    private let previewState = RangeState(ratedRangeMeters: 576_000, idealRangeMeters: 602_000)

    @MainActor
    private func staged(_ view: some View) -> some View {
        view
            .font(Font.TS.title)
            .foregroundStyle(Color.TS.textPrimary)
            .padding()
            .frame(maxWidth: 360, alignment: .leading)
            .background(Color.TS.bg)
    }

    #Preview("Metric — rated range") {
        staged(RangeReadout(state: previewState).tsUnits(.metric).tsRangeType(.rated))
    }

    #Preview("Imperial — rated range") {
        staged(RangeReadout(state: previewState).tsUnits(.imperial).tsRangeType(.rated))
    }

    #Preview("Metric — ideal range") {
        staged(RangeReadout(state: previewState).tsUnits(.metric).tsRangeType(.ideal))
    }

    #Preview("Precision override (1 decimal)") {
        staged(RangeReadout(state: previewState, precision: 1).tsUnits(.metric).tsRangeType(.rated))
    }

    #Preview("Companion label — rated") {
        staged(RangeLabel().tsRangeType(.rated).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted))
    }

    #Preview("Label over value tile") {
        staged(
            VStack(alignment: .leading, spacing: 4) {
                RangeLabel()
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                RangeReadout(state: previewState)
            }
            .tsUnits(.imperial)
            .tsRangeType(.ideal)
        )
    }

    #Preview("Empty — no state") {
        staged(RangeReadout(state: nil).tsUnits(.metric).tsRangeType(.rated))
    }

    #Preview("Empty — missing ideal field") {
        staged(
            RangeReadout(state: RangeState(ratedRangeMeters: 576_000, idealRangeMeters: nil))
                .tsUnits(.metric)
                .tsRangeType(.ideal)
        )
    }
#endif
