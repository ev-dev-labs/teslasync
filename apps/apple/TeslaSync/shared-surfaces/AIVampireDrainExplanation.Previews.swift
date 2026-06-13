//
//  AIVampireDrainExplanation.Previews.swift
//  TeslaSync — P4 shared surface · 0057 · AIVampireDrainExplanation (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  no-vehicle, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: VampireDrainExplainInput) -> VampireDrainExplainModel {
        let source = InMemoryVampireDrainExplainSource(initial: input)
        let model = VampireDrainExplainModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleVehicle = 7

    private let sampleProse = """
    Over the last 30 days this car lost about 1.4% of charge per idle day — a little above the \
    typical fleet. The strongest correlate is Sentry Mode: days it stayed armed drained roughly \
    2.3× faster than days it was off. The worst single idle stretch (3.1%/day) lined up with a \
    long airport park in the cold. These are the same numbers the cards below show; the link to \
    Sentry is correlational, not proof of cause.
    """

    private func readyInput(
        stream: VampireDrainExplainStreamSnapshot,
        vehicleID: Int? = sampleVehicle,
        connection: VampireDrainExplainConnection = .live
    ) -> VampireDrainExplainInput {
        VampireDrainExplainInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AIVampireDrainExplanation(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIVampireDrainExplanation(model: previewModel(
            readyInput(stream: VampireDrainExplainStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIVampireDrainExplanation(model: previewModel(
            readyInput(stream: VampireDrainExplainStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIVampireDrainExplanation(model: previewModel(
            readyInput(stream: VampireDrainExplainStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no vehicle") {
        AIVampireDrainExplanation(model: previewModel(readyInput(stream: .idle, vehicleID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIVampireDrainExplanation(model: previewModel(
            VampireDrainExplainInput(availability: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIVampireDrainExplanation(model: previewModel(
            VampireDrainExplainInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIVampireDrainExplanation(model: previewModel(
            readyInput(
                stream: VampireDrainExplainStreamSnapshot(state: .done, text: sampleProse),
                connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIVampireDrainExplanation(model: previewModel(
            readyInput(
                stream: VampireDrainExplainStreamSnapshot(state: .done, text: sampleProse),
                connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIVampireDrainExplanation(model: previewModel(
            VampireDrainExplainInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
