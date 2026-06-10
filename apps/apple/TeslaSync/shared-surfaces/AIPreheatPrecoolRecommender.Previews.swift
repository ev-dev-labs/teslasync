//
//  AIPreheatPrecoolRecommender.Previews.swift
//  TeslaSync — P4 shared surface · 0040 · AIPreheatPrecoolRecommender (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  missing-inputs, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: PreheatPrecoolInput) -> PreheatPrecoolModel {
        let source = InMemoryPreheatPrecoolSource(initial: input)
        let model = PreheatPrecoolModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleRequest = PreheatPrecoolRequest(
        vehicleID: 12,
        departBy: "2026-01-15T08:00:00Z",
        currentCabinTempC: 9.5,
        outsideTempC: 2.0,
        targetCabinTempC: 21
    )

    private let sampleProse = """
    Recommended preheat window: start 07:38, finish by your 08:00 departure. With the cabin at \
    9.5 °C and 2 °C outside, ~22 minutes of preheat brings the cabin to the 21 °C target without \
    over-spending range. Mode: preheat (the cabin is below target). This is a proposal only — Helix \
    hasn't changed anything. Review it, then tap Apply on the climate controls below to schedule it.
    """

    private func readyInput(
        stream: PreheatPrecoolStreamSnapshot,
        request: PreheatPrecoolRequest = sampleRequest,
        connection: PreheatPrecoolConnection = .live
    ) -> PreheatPrecoolInput {
        PreheatPrecoolInput(
            availability: .resolved(enabled: true),
            request: request,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AIPreheatPrecoolRecommender(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIPreheatPrecoolRecommender(model: previewModel(
            readyInput(stream: PreheatPrecoolStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIPreheatPrecoolRecommender(model: previewModel(
            readyInput(stream: PreheatPrecoolStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIPreheatPrecoolRecommender(model: previewModel(
            readyInput(stream: PreheatPrecoolStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · missing inputs") {
        AIPreheatPrecoolRecommender(model: previewModel(
            readyInput(stream: .idle, request: PreheatPrecoolRequest())
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIPreheatPrecoolRecommender(model: previewModel(PreheatPrecoolInput(availability: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIPreheatPrecoolRecommender(model: previewModel(
            PreheatPrecoolInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIPreheatPrecoolRecommender(model: previewModel(
            readyInput(stream: PreheatPrecoolStreamSnapshot(state: .done, text: sampleProse), connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIPreheatPrecoolRecommender(model: previewModel(
            readyInput(stream: PreheatPrecoolStreamSnapshot(state: .done, text: sampleProse), connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIPreheatPrecoolRecommender(model: previewModel(
            PreheatPrecoolInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
