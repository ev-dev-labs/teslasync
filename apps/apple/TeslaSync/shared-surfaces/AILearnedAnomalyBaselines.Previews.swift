//
//  AILearnedAnomalyBaselines.Previews.swift
//  TeslaSync — P4 shared surface · 0023 · AILearnedAnomalyBaselines (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  no-vehicle, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: BaselineInput) -> LearnedBaselineModel {
        let source = InMemoryLearnedBaselineSource(initial: input)
        let model = LearnedBaselineModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleVehicle = 7

    private let sampleProse = """
    Two signals shaped the learned envelope. Pack voltage held a tight mean of 394 V (σ 2.1 V), so \
    its p5/p95 bounds sit well inside the static safe range. Tyre pressure had too few samples this \
    window, so Helix kept the deterministic safe-range fallback for it rather than over-fitting.
    """

    private func readyInput(
        stream: BaselineStreamSnapshot,
        vehicleID: Int? = sampleVehicle,
        connection: BaselineConnection = .live
    ) -> BaselineInput {
        BaselineInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AILearnedAnomalyBaselines(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AILearnedAnomalyBaselines(model: previewModel(
            readyInput(stream: BaselineStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AILearnedAnomalyBaselines(model: previewModel(
            readyInput(stream: BaselineStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AILearnedAnomalyBaselines(model: previewModel(
            readyInput(stream: BaselineStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no vehicle") {
        AILearnedAnomalyBaselines(model: previewModel(readyInput(stream: .idle, vehicleID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AILearnedAnomalyBaselines(model: previewModel(BaselineInput(availability: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AILearnedAnomalyBaselines(model: previewModel(
            BaselineInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AILearnedAnomalyBaselines(model: previewModel(
            readyInput(stream: BaselineStreamSnapshot(state: .done, text: sampleProse), connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AILearnedAnomalyBaselines(model: previewModel(
            readyInput(stream: BaselineStreamSnapshot(state: .done, text: sampleProse), connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AILearnedAnomalyBaselines(model: previewModel(
            BaselineInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
