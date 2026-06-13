//
//  AITCONarration.Previews.swift
//  TeslaSync — P4 shared surface · 0052 · AITCONarration (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  no-vehicle, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: TCONarrationInput) -> TCONarrationModel {
        let source = InMemoryTCONarrationSource(initial: input)
        let model = TCONarrationModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleVehicle = 7

    private let sampleProse = """
    Over your tracked ownership window the EV charging spend lands near $61/mo against an estimated \
    $142/mo of equivalent gas — so the operating-cost gap is the main driver of the cumulative \
    savings the chart plots. Folding in the flat $50/mo maintenance heuristic, cumulative savings \
    cross break-even and keep widening month over month. These are operating costs only: no \
    depreciation, resale, insurance, registration, or financing is included, the equivalent gas \
    figure is estimated from charged energy rather than real-world distance, and the gas-price / \
    efficiency / electricity-rate inputs come from your editable Settings. The numbers here are \
    exactly the ones the chart shows — this only explains them.
    """

    private func readyInput(
        stream: TCONarrationStreamSnapshot,
        vehicleID: Int? = sampleVehicle,
        connection: TCONarrationConnection = .live
    ) -> TCONarrationInput {
        TCONarrationInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AITCONarration(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AITCONarration(model: previewModel(
            readyInput(stream: TCONarrationStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AITCONarration(model: previewModel(
            readyInput(stream: TCONarrationStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AITCONarration(model: previewModel(
            readyInput(stream: TCONarrationStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no vehicle") {
        AITCONarration(model: previewModel(readyInput(stream: .idle, vehicleID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AITCONarration(model: previewModel(TCONarrationInput(availability: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AITCONarration(model: previewModel(
            TCONarrationInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AITCONarration(model: previewModel(
            readyInput(stream: TCONarrationStreamSnapshot(state: .done, text: sampleProse), connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AITCONarration(model: previewModel(
            readyInput(stream: TCONarrationStreamSnapshot(state: .done, text: sampleProse), connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AITCONarration(model: previewModel(
            TCONarrationInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
