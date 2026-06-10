//
//  AIRangePrediction.Previews.swift
//  TeslaSync — P4 shared surface · 0043 · AIRangePrediction (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  no-vehicle, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: RangePredictionInput) -> RangePredictionModel {
        let source = InMemoryRangePredictionSource(initial: input)
        let model = RangePredictionModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleVehicle = 7

    private let sampleProse = """
    The learned envelope split cleanly across temperature and speed. The cold-weather city bucket \
    (≤ 0 °C, < 50 km/h) settled at 232 Wh/km — about 14% above the static heuristic the projection \
    uses today, which explains the shorter winter range you have been seeing. The mild highway \
    bucket (10–25 °C, > 90 km/h) landed at 196 Wh/km, within 3% of the heuristic. Two sparse buckets \
    fell back to the deterministic linear model. Nothing here changes the Projected Range page — \
    this just narrates the learned per-bucket Wh/km.
    """

    private func readyInput(
        stream: RangePredictionStreamSnapshot,
        vehicleID: Int? = sampleVehicle,
        connection: RangePredictionConnection = .live
    ) -> RangePredictionInput {
        RangePredictionInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AIRangePrediction(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIRangePrediction(model: previewModel(
            readyInput(stream: RangePredictionStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIRangePrediction(model: previewModel(
            readyInput(stream: RangePredictionStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIRangePrediction(model: previewModel(
            readyInput(stream: RangePredictionStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no vehicle") {
        AIRangePrediction(model: previewModel(readyInput(stream: .idle, vehicleID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIRangePrediction(model: previewModel(RangePredictionInput(availability: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIRangePrediction(model: previewModel(
            RangePredictionInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIRangePrediction(model: previewModel(
            readyInput(stream: RangePredictionStreamSnapshot(state: .done, text: sampleProse), connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIRangePrediction(model: previewModel(
            readyInput(stream: RangePredictionStreamSnapshot(state: .done, text: sampleProse), connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIRangePrediction(model: previewModel(
            RangePredictionInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
