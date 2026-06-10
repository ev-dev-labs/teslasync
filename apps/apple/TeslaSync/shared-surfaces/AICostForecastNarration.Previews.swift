//
//  AICostForecastNarration.Previews.swift
//  TeslaSync — P4 shared surface · 0013 · AICostForecastNarration (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  no-vehicle, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: CostNarrationInput) -> CostNarrationModel {
        let source = InMemoryCostNarrationSource(initial: input)
        let model = CostNarrationModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleVehicle = 7
    private let sampleMonths = 6

    private let sampleProse = """
    Your six-month charging-cost forecast lands near $96/mo, inside an approximate $82–$114 band. \
    Home charging carries about 78% of your energy at your off-peak rate, which is why the projection \
    stays flat even as you drive more; the supercharger share is the main swing factor in the high \
    end. The dollar figures here are exactly the ones the chart plots — this only narrates them, and \
    the band is an approximate prediction interval, not a strict 95% confidence interval.
    """

    private func readyInput(
        stream: CostNarrationStreamSnapshot,
        vehicleID: Int? = sampleVehicle,
        connection: CostNarrationConnection = .live
    ) -> CostNarrationInput {
        CostNarrationInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            months: sampleMonths,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AICostForecastNarration(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AICostForecastNarration(model: previewModel(
            readyInput(stream: CostNarrationStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AICostForecastNarration(model: previewModel(
            readyInput(stream: CostNarrationStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AICostForecastNarration(model: previewModel(
            readyInput(stream: CostNarrationStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no vehicle") {
        AICostForecastNarration(model: previewModel(readyInput(stream: .idle, vehicleID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AICostForecastNarration(model: previewModel(CostNarrationInput(availability: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AICostForecastNarration(model: previewModel(
            CostNarrationInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AICostForecastNarration(model: previewModel(
            readyInput(stream: CostNarrationStreamSnapshot(state: .done, text: sampleProse), connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AICostForecastNarration(model: previewModel(
            readyInput(stream: CostNarrationStreamSnapshot(state: .done, text: sampleProse), connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AICostForecastNarration(model: previewModel(
            CostNarrationInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
