//
//  AITirePressureTrendReasoning.Previews.swift
//  TeslaSync — P4 shared surface · 0054 · AITirePressureTrendReasoning (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  no-vehicle, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: TirePressureTrendReasoningInput) -> TirePressureTrendReasoningModel {
        let source = InMemoryTirePressureTrendReasoningSource(initial: input)
        let model = TirePressureTrendReasoningModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleVehicle = 7

    private let sampleProse = """
    Over the last 30 days three corners held steady near 42 psi while the front-left drifted down \
    about 2.5 psi to 39.6 — a slow, single-corner decline that reads more like a small bead or valve \
    seep than weather. The other three move together with the overnight lows, the cold-weather \
    correlation you'd expect when nothing is wrong. Front-left is the one to watch, though it is \
    still above the 36 psi warning line. This is a descriptive linear extrapolation of recent \
    readings, not a forecast of when it will cross.
    """

    private func readyInput(
        stream: TirePressureTrendReasoningStreamSnapshot,
        vehicleID: Int? = sampleVehicle,
        connection: TirePressureTrendReasoningConnection = .live
    ) -> TirePressureTrendReasoningInput {
        TirePressureTrendReasoningInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AITirePressureTrendReasoning(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AITirePressureTrendReasoning(model: previewModel(
            readyInput(stream: TirePressureTrendReasoningStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AITirePressureTrendReasoning(model: previewModel(
            readyInput(stream: TirePressureTrendReasoningStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AITirePressureTrendReasoning(model: previewModel(
            readyInput(stream: TirePressureTrendReasoningStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_429"
            ))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no vehicle") {
        AITirePressureTrendReasoning(model: previewModel(readyInput(stream: .idle, vehicleID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AITirePressureTrendReasoning(model: previewModel(
            TirePressureTrendReasoningInput(availability: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AITirePressureTrendReasoning(model: previewModel(
            TirePressureTrendReasoningInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AITirePressureTrendReasoning(model: previewModel(
            readyInput(
                stream: TirePressureTrendReasoningStreamSnapshot(state: .done, text: sampleProse),
                connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AITirePressureTrendReasoning(model: previewModel(
            readyInput(
                stream: TirePressureTrendReasoningStreamSnapshot(state: .done, text: sampleProse),
                connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AITirePressureTrendReasoning(model: previewModel(
            TirePressureTrendReasoningInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
