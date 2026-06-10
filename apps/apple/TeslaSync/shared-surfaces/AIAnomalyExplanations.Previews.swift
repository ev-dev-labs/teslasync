//
//  AIAnomalyExplanations.Previews.swift
//  TeslaSync — P4 shared surface · 0005 · AIAnomalyExplanations (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  no-vehicle, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: AnomalyExplanationsInput) -> AnomalyExplanationsModel {
        let source = InMemoryAnomalyExplanationsSource(initial: input)
        let model = AnomalyExplanationsModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleVehicle = 7

    private let sampleProse = """
    Two anomalies stand out. Battery cell-group 3 drifted ~4% below its peers over the last week, \
    consistent with a developing imbalance rather than a sensor fault. Separately, phantom drain \
    on Tuesday night tracked a 90-minute sentry-mode session, so it is expected, not a regression.
    """

    private func readyInput(
        stream: AnomalyStreamSnapshot,
        vehicleID: Int? = sampleVehicle,
        connection: AnomalyConnection = .live
    ) -> AnomalyExplanationsInput {
        AnomalyExplanationsInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AIAnomalyExplanations(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIAnomalyExplanations(model: previewModel(
            readyInput(stream: AnomalyStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIAnomalyExplanations(model: previewModel(
            readyInput(stream: AnomalyStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIAnomalyExplanations(model: previewModel(
            readyInput(stream: AnomalyStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no vehicle") {
        AIAnomalyExplanations(model: previewModel(readyInput(stream: .idle, vehicleID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIAnomalyExplanations(model: previewModel(AnomalyExplanationsInput(availability: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIAnomalyExplanations(model: previewModel(
            AnomalyExplanationsInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIAnomalyExplanations(model: previewModel(
            readyInput(stream: AnomalyStreamSnapshot(state: .done, text: sampleProse), connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIAnomalyExplanations(model: previewModel(
            readyInput(stream: AnomalyStreamSnapshot(state: .done, text: sampleProse), connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIAnomalyExplanations(model: previewModel(
            AnomalyExplanationsInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
