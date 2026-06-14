//
//  AIChargingCurveFingerprintClustering.Previews.swift
//  TeslaSync — P4 shared surface · 0010 · AIChargingCurveFingerprintClustering (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error / no-vehicle,
//  loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: ChargeCurveFingerprintInput) -> ChargeCurveFingerprintModel {
        let source = InMemoryChargeCurveFingerprintSource(initial: input)
        let model = ChargeCurveFingerprintModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleVehicleID = ChargeCurveFingerprintVehicleID.number(4821)

    private let sampleProse = """
    Three fingerprints stand out across your last 90 days. The "L1 overnight" cluster is the gentle one \
    — it tops out near 1.6 kW and holds a flat envelope from 20% to 80%, so its curve below is the long, \
    low plateau. The "L2 workplace" cluster ramps to roughly 11 kW within the first two minutes and \
    tapers past 80%, which is why its fingerprint has the steep shoulder. The "DC fast" cluster spikes \
    to 138 kW, then steps down at each thermal knee — the staircase you see on the right. Helix only \
    names and explains these buckets; it never re-draws them: every number here is the same one the \
    deterministic curves render.
    """

    private func readyInput(
        stream: ChargeCurveFingerprintStreamSnapshot,
        vehicleID: ChargeCurveFingerprintVehicleID = sampleVehicleID,
        connection: ChargeCurveFingerprintConnection = .live
    ) -> ChargeCurveFingerprintInput {
        ChargeCurveFingerprintInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AIChargingCurveFingerprintClustering(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIChargingCurveFingerprintClustering(model: previewModel(
            readyInput(stream: ChargeCurveFingerprintStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIChargingCurveFingerprintClustering(model: previewModel(
            readyInput(stream: ChargeCurveFingerprintStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIChargingCurveFingerprintClustering(model: previewModel(
            readyInput(stream: ChargeCurveFingerprintStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_429"
            ))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no vehicle") {
        AIChargingCurveFingerprintClustering(model: previewModel(
            readyInput(stream: .idle, vehicleID: .absent)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIChargingCurveFingerprintClustering(model: previewModel(
            ChargeCurveFingerprintInput(availability: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIChargingCurveFingerprintClustering(model: previewModel(
            ChargeCurveFingerprintInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIChargingCurveFingerprintClustering(model: previewModel(
            readyInput(
                stream: ChargeCurveFingerprintStreamSnapshot(state: .done, text: sampleProse),
                connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIChargingCurveFingerprintClustering(model: previewModel(
            readyInput(
                stream: ChargeCurveFingerprintStreamSnapshot(state: .done, text: sampleProse),
                connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIChargingCurveFingerprintClustering(model: previewModel(
            ChargeCurveFingerprintInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
