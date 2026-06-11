//
//  AIDigestNarration.Previews.swift
//  TeslaSync — P4 shared surface · 0016 · AIDigestNarration (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error / no-vehicle,
//  loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: DigestNarrationInput) -> DigestNarrationModel {
        let source = InMemoryDigestNarrationSource(initial: input)
        let model = DigestNarrationModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleVehicleID = 7

    private let sampleProse = """
    Solid week. You drove about 318 km across 11 trips — the standout was Thursday's 92 km round trip \
    to the coast, your longest in a fortnight. Charging stayed mostly at home (88%), and you topped up \
    to 80% twice overnight on the cheap off-peak rate. Efficiency held at 158 Wh/km despite two chilly \
    mornings, and regen clawed back the equivalent of roughly 41 km of "free" range. Nothing unusual \
    in the battery or tyre trends — a steady, efficient week.
    """

    private func readyInput(
        stream: DigestNarrationStreamSnapshot,
        vehicleID: Int? = sampleVehicleID,
        connection: DigestNarrationConnection = .live
    ) -> DigestNarrationInput {
        DigestNarrationInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AIDigestNarration(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIDigestNarration(model: previewModel(
            readyInput(stream: DigestNarrationStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIDigestNarration(model: previewModel(
            readyInput(stream: DigestNarrationStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIDigestNarration(model: previewModel(
            readyInput(stream: DigestNarrationStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_429"
            ))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no vehicle") {
        AIDigestNarration(model: previewModel(readyInput(stream: .idle, vehicleID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIDigestNarration(model: previewModel(
            DigestNarrationInput(availability: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIDigestNarration(model: previewModel(
            DigestNarrationInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIDigestNarration(model: previewModel(
            readyInput(
                stream: DigestNarrationStreamSnapshot(state: .done, text: sampleProse),
                connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIDigestNarration(model: previewModel(
            readyInput(
                stream: DigestNarrationStreamSnapshot(state: .done, text: sampleProse),
                connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIDigestNarration(model: previewModel(
            DigestNarrationInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
