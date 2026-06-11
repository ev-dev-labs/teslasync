//
//  AIPeriodCompareNarration.Previews.swift
//  TeslaSync — P4 shared surface · 0037 · AIPeriodCompareNarration (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  no-vehicle, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: PeriodCompareNarrationInput) -> PeriodCompareNarrationModel {
        let source = InMemoryPeriodCompareNarrationSource(initial: input)
        let model = PeriodCompareNarrationModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleVehicle = 7

    private let sampleProse = """
    Between Period A (last 30 days) and Period B (the prior 90), efficiency moved the most — about \
    8% better, from 152 to 140 Wh/km — helped by milder weather and fewer short trips. Energy cost \
    per 100 km fell ~6% on best-effort rates. Distance was the only metric that dropped (−12%), but \
    that window had a zero-baseline week, so read it with care. These are the same deltas the chart \
    and table below show; Helix only explains them.
    """

    private func readyInput(
        stream: PeriodCompareNarrationStreamSnapshot,
        vehicleID: Int? = sampleVehicle,
        connection: PeriodCompareNarrationConnection = .live
    ) -> PeriodCompareNarrationInput {
        PeriodCompareNarrationInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AIPeriodCompareNarration(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIPeriodCompareNarration(model: previewModel(
            readyInput(stream: PeriodCompareNarrationStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIPeriodCompareNarration(model: previewModel(
            readyInput(stream: PeriodCompareNarrationStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIPeriodCompareNarration(model: previewModel(
            readyInput(stream: PeriodCompareNarrationStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no vehicle") {
        AIPeriodCompareNarration(model: previewModel(readyInput(stream: .idle, vehicleID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIPeriodCompareNarration(model: previewModel(
            PeriodCompareNarrationInput(availability: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIPeriodCompareNarration(model: previewModel(
            PeriodCompareNarrationInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIPeriodCompareNarration(model: previewModel(
            readyInput(
                stream: PeriodCompareNarrationStreamSnapshot(state: .done, text: sampleProse),
                connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIPeriodCompareNarration(model: previewModel(
            readyInput(
                stream: PeriodCompareNarrationStreamSnapshot(state: .done, text: sampleProse),
                connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIPeriodCompareNarration(model: previewModel(
            PeriodCompareNarrationInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
