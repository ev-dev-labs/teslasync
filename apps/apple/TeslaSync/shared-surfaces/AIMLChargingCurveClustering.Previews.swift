//
//  AIMLChargingCurveClustering.Previews.swift
//  TeslaSync — P4 shared surface · 0027 · AIMLChargingCurveClustering (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  no-vehicle, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: MLChargeCurveInput) -> MLChargeCurveModel {
        let source = InMemoryMLChargeCurveSource(initial: input)
        let model = MLChargeCurveModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleVehicle = 7

    private let sampleProse = """
    Three clusters emerged. L1 overnight (mean peak 1.4 kW, p95 1.7 kW) tracks slow home charging \
    and dominates weekday nights. L2 workplace (mean peak 7.2 kW) clusters tightly around the \
    11 a.m. top-up. DC fast (mean peak 118 kW, p5 84 kW) matches the rule-label baseline the \
    Charging Curve page already shows, so the learned envelope agrees with today's deterministic labels.
    """

    private func readyInput(
        stream: MLChargeCurveStreamSnapshot,
        vehicleID: Int? = sampleVehicle,
        connection: MLChargeCurveConnection = .live
    ) -> MLChargeCurveInput {
        MLChargeCurveInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AIMLChargingCurveClustering(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIMLChargingCurveClustering(model: previewModel(
            readyInput(stream: MLChargeCurveStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIMLChargingCurveClustering(model: previewModel(
            readyInput(stream: MLChargeCurveStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIMLChargingCurveClustering(model: previewModel(
            readyInput(stream: MLChargeCurveStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no vehicle") {
        AIMLChargingCurveClustering(model: previewModel(readyInput(stream: .idle, vehicleID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIMLChargingCurveClustering(model: previewModel(MLChargeCurveInput(availability: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIMLChargingCurveClustering(model: previewModel(
            MLChargeCurveInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIMLChargingCurveClustering(model: previewModel(
            readyInput(stream: MLChargeCurveStreamSnapshot(state: .done, text: sampleProse), connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIMLChargingCurveClustering(model: previewModel(
            readyInput(stream: MLChargeCurveStreamSnapshot(state: .done, text: sampleProse), connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIMLChargingCurveClustering(model: previewModel(
            MLChargeCurveInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
